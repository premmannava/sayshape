// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domTextLayer, highlightCss, TEXT_LAYER_MARK } from "../src/text-layer/dom";
import type { TextLayerHost, TextLayerInfo, TextLine } from "../src/text-layer/host";

const info: TextLayerInfo = { width: 400, height: 300, accent: "#0f766e", forcedColors: false };
const line = (key: string, text: string, x: number, y: number, extra: Partial<TextLine> = {}): TextLine => ({
  key, text, x, y, w: text.length * 8, h: 20, font: "400 15px sans-serif", block: key, ...extra,
});

describe("the browser text layer", () => {
  let canvas: HTMLCanvasElement;
  let host: TextLayerHost;
  const layer = () => document.querySelector<HTMLElement>(`[${TEXT_LAYER_MARK}]`)!;
  const nodes = () => [...layer().querySelectorAll<HTMLElement>(":scope > div")];

  beforeEach(() => {
    document.body.innerHTML = "<div id=app></div>";
    canvas = document.createElement("canvas");
    document.getElementById("app")!.append(canvas);
    host = domTextLayer(canvas);
  });
  afterEach(() => host.destroy());

  it("sits right after the canvas, hidden from assistive technology and from the pointer", () => {
    expect(canvas.nextElementSibling).toBe(layer());
    expect(layer().getAttribute("aria-hidden")).toBe("true");
    expect(layer().style.pointerEvents).toBe("none");
    expect(layer().style.color).toBe("transparent");
    host.update([line("a", "Hello", 10, 20)], info);
    expect(layer().style.width).toBe("400px");
    expect(layer().style.height).toBe("300px");
  });

  it("holds one real text node per line, at the drawn place, font and line height", () => {
    host.update([line("a", "Hello", 10, 20), line("b", "World wide", 14, 44, { font: "600 28px serif", h: 36 })], info);
    const [a, b] = nodes();
    expect(a!.textContent).toBe("Hello");
    expect([a!.style.left, a!.style.top, a!.style.width, a!.style.height]).toEqual(["10px", "20px", "40px", "20px"]);
    expect(a!.style.lineHeight).toBe("20px");
    expect(b!.textContent).toBe("World wide");
    expect(b!.style.font).toContain("28px");
    expect(b!.style.lineHeight).toBe("36px");
    expect(b!.style.top).toBe("44px");
  });

  it("adds no controls, buttons or inputs, and no interactive roles", () => {
    host.update([line("a", "Hello", 0, 0)], info);
    expect(layer().querySelectorAll("button, input, select, textarea, a, [role], [tabindex]")).toHaveLength(0);
  });

  it("reuses a line's node while its key stays, and drops lines that went away", () => {
    host.update([line("a", "One", 0, 0), line("b", "Two", 0, 30)], info);
    const first = nodes()[0]!;
    const text = first.firstChild;
    host.update([line("a", "One", 0, 0), line("b", "Two", 0, 30), line("c", "Three", 0, 60)], info);
    expect(nodes()).toHaveLength(3);
    expect(nodes()[0]).toBe(first);
    expect(nodes()[0]!.firstChild).toBe(text);
    host.update([line("c", "Three", 0, 60), line("a", "One!", 0, 0)], info);
    expect(nodes().map((n) => n.textContent)).toEqual(["Three", "One!"]);
    host.update([], info);
    expect(nodes()).toHaveLength(0);
  });

  it("cuts a line off where its clip ends", () => {
    host.update([line("a", "Hello", 10, 20, { clip: { x: 20, y: 0, w: 15, h: 100 } })], info);
    expect(nodes()[0]!.style.clipPath).toBe("inset(0px 15px 0px 10px)");
    host.update([line("a", "Hello", 10, 20)], info);
    expect(nodes()[0]!.style.clipPath).toBe("");
  });

  it("answers whether there is text under a point, for the cursor", () => {
    host.update([line("a", "Hello", 10, 20)], info);
    expect(host.lineAt!(12, 25)).toBe(true);
    expect(host.lineAt!(200, 200)).toBe(false);
  });

  it("only turns a drag into a selection, never a plain press or touch", () => {
    host.update([line("a", "Hello", 10, 20)], info);
    host.pointerDown!(12, 25, { pointerType: "mouse", button: 0 });
    expect(host.pointerMove!(13, 25)).toBe(false);
    expect(host.pointerUp!()).toBe(false);
    host.pointerDown!(12, 25, { pointerType: "touch", button: 0 });
    expect(host.pointerMove!(60, 25)).toBe(false);
    host.pointerDown!(12, 25, { pointerType: "mouse", button: 2 });
    expect(host.pointerMove!(60, 25)).toBe(false);
    // Pressed where there's no text: nothing to select.
    host.pointerDown!(300, 250, { pointerType: "mouse", button: 0 });
    expect(host.pointerMove!(350, 250)).toBe(false);
  });

  it("copies a selected table row as tab-separated cells", () => {
    host.update([
      line("a", "Laptop", 10, 20, { block: "t|r0|10", row: "t|r0" }),
      line("b", "$1,200.00", 120, 20, { block: "t|r0|120", row: "t|r0" }),
      line("c", "Monitor", 10, 50, { block: "t|r1|10", row: "t|r1" }),
      line("d", "$350.00", 120, 50, { block: "t|r1|120", row: "t|r1" }),
    ], info);
    const [a, , , d] = nodes();
    const range = document.createRange();
    range.setStart(a!.firstChild!, 2);
    range.setEnd(d!.firstChild!, 4);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    let copied = "";
    const event = new Event("copy", { cancelable: true, bubbles: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: (_t: string, v: string) => { copied = v; } } });
    document.dispatchEvent(event);
    expect(copied).toBe("ptop\t$1,200.00\nMonitor\t$350");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves copying alone when the selection is elsewhere on the page", () => {
    host.update([line("a", "Hello", 10, 20)], info);
    const p = document.createElement("p");
    p.textContent = "Elsewhere";
    document.body.append(p);
    const sel = document.getSelection()!;
    sel.selectAllChildren(p);
    const event = new Event("copy", { cancelable: true, bubbles: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData: () => { throw new Error("must not be set"); } } });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("removes everything it added, and stops answering copy", () => {
    host.update([line("a", "Hello", 10, 20)], info);
    host.destroy();
    expect(document.querySelector(`[${TEXT_LAYER_MARK}]`)).toBeNull();
    const event = new Event("copy", { cancelable: true, bubbles: true }) as ClipboardEvent;
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    host = domTextLayer(canvas);
  });
});

