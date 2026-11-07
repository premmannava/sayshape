/**
 * Interactive scenes in a real browser: the factory monitor sample
 * (playground/scene-samples.ts) used with the mouse and the keyboard at
 * desktop, tablet and phone widths, in the Studio themes, with and without
 * motion. No baselines: these check behavior, and save screenshots before
 * and after each interaction as test attachments for people to look at.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const MIRROR = "[data-sayshape-a11y]";
const WIDTHS = [1440, 1024, 768, 390, 360];
const THEMES = ["studio-light", "studio-dark"] as const;

interface Machine { id: string; name: string; kind: string; health: number; temp: number; rate: number }
interface Part { key: string; name: string; pressed?: boolean; x: number; y: number; w: number; h: number }

async function open(page: Page, o: { width: number; theme: string; motion?: boolean }): Promise<void> {
  await page.setViewportSize({ width: o.width, height: 1000 });
  await page.goto(`/visual/index.html?scene=factoryMonitor&theme=${o.theme}&width=${o.width}${o.motion ? "&motion=1" : ""}`);
  await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
  expect(await page.evaluate(() => window.__sayShapeError ?? null)).toBeNull();
}

/** The machines a screen reader finds in the scene's figure, with where they are on the page. */
async function parts(page: Page): Promise<Part[]> {
  return page.evaluate(() => {
    const ui = window.__sayshape!;
    ui.renderNow();
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    type Node = { role: string; name?: string; key: string; pressed?: boolean; rect: { x: number; y: number; w: number; h: number }; children: Node[] };
    const out: Part[] = [];
    const walk = (n: Node, inFigure: boolean) => {
      if (inFigure && n.role === "button") out.push({ key: n.key, name: n.name ?? "", pressed: n.pressed, x: r.left + n.rect.x, y: r.top + n.rect.y, w: n.rect.w, h: n.rect.h });
      for (const c of n.children) walk(c, inFigure || n.role === "figure");
    };
    walk(ui.accessibilityTree() as unknown as Node, false);
    return out;
  });
}

const machines = (page: Page) => page.evaluate(() => window.__sayshape!.state.get("machines") as unknown as Machine[]);
const sel = (page: Page) => page.evaluate(() => window.__sayshape!.state.get("sel"));
/** What the mirror says (names and descriptions), which is what the canvas shows in words. */
const mirrorText = async (page: Page) => {
  // The mirror is rebuilt after the frame that follows a change; wait for it as a screen reader would.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.locator(MIRROR).evaluate((m) => {
  const out: string[] = [];
  for (const el of [m, ...m.querySelectorAll("*")]) {
    out.push(el.getAttribute("aria-label") ?? "", el.getAttribute("aria-description") ?? "");
    for (const id of (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)) out.push(document.getElementById(id)?.textContent ?? "");
    for (const n of el.childNodes) if (n.nodeType === 3) out.push(n.textContent ?? "");
  }
  return out.join(" | ");
  });
};

/** A point on the machine's body: the middle of its region, a little below the status light. */
const middle = (p: Part) => ({ x: p.x + p.w / 2, y: p.y + p.h * 0.6 });

/** Pixels of a page rectangle on the canvas, as one string, to compare two moments. */
async function pixels(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<string> {
  return page.evaluate((q) => {
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    const d = c.getContext("2d")!.getImageData(Math.round((q.x - r.left) * k), Math.round((q.y - r.top) * k), Math.max(1, Math.round(q.w * k)), Math.max(1, Math.round(q.h * k))).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]!) | 0;
    return `${d.length}:${h}`;
  }, rect);
}

