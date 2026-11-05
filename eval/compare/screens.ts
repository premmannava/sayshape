/**
 * One way to look at and use a screen, whichever format drew it, so every
 * benchmark check runs the same steps on SayShape and on HTML:
 *
 * - SayShape renders with the real engine in Node (src/testing). Text is what
 *   the canvas drew; pressing clicks the centre of a pressable region.
 * - HTML runs in jsdom with its scripts on. Text is what's visible (not inside
 *   <script>, <style> or display:none), plus text drawn on a <canvas> and the
 *   labels of Chart.js charts, which a stand-in Chart records, since jsdom has
 *   no canvas and loads nothing from the network.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { render, type Rendered } from "../../src/testing";

export interface Screen {
  /** Visible text, one entry per piece (a line on canvas, a text node in HTML). */
  text(): string[];
  /** Type into the nth text field (0 = first). False when there isn't one. */
  type(nth: number, value: string): Promise<boolean>;
  /** Press the smallest pressable thing whose text matches. False when nothing matches. */
  press(label: RegExp): Promise<boolean>;
  /** Problems found while loading or using the screen (script errors, parse errors). */
  readonly errors: string[];
  /** HTML only: whether text from the data became live markup (an injected element). */
  injected(): boolean;
  destroy(): void;
}

const FIELD_TYPES = new Set(["input"]);

/** A SayShape spec rendered by the real engine. Errors are its error-level diagnostics. */
export function sayshapeScreen(spec: string): Screen {
  const ui: Rendered = render(spec, { components: [...coreComponents, ...mapComponents], width: 600, today: "2026-11-04" });
  const errors = ui.diagnostics.filter((d) => d.severity === "error").map((d) => `line ${d.line}: ${d.message}`);

  // Text drawn inside a region, for regions with no text of their own (table headers, segmented options).
  const piecesIn = (b: { x: number; y: number; w: number; h: number }): string[] =>
    ui.drawOps
      .filter((o) => o.op === "fillText")
      .filter((o) => {
        const x = Number(o.args[1]), y = Number(o.args[2]);
        return x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1;
      })
      .map((o) => String(o.args[0]));
  // A point near text matching the label, drawn inside b, where the engine's hit test names that part.
  const partAt = (b: { x: number; y: number; w: number; h: number }, label: RegExp): [number, number] | null => {
    const texts = ui.drawOps.filter((o) => o.op === "fillText" && label.test(String(o.args[0])));
    for (const o of texts) {
      const tx = Number(o.args[1]), ty = Number(o.args[2]);
      if (tx < b.x - 1 || tx > b.x + b.w + 1 || ty < b.y - 1 || ty > b.y + b.h + 1) continue;
      for (let dx = 0; dx <= 40; dx += 2) for (let dy = -8; dy <= 8; dy += 2) {
        const t = ui.sayshape.targetAt(tx - dx, ty + dy);
        if (t && typeof t.detail === "string" && label.test(t.detail)) return [tx - dx, ty + dy];
      }
    }
    return null;
  };
  // Each piece on its own and all together: a popup's option sits over other text, and a label can span pieces.
  const labelsIn = (b: { x: number; y: number; w: number; h: number }): string[] => { const p = piecesIn(b); return [...p, p.join(" ")]; };

  /**
   * Text that isn't pressable itself but holds one check or switch (a list-item with a Done box
   * under its title): that box, as a person would tick it. The HTML screen does the same for rows.
   */
  const checkUnder = (label: RegExp) => {
    const within = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
    for (const f of ui.findAll({}).filter((x) => x.box && x.shownText !== undefined && label.test(x.shownText))) {
      const boxes = ui.hits.filter((h) => (h.box.node.type === "check" || h.box.node.type === "switch") && within(h.box, f.box!));
      if (boxes.length === 1) return boxes[0];
    }
    return undefined;
  };

  /** Choose an option by its text in any select on screen: open it, press the option, or close it again. */
  const chooseOption = (label: RegExp): boolean => {
    for (const f of ui.findAll("select").filter((x) => x.box)) {
      const b = f.box!;
      ui.click(b.x + b.w / 2, b.y + b.h - 18);
      ui.sayshape.renderNow();
      const option = ui.popup?.regions.find((r) => piecesIn(r.box).some((t) => label.test(t)));
      if (option) {
        ui.click(option.box.x + option.box.w / 2, option.box.y + option.box.h / 2);
        ui.sayshape.renderNow();
        return true;
      }
      if (ui.popup) { ui.key("Escape"); ui.sayshape.renderNow(); }
    }
    return false;
  };

  return {
    errors,
    text: () => ui.text(),
    async type(nth, value) {
      const field = ui.findAll({}).filter((f) => f.box && FIELD_TYPES.has(f.node.type))[nth];
      if (!field) return false;
      ui.type({ id: field.node.id }, value, { replace: true });
      ui.key("Escape");
      return true;
    },
    async press(label) {
      const matches = ui.hits
        .map((h) => {
          // A part's name, without an internal prefix: "sort:rating" is the Rating header, even when its text is cut to "Rati…".
          const detail = typeof h.detail === "string" || typeof h.detail === "number" ? String(h.detail).replace(/^[a-z]+:/, "") : "";
          const own = ui.findAll({ id: h.box.node.id })[0]?.shownText ?? "";
          // Each source on its own, so ^…$ patterns work: the element's text, its part's name, or text drawn inside it.
          return { h, labels: [own, detail, ...labelsIn(h.box)].filter(Boolean) };
        })
        .filter((m) => m.labels.some((l) => label.test(l)))
        .sort((a, b) => a.h.box.w * a.h.box.h - b.h.box.w * b.h.box.h);
      const hit = matches[0]?.h ?? checkUnder(label);
      if (hit) {
        // A part drawn inside a bigger element (a map's pin): click where the engine reports that part, not the element's centre.
        const at = partAt(hit.box, label) ?? [hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2];
        ui.click(at[0], at[1]);
        ui.sayshape.renderNow();
        return true;
      }
      return chooseOption(label);
    },
    injected: () => false,
    destroy: () => ui.destroy(),
  };
}