describe("the selection highlight", () => {
  it("is the theme's accent, see-through so the drawn words show, with the words themselves staying transparent", () => {
    const css = highlightCss("1", "#0f766e", false);
    expect(css).toContain(`[${TEXT_LAYER_MARK}="1"] ::selection`);
    expect(css).toContain("rgba(15,118,110,0.34)");
    expect(css).toContain("color:transparent");
  });

  it("follows a three-digit color, and any other CSS color through color-mix", () => {
    expect(highlightCss("1", "#fff", false)).toContain("rgba(255,255,255,0.34)");
    expect(highlightCss("1", "rgb(1, 2, 3)", false)).toContain("color-mix(in srgb, rgb(1, 2, 3) 34%, transparent)");
  });

  it("uses the person's own highlight colors in forced-colors modes", () => {
    const css = highlightCss("1", "#0f766e", true);
    expect(css).toContain("background:Highlight");
    expect(css).toContain("color:HighlightText");
  });
});

describe("the browser text layer on touch screens", () => {
  let canvas: HTMLCanvasElement;
  let host: TextLayerHost;
  const seen: Array<{ type: string; x: number; y: number }> = [];
  const nodes = () => [...document.querySelectorAll<HTMLElement>(`[${TEXT_LAYER_MARK}] > div`)];

  /** A pointer event as a touch screen sends it, from a line of the layer. */
  const fire = (el: Element, type: string, x: number, y: number, pointerType = "touch") => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.assign(e, { pointerId: 7, pointerType, isPrimary: true });
    el.dispatchEvent(e);
  };

  const make = (touch: boolean | undefined, coarse = true) => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: coarse && q.includes("coarse"), addEventListener() {}, removeEventListener() {} });
    document.body.innerHTML = "<div id=app></div>";
    canvas = document.createElement("canvas");
    document.getElementById("app")!.append(canvas);
    seen.length = 0;
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) canvas.addEventListener(t, (e) => seen.push({ type: t, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }));
    host = domTextLayer(canvas, touch === undefined ? {} : { touch });
    host.update([line("a", "Hello there", 10, 20)], info);
  };
  afterEach(() => { host.destroy(); vi.useRealTimers(); });

  it("takes touches over words only when asked to and touch is the main pointer", () => {
    make(undefined);
    expect(nodes()[0]!.style.pointerEvents).toBe("");
    host.destroy();
    make(true, false);
    expect(nodes()[0]!.style.pointerEvents).toBe("");
    host.destroy();
    make(true);
    expect(nodes()[0]!.style.pointerEvents).toBe("auto");
    expect(nodes()[0]!.style.touchAction).toBe("pan-y pinch-zoom");
    expect(host.surface).toBe(document.querySelector(`[${TEXT_LAYER_MARK}]`));
  });

  it("passes a tap on as one press and release on the canvas", () => {
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30); fire(el, "pointerup", 30, 30);
    expect(seen).toEqual([{ type: "pointerdown", x: 30, y: 30 }, { type: "pointerup", x: 30, y: 30 }]);
  });

  it("passes nothing on for a long press, and nothing at its release", () => {
    vi.useFakeTimers();
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30);
    vi.advanceTimersByTime(700);
    fire(el, "pointerup", 30, 30);
    expect(seen).toEqual([]);
  });

  it("passes nothing on when the browser takes the gesture before anything moved (its selection, a pinch)", () => {
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30);
    fire(el, "pointercancel", 30, 30);
    expect(seen).toEqual([]);
  });

  it("replays a swipe from where the finger went down, and its end", () => {
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30);
    fire(el, "pointermove", 31, 33); // within the slop: still waiting
    expect(seen).toEqual([]);
    fire(el, "pointermove", 30, 60);
    fire(el, "pointermove", 30, 90);
    fire(el, "pointerup", 30, 90);
    expect(seen.map((s) => s.type)).toEqual(["pointerdown", "pointermove", "pointermove", "pointerup"]);
    expect(seen[0]).toEqual({ type: "pointerdown", x: 30, y: 30 });
  });

  it("finishes a swipe the browser takes over (a page scroll) with a cancel", () => {
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30); fire(el, "pointermove", 30, 70); fire(el, "pointercancel", 30, 70);
    expect(seen.map((s) => s.type)).toEqual(["pointerdown", "pointermove", "pointercancel"]);
  });

  it("a second finger (a pinch) presses nothing", () => {
    make(true);
    const el = nodes()[0]!;
    fire(el, "pointerdown", 30, 30);
    fire(el, "pointerdown", 60, 30);
    fire(el, "pointerup", 60, 30);
    expect(seen).toEqual([]);
  });

  it("only a finger's long press may start the browser's own selection", () => {
    make(true);
    const mouse = new Event("selectstart", { cancelable: true, bubbles: true });
    fire(nodes()[0]!, "pointerdown", 30, 30, "mouse");
    nodes()[0]!.dispatchEvent(mouse);
    expect(mouse.defaultPrevented).toBe(true);
    const finger = new Event("selectstart", { cancelable: true, bubbles: true });
    fire(nodes()[0]!, "pointerdown", 30, 30, "touch");
    nodes()[0]!.dispatchEvent(finger);
    expect(finger.defaultPrevented).toBe(false);
  });
});
