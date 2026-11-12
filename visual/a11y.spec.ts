/**
 * The accessibility mirror in a real browser (src/a11y/dom.ts): an axe
 * audit of what screen readers get, and the keyboard and screen reader
 * paths that go through it. No baselines.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cases } from "./cases";
import { examples as siteExamples } from "../site/examples/catalog";

const MIRROR = "[data-sayshape-a11y]";

async function open(page: Page, spec: string): Promise<void> {
  await page.goto(`/visual/index.html?case=component-button&theme=light&width=600`);
  await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
  await page.evaluate((s) => { window.__sayshape!.setSpec(s, { resetState: true }); window.__sayshape!.renderNow(); }, spec);
}

const state = (page: Page, key: string) => page.evaluate((k) => window.__sayshape!.state.get(k), key);

/** What has DOM focus: its role (or tag) and its name. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    return { inMirror: !!el.closest("[data-sayshape-a11y]"), role: el.getAttribute("role") ?? el.tagName.toLowerCase(), name: el.getAttribute("aria-label") ?? el.textContent };
  });

async function audit(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).include(MIRROR).analyze();
  const problems = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(problems).toEqual([]);
}

const form = `state n=0 agreed=false price=120
text "Checkout" style=title
button "Add one" on=inc:n
check "I agree to the terms" bind=agreed
slider "Up to {price}" bind=price min=20 max=300 step=10
button "Place order" on=notify:Placed`;

test("the mirror sits over the canvas, invisible, with a node per element", async ({ page }) => {
  await open(page, form);
  const info = await page.evaluate((sel) => {
    const m = document.querySelector(sel) as HTMLElement;
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    const mr = m.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const buttons = [...m.querySelectorAll("button")].map((b) => b.textContent);
    return { sameBox: [mr.left, mr.top, mr.width, mr.height].join() === [cr.left, cr.top, cr.width, cr.height].join(), pointer: getComputedStyle(m).pointerEvents, buttons };
  }, MIRROR);
  expect(info.sameBox).toBe(true);
  expect(info.pointer).toBe("none");
  expect(info.buttons).toEqual(expect.arrayContaining(["Add one", "Place order"]));
});

test("axe finds nothing wrong in the mirror", async ({ page }) => {
  await open(page, form);
  await audit(page);
});

test("the mouse still reaches the canvas through the mirror", async ({ page }) => {
  await open(page, form);
  const at = await page.evaluate(() => {
    const s = window.__sayshape!;
    s.renderNow();
    const b = s.hitRegions.find((h) => h.box.node.text === "Add one")!.box;
    const r = (document.getElementById("canvas") as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left + b.x + b.w / 2, y: r.top + b.y + b.h / 2 };
  });
  await page.mouse.click(at.x, at.y);
  expect(await state(page, "n")).toBe(1);
});

test("Tab moves DOM focus through the mirror, and keys act on what's focused", async ({ page }) => {
  await open(page, form);
  await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).focus());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toEqual({ inMirror: true, role: "button", name: "Add one" });
  await page.keyboard.press("Enter");
  expect(await state(page, "n")).toBe(1);
  await page.keyboard.press("Tab");
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "I agree to the terms" });
  await page.keyboard.press("Space");
  expect(await state(page, "agreed")).toBe(true);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  expect(await state(page, "price")).toBe(130);
});

test("Tab past the last element leaves the interface, and Shift+Tab before the first", async ({ page }) => {
  await open(page, `button "Only" on=inc:n`);
  await page.evaluate(() => {
    for (const where of ["beforebegin", "afterend"] as const) {
      const b = document.createElement("button");
      b.textContent = where === "beforebegin" ? "Before" : "After";
      document.getElementById("frame")!.insertAdjacentElement(where, b);
    }
  });
  await page.getByRole("button", { name: "Before" }).focus();
  await page.keyboard.press("Tab");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "Only" });
  await page.keyboard.press("Tab");
  expect(await focused(page)).toMatchObject({ inMirror: false, name: "After" });
  await page.keyboard.press("Shift+Tab");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "Only" });
  await page.keyboard.press("Shift+Tab");
  expect(await focused(page)).toMatchObject({ inMirror: false, name: "Before" });
});

/**
 * Buttons before and after the interface, and a note of what has DOM focus
 * once the canvas's own focus event is handled (listening after the engine,
 * in the same event, so no frame can run in between).
 */
async function enterFromOutside(page: Page): Promise<void> {
  await open(page, `button "First" on=inc:n\nbutton "Middle" on=inc:n\nbutton "Last" on=inc:n`);
  await page.evaluate(() => {
    for (const where of ["beforebegin", "afterend"] as const) {
      const b = document.createElement("button");
      b.textContent = where === "beforebegin" ? "Before" : "After";
      document.getElementById("frame")!.insertAdjacentElement(where, b);
    }
    const w = window as unknown as { onEntry?: string };
    document.getElementById("canvas")!.addEventListener("focus", () => { const el = document.activeElement; w.onEntry = el?.getAttribute("aria-label") ?? el?.textContent ?? ""; });
  });
}
const onEntry = (page: Page) => page.evaluate(() => (window as unknown as { onEntry?: string }).onEntry);

test("Tab into the interface lands on its first element at once, never on the bare canvas", async ({ page }) => {
  await enterFromOutside(page);
  await page.getByRole("button", { name: "Before" }).focus();
  await page.keyboard.press("Tab");
  expect(await onEntry(page)).toBe("First");
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "First" });
});

