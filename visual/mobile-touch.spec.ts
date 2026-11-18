import { expect, test, type Page } from "@playwright/test";

// Swipes on a phone-sized page (iPhone width, touch): vertical swipes over an interface scroll the
// page unless something inside can still scroll that way; sideways swipes over a wide table scroll
// the table. Emulated touch: a real phone is still on the pull request's checklist.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 } });

const cols = ["P", "W", "D", "L", "GF", "GA", "GD", "PTS"];
const rows = Array.from({ length: 6 }, (_, i) => `{id: ${i}, team: "Team ${i}", ${cols.map((c) => `${c.toLowerCase()}: ${i}`).join(", ")}}`);
const SPEC = `state rows=[${rows.join(", ")}]
text "Top of the answer" style=title
table items=rows
  table-column "Team" field=team
${cols.map((c) => `  table-column "${c} long header" field=${c.toLowerCase()} format=number`).join("\n")}
map
  pin "Phoenix" lat=33.4484 lon=-112.074
scroll size=sm
${Array.from({ length: 40 }, (_, i) => `  text "Inner line ${i}"`).join("\n")}
${Array.from({ length: 80 }, (_, i) => `text "Filler line ${i}"`).join("\n")}
`;

async function open(page: Page, touchText: boolean): Promise<void> {
  await page.goto(`/visual/index.html?case=component-button&theme=light&width=390${touchText ? "&touch=1" : ""}`);
  await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
  await page.evaluate((s) => { window.__sayshape!.setSpec(s, { resetState: true }); window.__sayshape!.renderNow(); }, SPEC);
}
const sessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>>();
async function swipe(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  let cdp = sessions.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); sessions.set(page, cdp); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}
/** The middle of the first box of an element type, in page coordinates (scrolled into view first). */
async function middle(page: Page, type: string): Promise<{ x: number; y: number }> {
  await page.evaluate((t) => {
    const h = window.__sayshape!.hitRegions.find((r) => r.box.node.type === t)!;
    const r = document.querySelector("canvas")!.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top + h.box.y - 120);
  }, type);
  await page.waitForTimeout(100);
  return page.evaluate((t) => {
    const h = window.__sayshape!.hitRegions.find((r) => r.box.node.type === t)!;
    const r = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: r.left + h.box.x + h.box.w / 2, y: r.top + h.box.y + Math.min(h.box.h / 2, 60) };
  }, type);
}
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const view = (page: Page, type: string) => page.evaluate((t) => {
  const n = window.__sayshape!.hitRegions.find((r) => r.box.node.type === t)!.box.node;
  return window.__sayshape!.viewState(n.id) ?? {};
}, type);

for (const touchText of [false, true]) {
  test.describe(touchText ? "with touch selection on" : "with touch selection off", () => {
    test("a vertical swipe over a wide table scrolls the page, not the table", async ({ page }) => {
      await open(page, touchText);
      const p = await middle(page, "table");
      const y0 = await scrollY(page);
      await swipe(page, p.x, p.y, 0, -200);
      expect(await scrollY(page)).toBeGreaterThan(y0 + 80);
      expect((await view(page, "table")).x ?? 0).toBe(0);
    });

    test("a sideways swipe over a wide table scrolls the table, not the page", async ({ page }) => {
      await open(page, touchText);
      const p = await middle(page, "table");
      const y0 = await scrollY(page);
      await swipe(page, p.x + 100, p.y, -200, 0);
      expect((await view(page, "table")).x ?? 0).toBeGreaterThan(40);
      expect(Math.abs((await scrollY(page)) - y0)).toBeLessThan(4);
    });

    test("a vertical swipe over a map scrolls the page", async ({ page }) => {
      await open(page, touchText);
      const p = await middle(page, "map");
      const y0 = await scrollY(page);
      await swipe(page, p.x, p.y, 0, -200);
      expect(await scrollY(page)).toBeGreaterThan(y0 + 80);
    });

    test("an inner scroll region takes a swipe it can use, and the page gets one at its edge", async ({ page }) => {
      await open(page, touchText);
      const p = await middle(page, "scroll");
      // At its top, pulling down goes to the page.
      const y0 = await scrollY(page);
      await swipe(page, p.x, p.y, 0, 150);
      expect(await scrollY(page)).toBeLessThan(y0 - 40);
      expect((await view(page, "scroll")).y ?? 0).toBe(0);
      // Pushing up scrolls the region, and the page stays put.
      const p2 = await middle(page, "scroll");
      const y1 = await scrollY(page);
      await swipe(page, p2.x, p2.y, 0, -150);
      expect((await view(page, "scroll")).y ?? 0).toBeGreaterThan(40);
      expect(Math.abs((await scrollY(page)) - y1)).toBeLessThan(4);
    });
  });
}