/** Script set up before the model's HTML: stand-ins for what jsdom lacks. */
const SHIMS = `
window.__drawn = [];
window.__charts = [];
window.matchMedia = window.matchMedia || function (q) { return { matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }; };
window.ResizeObserver = window.ResizeObserver || function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
window.IntersectionObserver = window.IntersectionObserver || function () { return { observe() {}, unobserve() {}, disconnect() {} }; };
window.HTMLCanvasElement.prototype.getContext = function () {
  const drawn = window.__drawn;
  const canvas = this;
  const target = { canvas, measureText: (t) => ({ width: String(t).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    fillText: (t) => drawn.push(String(t)), strokeText: (t) => drawn.push(String(t)),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    getImageData: () => ({ data: [] }), getLineDash: () => [], getTransform: () => ({}) };
  return new Proxy(target, { get: (o, k) => (k in o ? o[k] : typeof k === "string" ? function () {} : undefined), set: () => true });
};
window.Chart = function (el, config) {
  const data = (config && config.data) || {};
  const pieces = [].concat(data.labels || []);
  (data.datasets || []).forEach(function (d) { if (d.label) pieces.push(d.label); (d.data || []).forEach(function (v) { if (typeof v === "number") pieces.push(String(v)); }); });
  const chart = { config: config, data: data, options: (config && config.options) || {}, pieces: pieces,
    update: function () { chart.pieces = [].concat(chart.data.labels || []); (chart.data.datasets || []).forEach(function (d) { if (d.label) chart.pieces.push(d.label); (d.data || []).forEach(function (v) { if (typeof v === "number") chart.pieces.push(String(v)); }); }); },
    destroy: function () { const i = window.__charts.indexOf(chart); if (i >= 0) window.__charts.splice(i, 1); }, resize: function () {} };
  window.__charts.push(chart);
  return chart;
};
window.Chart.register = function () {}; window.Chart.defaults = { plugins: { legend: {}, tooltip: {} }, scale: { grid: {}, ticks: {} }, font: {}, color: "" };
`;

/** Markup that only exists when text from data was inserted as HTML. */
const INJECTED = "[onerror], [onload], [onclick][data-pwn], script[data-pwn], img[src='x']";