test("Shift+Tab back into the interface lands on its last element", async ({ page }) => {
  await enterFromOutside(page);
  await page.getByRole("button", { name: "After" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await onEntry(page)).toBe("Last");
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "Last" });
  await page.keyboard.press("Shift+Tab");
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "Middle" });
});

test("a screen reader's activation presses the element", async ({ page }) => {
  await open(page, form);
  await page.evaluate((sel) => (document.querySelector(`${sel} button`) as HTMLButtonElement).click(), MIRROR);
  expect(await state(page, "n")).toBe(1);
});

test("a notify: message reaches the polite live region", async ({ page }) => {
  await open(page, form);
  await page.evaluate((sel) => ([...document.querySelectorAll(`${sel} button`)].at(-1) as HTMLButtonElement).click(), MIRROR);
  await expect(page.locator(`${MIRROR} [aria-live="polite"]`)).toHaveText("Placed");
});

// Every visual case (each component's example, every playground sample, the
// edge cases), as a screen reader gets it, audited.
for (const c of cases) {
  test(`axe finds nothing wrong in ${c.name}`, async ({ page }) => {
    await page.goto(`/visual/index.html?case=${c.name}&theme=light&width=1024`);
    await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
    await audit(page);
  });
}

test("Space on a checkbox's node toggles it once", async ({ page }) => {
  await open(page, `state agreed=false\ncheck "I agree" bind=agreed`);
  await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).focus());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toEqual({ inMirror: true, role: "input", name: "I agree" });
  await page.keyboard.press("Space");
  expect(await state(page, "agreed")).toBe(true);
  await page.keyboard.press("Space");
  expect(await state(page, "agreed")).toBe(false);
});

test("a stepper's buttons keep focus as they're pressed to the limit", async ({ page }) => {
  await open(page, `state qty=1\nstepper "Quantity" bind=qty min=1 max=3`);
  await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).focus());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toMatchObject({ inMirror: true, name: "Increase Quantity" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await state(page, "qty")).toBe(3);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toMatchObject({ inMirror: true });
  await expect(page.locator(`${MIRROR} [role="group"] [role="status"]`)).toHaveText("3");
});

test("an open select stays accessible: focus on the combobox, the highlighted option active", async ({ page }) => {
  await open(page, `state dept="eng"\nselect "Department" bind=dept items={["sales", "eng", "ops"]}`);
  await page.evaluate(() => (document.getElementById("canvas") as HTMLCanvasElement).focus());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await focused(page)).toMatchObject({ inMirror: true, role: "combobox", name: "Department" });
  await page.keyboard.press("ArrowDown");
  // The list has to be open before the second press, or that press only opens it and the highlight stays put.
  await expect(page.locator(`${MIRROR} [role="combobox"]`)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.locator(`${MIRROR} [role="combobox"]`)).toHaveAttribute("aria-expanded", "true");
  // The field points at the highlighted option, which screen readers read.
  const active = await page.evaluate((sel) => {
    const box = document.querySelector(`${sel} [role="combobox"]`)!;
    const id = box.getAttribute("aria-activedescendant");
    const opt = id ? document.getElementById(id) : null;
    return { role: opt?.getAttribute("role"), name: opt?.textContent, controls: !!document.getElementById(box.getAttribute("aria-controls") ?? "") };
  }, MIRROR);
  expect(active).toEqual({ role: "option", name: "ops", controls: true });
  await audit(page);
  await page.keyboard.press("Enter");
  expect(await state(page, "dept")).toBe("ops");
  expect(await focused(page)).toMatchObject({ inMirror: true, role: "combobox" });
});

test("tabs, pagination and a date picker pass axe", async ({ page }) => {
  await open(page, `state t=a page=2 due="2026-10-21"
tabs bind=t
  tab "A" value=a
    text "First"
  tab "B" value=b
    text "Second"
pagination bind=page pages=5
breadcrumb "Home / Shoes" bind=t
date-picker "Due" bind=due`);
  await audit(page);
  // And with the calendar open.
  await page.evaluate(() => {
    const s = window.__sayshape!;
    s.renderNow();
    const h = s.hitRegions.find((r) => r.box.node.type === "date-picker")!;
    s.activate({ node: h.box.node, box: h.box });
    s.renderNow();
  });
  await audit(page);
});

test("in a forced-colors mode the interface draws in the person's system colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, `button "Go" on=notify:Hi`);
  const seen = await page.evaluate(() => {
    const s = window.__sayshape!;
    const probe = document.createElement("span");
    probe.style.color = "Canvas";
    document.body.append(probe);
    const canvas = getComputedStyle(probe).color;
    probe.remove();
    return { name: s.theme.name, surface: s.theme.colors.surface, canvas };
  });
  expect(seen.name).toMatch(/forced-colors$/);
  expect(seen.surface).toBe(seen.canvas);
  await page.emulateMedia({ forcedColors: "none" });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await page.evaluate(() => window.__sayshape!.theme.name)).not.toMatch(/forced-colors$/);
});

// The website's example gallery, as a screen reader gets it.
for (const ex of siteExamples) {
  test(`axe finds nothing wrong in the site example ${ex.id}`, async ({ page }) => {
    await open(page, ex.spec);
    await audit(page);
  });
}
