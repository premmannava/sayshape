/**
 * Selectable text in a real browser (src/text-layer/dom.ts): dragging across
 * drawn words selects exactly them, a plain click still presses, a table
 * row copies as tab-separated cells, and the browser's find reaches words
 * the canvas drew. No baselines.
 */
import { expect, test, type Page } from "@playwright/test";

const LAYER = "[data-sayshape-text]";

const spec = `state n=0 selected=""
state rows=[{id: "laptop", name: "Laptop", price: 1200, stock: 12}, {id: "monitor", name: "Monitor", price: 350, stock: 24}, {id: "keyboard", name: "Keyboard", price: 79, stock: 41}]
card on=inc:n
  text "Pressable card heading" style=title
  text "Clicks: {n}"
table "Equipment" items=rows key=id bind=selected
  table-column "Equipment" field=name
  table-column "Price" field=price format=money
  table-column "In stock" field=stock format=number
button "Add" on=inc:n
`;

async function open(page: Page): Promise<void> {
  await page.goto(`/visual/index.html?case=component-button&theme=light&width=600`);
  await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
  await page.evaluate((s) => { window.__sayshape!.setSpec(s, { resetState: true }); window.__sayshape!.renderNow(); }, spec);
  // The layer is built once drawing has been still for a moment.
  await page.waitForFunction((sel) => document.querySelectorAll(`${sel} > div`).length > 8, LAYER);
}

const state = (page: Page, key: string) => page.evaluate((k) => window.__sayshape!.state.get(k), key);
const selection = (page: Page) => page.evaluate(() => window.getSelection()!.toString());

/** Where a drawn line of text is in the page. */
async function box(page: Page, text: string, nth = 0): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.evaluate(({ sel, text, nth }) => {
    const el = [...document.querySelectorAll<HTMLElement>(`${sel} > div`)].filter((d) => d.textContent === text)[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, { sel: LAYER, text, nth });
  expect(b, `a line of text "${text}"`).not.toBeNull();
  return b!;
}

async function drag(page: Page, from: { x: number; y: number; h: number }, to: { x: number; y: number; w: number; h: number }): Promise<void> {
  await page.mouse.move(from.x + 1, from.y + from.h / 2);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, to.y + to.h / 2, { steps: 6 });
  await page.mouse.move(to.x + to.w - 1, to.y + to.h / 2, { steps: 6 });
  await page.mouse.up();
}

test("dragging across a line selects exactly that text, and a plain click still presses", async ({ page }, info) => {
  await open(page);
  const heading = await box(page, "Pressable card heading");
  await drag(page, heading, heading);
  expect(await selection(page)).toBe("Pressable card heading");
  // The drag did not press the card.
  expect(await state(page, "n")).toBe(0);
  // The highlight sits on the drawn words.
  const sel = await page.evaluate(() => { const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  expect(Math.abs(sel.x - heading.x)).toBeLessThan(2);
  expect(Math.abs(sel.w - heading.w)).toBeLessThan(3);
  expect(sel.y).toBeGreaterThanOrEqual(heading.y - 2);
  expect(sel.y + sel.h).toBeLessThanOrEqual(heading.y + heading.h + 2);
  await info.attach("selection", { body: await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 260 } }), contentType: "image/png" });
  // A plain click on the same words presses the card and clears the selection.
  await page.mouse.click(heading.x + 20, heading.y + heading.h / 2);
  expect(await state(page, "n")).toBe(1);
  expect(await selection(page)).toBe("");
});

test("a table row still selects on a click, and copies as tab-separated cells on a drag", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  const monitor = await box(page, "Monitor");
  await page.mouse.click(monitor.x + 3, monitor.y + monitor.h / 2);
  expect(await state(page, "selected")).toBe("monitor");
  const keyboard = await box(page, "Keyboard");
  const stock = await box(page, "41");
  await drag(page, keyboard, stock);
  expect(await state(page, "selected")).toBe("monitor");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Keyboard\t$79.00\t41");
  // A selection over the whole table copies one row per line.
  const header = await box(page, "Equipment", 1);
  await drag(page, header, stock);
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Equipment\tPrice\tIn stock\nLaptop\t$1,200.00\t12\nMonitor\t$350.00\t24\nKeyboard\t$79.00\t41");
});

test("a button still presses", async ({ page }) => {
  await open(page);
  const at = await page.evaluate(() => {
    const h = window.__sayshape!.hitRegions.find((x) => x.box.node.type === "button")!;
    const r = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: r.left + h.box.x + h.box.w / 2, y: r.top + h.box.y + h.box.h / 2 };
  });
  await page.mouse.click(at.x, at.y);
  expect(await state(page, "n")).toBe(1);
});

test("the words of a table are real, rendered text the browser's find can match", async ({ page }) => {
  await open(page);
  // Ctrl/Cmd+F can't be driven headlessly, and window.find depends on the build's focus rules,
  // so check what find needs: real text nodes that are rendered (not display:none or hidden).
  const found = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(`${sel} > div`)].find((d) => d.textContent === "Keyboard");
    if (!el) return null;
    const css = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: css.display, visibility: css.visibility, w: r.width, h: r.height, hasText: el.firstChild?.nodeType === Node.TEXT_NODE };
  }, LAYER);
  expect(found).not.toBeNull();
  expect(found!.display).not.toBe("none");
  expect(found!.visibility).toBe("visible");
  expect(found!.w).toBeGreaterThan(0);
  expect(found!.hasText).toBe(true);
});

test("the layer is hidden from assistive technology and never takes the pointer", async ({ page }) => {
  await open(page);
  const layer = page.locator(LAYER);
  await expect(layer).toHaveAttribute("aria-hidden", "true");
  expect(await layer.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  expect(await page.locator("[data-sayshape-a11y]").count()).toBe(1);
  expect(await layer.locator("button, input, a, [role]").count()).toBe(0);
});

test("text hidden by a dialog, and text behind it, leave the layer; closing brings it back", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__sayshape!.setSpec(`state open=false\ntext "Behind words"\ndialog "Sure?" bind=open\n  text "Dialog words"\n`, { resetState: true });
    window.__sayshape!.renderNow();
  });
  const texts = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} > div`)].map((d) => d.textContent), LAYER);
  await expect.poll(texts).toEqual(["Behind words"]);
  await page.evaluate(() => { window.__sayshape!.state.set("open", true); });
  await expect.poll(texts).toEqual(["Dialog words"]);
  await page.evaluate(() => { window.__sayshape!.state.set("open", false); });
  await expect.poll(texts).toEqual(["Behind words"]);
});

test("a light, a dark and a forced-colors page all show the highlight", async ({ browser }) => {
  for (const [colorScheme, forcedColors] of [["light", "none"], ["dark", "none"], ["light", "active"]] as const) {
    const page = await browser.newPage({ colorScheme, forcedColors, viewport: { width: 1100, height: 900 }, baseURL: "http://localhost:5199" });
    await open(page);
    const row = await box(page, "Keyboard");
    const stock = await box(page, "41");
    await drag(page, row, stock);
    expect(await selection(page)).toBe("Keyboard$79.0041");
    // The page's own ::selection rule for the layer is in force: it isn't the browser's default for transparent text.
    const bg = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(`${sel} > div`)!;
      return getComputedStyle(el, "::selection").backgroundColor;
    }, LAYER);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    await page.close();
  }
});