/** The scene's box on the page. */
const sceneBox = (page: Page) => page.evaluate(() => {
  const ui = window.__sayshape!;
  const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
  const b = ui.hitRegions.find((h) => h.box.node.type === "scene")!;
  let s = b.box as { node: unknown; x: number; y: number; w: number; h: number };
  const walk = (x: { node: { type: string }; children: unknown[]; x: number; y: number; w: number; h: number }) => { if (x.node.type === "scene") s = x as never; (x.children as never[]).forEach(walk); };
  walk(ui.boxes as never);
  return { x: r.left + s.x, y: r.top + s.y, w: s.w, h: s.h };
});

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.locator("#frame").screenshot(), contentType: "image/png" });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`factory monitor: press each machine, panel follows (${theme}, ${width}px)`, async ({ page }, info) => {
      await open(page, { width, theme });
      await shot(page, info, "before");
      const list = await machines(page);
      const found = await parts(page);
      expect(found.map((p) => p.name.split(",")[0])).toEqual(list.map((m) => m.name));
      for (const p of found) {
        // Usable on a phone: every machine at least 24 px both ways (WCAG 2.5.8).
        expect(Math.min(p.w, p.h), `${p.name} size`).toBeGreaterThanOrEqual(24);
        const m = list.find((x) => p.name.startsWith(x.name))!;
        const at = middle(p);
        await page.mouse.click(at.x, at.y);
        expect(await sel(page)).toBe(m.id);
        const text = await mirrorText(page);
        for (const want of [m.kind, `${m.health}%`, `${m.temp} °C`, `${m.rate} parts/h`]) expect(text, `${m.name} panel`).toContain(want);
        // The selected machine is announced as pressed, the others not.
        const now = await parts(page);
        expect(now.filter((x) => x.pressed).map((x) => x.name)).toEqual([p.name]);
      }
      await shot(page, info, "after pressing every machine");
      // Nothing spills sideways: no horizontal scroll, every part inside the canvas.
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(fits).toBe(true);
      const canvas = await page.locator("#canvas").boundingBox();
      for (const p of await parts(page)) {
        expect(p.x).toBeGreaterThanOrEqual(canvas!.x - 1);
        expect(p.x + p.w).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
      }
    });
  }
}

test("hover shows the tip beside the machine (above it, or below when there's no room), inside the scene", async ({ page }, info) => {
  await open(page, { width: 1024, theme: "studio-light" });
  const scene = await sceneBox(page);
  for (const p of await parts(page)) {
    const above = { x: p.x + p.w / 2 - 20, y: p.y - 24, w: 40, h: 18 };
    const below = { x: p.x + p.w / 2 - 20, y: p.y + p.h + 6, w: 40, h: 18 };
    const room = above.y > scene.y + 4;
    const spot = room ? above : below;
    const before = await pixels(page, spot);
    await page.mouse.move(middle(p).x, middle(p).y);
    await page.waitForTimeout(80);
    if (p.name.startsWith("Packer")) await shot(page, info, "hovering the packer");
    expect(await pixels(page, spot), `${p.name}'s tip ${room ? "above" : "below"} it`).not.toBe(before);
    expect(spot.y).toBeGreaterThan(scene.y);
    expect(spot.y + spot.h).toBeLessThan(scene.y + scene.h);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(80);
    expect(await pixels(page, spot)).toBe(before);
  }
});

test("keyboard: Tab reaches each machine in order, the focus ring shows, Enter and Space select", async ({ page }, info) => {
  await open(page, { width: 1024, theme: "studio-dark" });
  // From the page, as a person arrives: the first Tab enters the canvas.
  const reached: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");
    reached.push(f);
    await page.keyboard.press(i % 2 ? " " : "Enter");
    expect(await sel(page)).toBe((await machines(page))[i]!.id);
  }
  expect(reached.map((n) => n.split(",")[0])).toEqual(["Cutter", "Press", "Welder", "Packer"]);
  await shot(page, info, "keyboard focus on the packer");
});

test("the focus ring is visible: the pixels around a focused machine change", async ({ page }) => {
  await open(page, { width: 1024, theme: "studio-light" });
  const p = (await parts(page))[2]!;
  const edge = { x: p.x - 6, y: p.y - 6, w: p.w + 12, h: 5 };
  const before = await pixels(page, edge);
  await page.locator("canvas").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(50);
  expect(await pixels(page, edge)).not.toBe(before);
});

test("controls outside the scene change it, with no new spec", async ({ page }, info) => {
  await open(page, { width: 1024, theme: "studio-light", motion: true });
  const scene = await sceneBox(page);
  const belt = { x: scene.x, y: scene.y + scene.h * 0.68, w: scene.w, h: scene.h * 0.2 };
  // Running: crates move along the belt, so two moments differ.
  const a = await pixels(page, belt);
  await page.waitForTimeout(400);
  expect(await pixels(page, belt)).not.toBe(a);
  // The run switch stops it: the belt holds still.
  const sw = await page.evaluate(() => {
    const ui = window.__sayshape!, r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    const h = ui.hitRegions.find((x) => x.box.node.type === "switch")!.box;
    return { x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2 };
  });
  await page.mouse.click(sw.x, sw.y);
  expect(await page.evaluate(() => window.__sayshape!.state.get("running"))).toBe(false);
  await page.waitForTimeout(200);
  const b = await pixels(page, belt);
  await page.waitForTimeout(400);
  expect(await pixels(page, belt)).toBe(b);
  await shot(page, info, "line stopped");
  // The output slider writes to the selected machine in the list.
  const track = await page.evaluate(() => {
    const ui = window.__sayshape!, r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    const h = ui.hitRegions.find((x) => x.box.node.type === "slider")!.box;
    return { x: r.left + h.x, y: r.top + h.y + h.h / 2, w: h.w };
  });
  await page.mouse.move(track.x + track.w * 0.5, track.y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.w + 20, track.y, { steps: 5 });
  await page.mouse.up();
  const press = (await machines(page)).find((m) => m.id === "press")!;
  expect(press.rate).toBe(150);
  expect(await mirrorText(page)).toContain("150 parts/h");
});

