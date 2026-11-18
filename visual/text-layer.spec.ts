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
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Keyboard\t$79\t41");
  // A selection over the whole table copies one row per line.
  const header = await box(page, "Equipment", 1);
  await drag(page, header, stock);
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Equipment\tPrice\tIn stock\nLaptop\t$1,200\t12\nMonitor\t$350\t24\nKeyboard\t$79\t41");
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
    expect(await selection(page)).toBe("Keyboard$7941");
    // The page's own ::selection rule for the layer is in force: it isn't the browser's default for transparent text.
    const bg = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(`${sel} > div`)!;
      return getComputedStyle(el, "::selection").backgroundColor;
    }, LAYER);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    await page.close();
  }
});

// ---- double-click, triple-click and shift+click

const plain = `table "Equipment" items=rows key=id
  table-column "Equipment" field=name
  table-column "Price" field=price format=money
text "Weekend plan for the whole family"
text "A second paragraph that is long enough to wrap onto more than one drawn line at this narrow width, so one block has several lines of words"
card on=inc:n
  text "Pressable heading" style=title
`;
async function openPlain(page: Page): Promise<void> {
  await page.goto(`/visual/index.html?case=component-button&theme=light&width=420`);
  await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
  await page.evaluate((s) => { window.__sayshape!.setSpec(`state n=0 rows=[{id: "a", name: "Laptop", price: 1200}, {id: "b", name: "Monitor", price: 350}]\n${s}`, { resetState: true }); window.__sayshape!.renderNow(); }, plain);
  await page.waitForFunction((sel) => document.querySelectorAll(`${sel} > div`).length > 6, LAYER);
}
const dbl = async (page: Page, x: number, y: number, n: number) => { for (let i = 0; i < n; i++) await page.mouse.click(x, y); };

test("double-click selects a word, triple-click the whole block, shift+click extends", async ({ page }) => {
  await openPlain(page);
  const para = await box(page, "Weekend plan for the whole family");
  // "Weekend" is the first word: a double-click near the left edge.
  await dbl(page, para.x + 12, para.y + para.h / 2, 2);
  expect(await selection(page)).toBe("Weekend");
  await page.mouse.click(2, 2); // elsewhere: clears
  expect(await selection(page)).toBe("");
  // Triple-click: the paragraph's wrapped lines, as one block.
  const first = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(`${sel} > div`)].find((d) => d.textContent!.startsWith("A second paragraph"))!;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, h: r.height };
  }, LAYER);
  await dbl(page, first.x + 20, first.y + first.h / 2, 3);
  const block = await selection(page);
  expect(block.startsWith("A second paragraph")).toBe(true);
  expect(block.endsWith("several lines of words")).toBe(true);
  expect(block).not.toContain("Weekend");
  // Shift+click: the selection's start stays, its end moves to the click.
  const heading = await box(page, "Weekend plan for the whole family");
  await page.mouse.click(2, 2);
  await dbl(page, heading.x + 12, heading.y + heading.h / 2, 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(heading.x + heading.w - 3, heading.y + heading.h / 2);
  await page.keyboard.up("Shift");
  expect(await selection(page)).toBe("Weekend plan for the whole family");
});

test("a table cell selects as one block, and text in something pressable keeps the plain click", async ({ page }) => {
  await openPlain(page);
  const cell = await box(page, "Monitor");
  await dbl(page, cell.x + 3, cell.y + cell.h / 2, 3);
  expect(await selection(page)).toBe("Monitor");
  await page.mouse.click(2, 2);
  const head = await box(page, "Pressable heading");
  await dbl(page, head.x + 5, head.y + head.h / 2, 2);
  expect(await selection(page)).toBe("");
  expect(await state(page, "n")).toBe(2);
});