/** An HTML fragment run in jsdom. Errors are uncaught script errors and errors logged to the console. */
export async function htmlScreen(html: string): Promise<Screen> {
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e: Error) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  vc.on("error", (...a: unknown[]) => errors.push(a.map(String).join(" ")));
  // External scripts (a CDN's Chart.js) aren't fetched: the stand-in Chart is already there.
  const body = html.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, "");
  const dom = new JSDOM(`<!doctype html><html><head><script>${SHIMS}</script></head><body>${body}</body></html>`, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "https://bench.invalid/",
  });
  const w = dom.window, d = w.document;
  w.addEventListener("error", (e) => errors.push(e.message));
  await settle(w);

  const visible = (): string[] => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) { const t = n.textContent?.trim(); if (t) out.push(t); return; }
      if (n.nodeType !== 1) return;
      const el = n as Element;
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName)) return;
      if (w.getComputedStyle(el).display === "none" || el.hasAttribute("hidden")) return;
      // A field's value is visible text too (an input showing a computed result).
      if (el.tagName === "INPUT" && /^(text|number|search|email|)$/.test((el as HTMLInputElement).type) && (el as HTMLInputElement).value) out.push((el as HTMLInputElement).value);
      if (el.tagName === "OUTPUT" && !el.textContent) out.push((el as HTMLOutputElement).value);
      el.childNodes.forEach(walk);
    };
    walk(d.body);
    const charts = (w as unknown as { __charts: Array<{ pieces: string[] }> }).__charts.flatMap((c) => c.pieces);
    return [...out, ...(w as unknown as { __drawn: string[] }).__drawn, ...charts];
  };

  const pressable = "button, [role=button], [role=tab], [role=radio], [role=option], [role=switch], [onclick], a, label, summary, th, tr, li, input[type=checkbox], input[type=radio], input[type=submit], input[type=button], [tabindex], svg g, svg text, svg circle, svg path, svg rect";

  return {
    errors,
    text: visible,
    async type(nth, value) {
      const fields = [...d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], textarea")]
        .filter((f) => w.getComputedStyle(f).display !== "none");
      const f = fields[nth];
      if (!f) return false;
      f.focus();
      f.value = value;
      for (const ev of ["input", "keyup", "change"]) f.dispatchEvent(new w.Event(ev, { bubbles: true }));
      await pause();
      return true;
    },
    async press(label) {
      // Text with a space between elements, so a row reads "A3 Initech", not "A3Initech".
      // A dropdown's options aren't part of the text around it: they're chosen, not pressed.
      const spaced = (el: Element): string => [...el.childNodes].map((n) => (n.nodeType === 3 ? n.textContent ?? "" : n.nodeType === 1 && (n as Element).tagName !== "SELECT" ? spaced(n as Element) : "")).join(" ");
      const labels = (el: Element) => [spaced(el), el.getAttribute("aria-label") ?? "", el.tagName === "INPUT" ? (el as HTMLInputElement).value : "", el.getAttribute("title") ?? "", el.id ? d.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : ""]
        .map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
      const matching = [...d.querySelectorAll(pressable)].filter((el) => !(el as HTMLButtonElement).disabled && labels(el).some((l) => label.test(l)));
      // The innermost match: a button inside a header cell, not the cell; a label inside a list row, not the row.
      const candidates = matching
        .filter((el) => !matching.some((other) => other !== el && el.contains(other)))
        .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
      let el = candidates[0] as HTMLElement | undefined;
      // A row or item that isn't a control itself but holds one checkbox: tick the checkbox, as a person would.
      if (el && !el.matches("button, input, label, a, select, summary, [role=button], [role=switch], [role=tab], [role=radio], [role=option], [role=checkbox]")) {
        const boxes = el.closest("tr, li, [role=row]")?.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
        if (boxes?.length === 1) el = boxes[0]!;
      }
      if (el) {
        // SVG shapes (a map's pins, a chart's marks) have no click(): send the event a person's click would.
        if (typeof el.click === "function") el.click();
        else el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
        await pause();
        return true;
      }
      // Otherwise choose a matching option in a dropdown, as a person would.
      for (const sel of d.querySelectorAll("select")) {
        const opt = [...sel.options].find((o) => label.test(o.textContent?.replace(/\s+/g, " ").trim() ?? ""));
        if (!opt || sel.disabled) continue;
        sel.value = opt.value;
        for (const ev of ["input", "change"]) sel.dispatchEvent(new w.Event(ev, { bubbles: true }));
        await pause();
        return true;
      }
      return false;
    },
    injected: () => d.querySelector(INJECTED) !== null,
    destroy: () => w.close(),
  };
}

/** Let load handlers, timers of 0 and animation frames run. */
async function settle(w: import("jsdom").DOMWindow): Promise<void> {
  if (w.document.readyState !== "complete") await new Promise<void>((r) => w.addEventListener("load", () => r(), { once: true }));
  await pause();
}

/** Long enough for a timer of 0 and an animation frame (about 16 ms with pretendToBeVisual). */
const pause = () => new Promise((r) => setTimeout(r, 40));