test("selection stays on the right machine when the list changes order", async ({ page }) => {
  await open(page, { width: 1024, theme: "studio-light" });
  const weld = (await parts(page)).find((p) => p.name.startsWith("Welder"))!;
  await page.mouse.click(middle(weld).x, middle(weld).y);
  expect(await sel(page)).toBe("weld");
  // The host reorders the machines (as new data would): the outline follows the welder to its new place.
  await page.evaluate(() => {
    const ui = window.__sayshape!;
    const list = ui.state.get("machines") as unknown as Array<Record<string, unknown>>;
    const xs = list.map((m) => m.x);
    ui.state.set("machines", [...list].reverse().map((m, i) => ({ ...m, x: xs[i] })) as never);
    ui.renderNow();
  });
  const now = await parts(page);
  expect(now.filter((p) => p.pressed).map((p) => p.name.split(",")[0])).toEqual(["Welder"]);
  const pack = now.find((p) => p.name.startsWith("Packer"))!;
  await page.mouse.click(middle(pack).x, middle(pack).y);
  expect(await sel(page)).toBe("pack");
});

test("animation doesn't get in the way of pressing", async ({ page }) => {
  await open(page, { width: 1024, theme: "studio-light", motion: true });
  const list = await machines(page);
  for (let round = 0; round < 3; round++) {
    for (const m of list) {
      const p = (await parts(page)).find((x) => x.name.startsWith(m.name))!;
      await page.mouse.click(middle(p).x, middle(p).y);
      expect(await sel(page), `round ${round}, ${m.name}`).toBe(m.id);
      await page.waitForTimeout(37);
    }
  }
});

test("reduced motion: a still picture that still presses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, { width: 1024, theme: "studio-dark", motion: true });
  const scene = await sceneBox(page);
  const a = await pixels(page, scene);
  await page.waitForTimeout(500);
  expect(await pixels(page, scene)).toBe(a);
  const p = (await parts(page))[0]!;
  await page.mouse.click(middle(p).x, middle(p).y);
  expect(await sel(page)).toBe("cut");
});

test("axe finds nothing wrong in the scene's mirror", async ({ page }) => {
  await open(page, { width: 1024, theme: "studio-light" });
  const result = await new AxeBuilder({ page }).include(MIRROR).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
  // The machines are buttons inside a named figure, with aria-pressed for the selected one.
  const roles = await page.locator(`${MIRROR} [role=figure]`).evaluate((f) => ({
    name: f.getAttribute("aria-label"),
    buttons: [...f.querySelectorAll("button, [role=button]")].map((b) => [b.getAttribute("aria-label") ?? b.textContent, b.getAttribute("aria-pressed")]),
  }));
  expect(roles.name).toMatch(/Production line 3/);
  expect(roles.buttons.map(([, p]) => p)).toEqual(["false", "true", "false", "false"]);
});

test("the mirror follows shapes that appear and move during an animation", async ({ page }) => {
  await open(page, { width: 600, theme: "studio-light", motion: true });
  await page.evaluate(() => {
    window.__sayshape!.setSpec(`state n=0\nscene "Moving" w=400 h=100 duration=2 loop=false\n  circle x={50 + 100*t} y=50 r=20 fill=accent on=inc:n name="Mover"\n  rect x=300 y=20 w=60 h=60 fill=good on=inc:n name="Go" if={t > 1}`, { resetState: true });
  });
  await page.waitForTimeout(2600);
  const names = await page.locator(`${MIRROR} [role=figure] button, ${MIRROR} [role=figure] [role=button]`).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent));
  expect(names).toEqual(expect.arrayContaining(["Mover", "Go"]));
  // The mover's mirror node sits where it ended, not where it started.
  const left = await page.locator(`${MIRROR} [aria-label="Mover"], ${MIRROR} button:has-text("Mover")`).first().evaluate((e) => e.getBoundingClientRect().left);
  const canvas = await page.locator("#canvas").boundingBox();
  expect(left - canvas!.x).toBeGreaterThan(150);
});