// ---- touch (emulated: a real phone is still needed, see the pull request's checklist)

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 420, height: 700 } });

  const tall = `table "Equipment" items=rows key=id bind=selected
  table-column "Equipment" field=name
  table-column "Price" field=price format=money
card on=inc:n
  text "Pressable heading" style=title
text "Weekend plan for the whole family"
button "Add" on=inc:m
${Array.from({ length: 120 }, (_, i) => `text "Filler line number ${i}"`).join("\n")}
`;
  async function openTouch(page: Page): Promise<void> {
    await page.goto(`/visual/index.html?case=component-button&theme=light&width=400&touch=1`);
    await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
    await page.evaluate((s) => { window.__sayshape!.setSpec(`state n=0 m=0 selected=""\nstate rows=[{id: "a", name: "Laptop", price: 1200}, {id: "b", name: "Monitor", price: 350}]\n${s}`, { resetState: true }); window.__sayshape!.renderNow(); }, tall);
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} > div`).length > 6, LAYER);
  }
  // One protocol session per page: a touch is a sequence (start, moves, end) that a new session wouldn't know.
  const sessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>>();
  const touch = async (page: Page, type: "touchStart" | "touchMove" | "touchEnd", x?: number, y?: number) => {
    let cdp = sessions.get(page);
    if (!cdp) { cdp = await page.context().newCDPSession(page); sessions.set(page, cdp); }
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x!, y: y! }] });
  };
  const center = (b: { x: number; y: number; w: number; h: number }, fx = 0.2) => ({ x: b.x + b.w * fx, y: b.y + b.h / 2 });

  test("the layer takes touches over words only where touch is the main pointer", async ({ page }) => {
    await openTouch(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(await page.locator(`${LAYER} > div`).first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("auto");
    expect(await page.locator(LAYER).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await expect(page.locator(LAYER)).toHaveAttribute("aria-hidden", "true");
  });

  test("a tap on a pressable card and a pressable table row runs the action exactly once", async ({ page }) => {
    await openTouch(page);
    const heading = center(await box(page, "Pressable heading"));
    await page.touchscreen.tap(heading.x, heading.y);
    await expect.poll(() => state(page, "n")).toBe(1);
    await page.waitForTimeout(400); // a stray second press would show by now
    expect(await state(page, "n")).toBe(1);
    const row = center(await box(page, "Monitor"), 0.3);
    await page.touchscreen.tap(row.x, row.y);
    await expect.poll(() => state(page, "selected")).toBe("b");
    expect(await selection(page)).toBe("");
  });

  test("a tap on plain text does nothing, except clear a selection", async ({ page }) => {
    await openTouch(page);
    const before = await page.evaluate(() => JSON.stringify(window.__sayshape!.state.snapshot()));
    const plainLine = center(await box(page, "Weekend plan for the whole family"));
    await page.touchscreen.tap(plainLine.x, plainLine.y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => JSON.stringify(window.__sayshape!.state.snapshot()))).toBe(before);
    // With a selection showing, a tap clears it.
    await page.evaluate(() => { const el = [...document.querySelectorAll("[data-sayshape-text] > div")].find((d) => d.textContent === "Weekend plan for the whole family")!; getSelection()!.selectAllChildren(el); });
    expect(await selection(page)).toBe("Weekend plan for the whole family");
    await page.touchscreen.tap(plainLine.x, plainLine.y);
    await expect.poll(() => selection(page)).toBe("");
  });

  // Headless Chromium's touch emulation never starts the browser's own long-press selection (not even on a
  // plain <div>), so these check what the layer is responsible for: a long press reaches the words, and
  // presses nothing. That the word gets selected is on the manual checklist for real phones.
  test("a long press on plain text presses nothing and leaves the state alone", async ({ page }) => {
    await openTouch(page);
    const before = await page.evaluate(() => JSON.stringify(window.__sayshape!.state.snapshot()));
    const p = center(await box(page, "Weekend plan for the whole family"), 0.1);
    await touch(page, "touchStart", p.x, p.y);
    await page.waitForTimeout(900);
    await touch(page, "touchEnd");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => JSON.stringify(window.__sayshape!.state.snapshot()))).toBe(before);
  });

  test("a long press on a pressable card does not run the action", async ({ page }) => {
    await openTouch(page);
    const p = center(await box(page, "Pressable heading"), 0.1);
    await touch(page, "touchStart", p.x, p.y);
    await page.waitForTimeout(900);
    await touch(page, "touchEnd");
    await page.waitForTimeout(300);
    expect(await state(page, "n")).toBe(0);
  });

  test("a long press on a pressable table row does not press the row", async ({ page }) => {
    await openTouch(page);
    const p = center(await box(page, "Monitor"), 0.3);
    await touch(page, "touchStart", p.x, p.y);
    await page.waitForTimeout(900);
    await touch(page, "touchEnd");
    await page.waitForTimeout(300);
    expect(await state(page, "selected")).toBe("");
  });

  test("a vertical swipe that starts on text scrolls the page and selects nothing", async ({ page }) => {
    await openTouch(page);
    const p = center(await box(page, "Weekend plan for the whole family"), 0.3);
    const y0 = await page.evaluate(() => window.scrollY);
    await touch(page, "touchStart", p.x, p.y);
    for (let i = 1; i <= 8; i++) { await touch(page, "touchMove", p.x, p.y - i * 25); await page.waitForTimeout(16); }
    await touch(page, "touchEnd");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(y0 + 50);
    expect(await selection(page)).toBe("");
    expect(await state(page, "n")).toBe(0);
  });

  test("a button still works by touch", async ({ page }) => {
    await openTouch(page);
    const at = await page.evaluate(() => {
      const h = window.__sayshape!.hitRegions.find((x) => x.box.node.type === "button")!;
      const r = document.querySelector("canvas")!.getBoundingClientRect();
      return { x: r.left + h.box.x + h.box.w / 2, y: r.top + h.box.y + h.box.h / 2 };
    });
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => state(page, "m")).toBe(1);
  });

  test("copying a touch selection of table cells gives tab-separated cells, one row per line", async ({ page }) => {
    await openTouch(page);
    const result = await page.evaluate(() => {
      const divs = [...document.querySelectorAll<HTMLElement>("[data-sayshape-text] > div")];
      const find = (t: string) => divs.filter((d) => d.textContent === t).pop()!;
      const a = find("Laptop"), b = find("$350");
      getSelection()!.setBaseAndExtent(a.firstChild!, 0, b.firstChild!, b.textContent!.length);
      const data = new DataTransfer();
      const ev = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return data.getData("text/plain");
    });
    expect(result).toBe("Laptop\t$1,200\nMonitor\t$350");
  });

  test("by default the layer takes no touches, whatever the device", async ({ page }) => {
    await page.goto(`/visual/index.html?case=component-button&theme=light&width=400`);
    await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
    await page.evaluate((s) => { window.__sayshape!.setSpec(s); window.__sayshape!.renderNow(); }, `text "Hello there"\n`);
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} > div`).length > 0, LAYER);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(await page.locator(`${LAYER} > div`).first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  });
});
