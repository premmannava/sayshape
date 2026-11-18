// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SayShape, coreComponents, darkTheme, lightTheme } from "../src/index";
import { createRecordingContext, ensurePath2D } from "../src/testing/canvas";
import "../src/element";
import { dedent, type SayShapeElement } from "../src/element";

// jsdom has no canvas 2D context and no matchMedia: give the engine stand-ins.
beforeAll(() => {
  ensurePath2D();
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = () => createRecordingContext().context;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).matchMedia = (media: string) => ({
    matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
});

const COUNTER = `state n=0
button "Add" on=inc:n
text "Count {n}"`;

const flush = () => new Promise<void>((r) => queueMicrotask(r));

function mount(attrs: Record<string, string> = {}, props: Partial<Record<string, unknown>> = {}): SayShapeElement {
  const el = document.createElement("say-shape");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.assign(el, props);
  document.body.append(el);
  return el;
}

/** Press the first button by sending the engine pointer events over its hit region. */
function pressButton(el: SayShapeElement): void {
  const engine = el.engine!;
  engine.renderNow();
  const region = engine.hitRegions.find((h) => h.box.node.type === "button");
  if (!region) throw new Error("no button drawn");
  const x = region.box.x + region.box.w / 2, y = region.box.y + region.box.h / 2;
  const canvas = engine.canvas;
  for (const type of ["pointermove", "pointerdown", "pointerup"]) {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    Object.assign(e, { pointerId: 1, pointerType: "mouse" });
    canvas.dispatchEvent(e);
  }
  engine.renderNow();
}

/** Record every unsubscribe the engine hands out, to see them all called on teardown. */
function trackUnsubscribes() {
  const original = SayShape.prototype.on;
  const offs: Array<ReturnType<typeof vi.fn>> = [];
  vi.spyOn(SayShape.prototype, "on").mockImplementation(function (this: SayShape, name: never, fn: never) {
    const off = vi.fn(original.call(this, name, fn));
    offs.push(off);
    return off;
  } as typeof SayShape.prototype.on);
  return offs;
}

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

describe("<say-shape>", () => {
  it("renders a spec from the property, the attribute and a child script", async () => {
    const byProp = mount({}, { spec: 'text "From property"' });
    expect(byProp.engine!.copyText()).toBe("");
    byProp.engine!.renderNow();
    expect(byProp.engine!.copyText()).toContain("From property");

    const byAttr = mount({ spec: 'text "From attribute"' });
    byAttr.engine!.renderNow();
    expect(byAttr.engine!.copyText()).toContain("From attribute");

    const el = document.createElement("say-shape");
    el.innerHTML = `<script type="text/sayshape">
      text "From script"
    </script>`;
    document.body.append(el);
    el.engine!.renderNow();
    expect(el.engine!.copyText()).toContain("From script");
    expect(el.engine!.diagnostics).toEqual([]);
    await flush();
  });

  it("follows changes to the script child's text", async () => {
    const el = document.createElement("say-shape");
    el.innerHTML = `<script type="text/sayshape">text "One"</script>`;
    document.body.append(el);
    el.querySelector("script")!.textContent = 'text "Two"';
    await new Promise((r) => setTimeout(r, 0));
    el.engine!.renderNow();
    expect(el.engine!.copyText()).toContain("Two");
  });

  it("dedents a script's spec", () => {
    expect(dedent("\n    card\n      text \"a\"\n    \n")).toBe('card\n  text "a"');
  });

  it("prefers a property over the attribute", () => {
    const el = mount({ spec: 'text "attr"' }, { spec: 'text "prop"' });
    expect(el.engine!.spec).toBe('text "prop"');
  });

  it("keeps state when the spec changes", async () => {
    const el = mount({}, { spec: COUNTER });
    pressButton(el);
    expect(el.engine!.state.get("n")).toBe(1);
    const setSpec = vi.spyOn(el.engine!, "setSpec");
    el.spec = COUNTER + '\ntext "more"';
    await flush();
    expect(setSpec).toHaveBeenCalledWith(COUNTER + '\ntext "more"', { resetState: false });
    expect(el.engine!.state.get("n")).toBe(1);
  });

  it("skips a spec that didn't change", async () => {
    const el = mount({}, { spec: COUNTER });
    const setSpec = vi.spyOn(el.engine!, "setSpec");
    el.spec = COUNTER;
    el.setAttribute("theme", "auto");
    await flush();
    expect(setSpec).not.toHaveBeenCalled();
  });

  it("resets state on a spec change with reset-state-on-change", async () => {
    const el = mount({ "reset-state-on-change": "" }, { spec: COUNTER });
    pressButton(el);
    expect(el.engine!.state.get("n")).toBe(1);
    el.spec = COUNTER + '\ntext "more"';
    await flush();
    el.engine!.renderNow(); // a reset state is declared again when the spec is read
    expect(el.engine!.state.get("n")).toBe(0);
  });

  it("resets state with the resetStateOnChange property", async () => {
    const el = mount({}, { spec: COUNTER, resetStateOnChange: true });
    pressButton(el);
    el.spec = COUNTER + '\ntext "more"';
    await flush();
    el.engine!.renderNow(); // a reset state is declared again when the spec is read
    expect(el.engine!.state.get("n")).toBe(0);
  });

  it("streams: begins once and pushes only the new text", async () => {
    const el = mount({ streaming: "" }, { spec: "" });
    const engine = el.engine!;
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    const end = vi.spyOn(engine, "endStream");
    el.spec = 'text "A"\n';
    await flush();
    el.spec = 'text "A"\ntext "B"\n';
    await flush();
    el.spec = 'text "A"\ntext "B"\ntext "C"';
    await flush();
    expect(push.mock.calls.map((c) => c[0])).toEqual(['text "A"\n', 'text "B"\n', 'text "C"']);
    expect(engine.isStreaming).toBe(true);
    expect(end).not.toHaveBeenCalled();
    el.removeAttribute("streaming");
    await flush();
    expect(end).toHaveBeenCalledTimes(1);
    expect(engine.isStreaming).toBe(false);
    // The first call began the stream (it was already on when the element connected).
    expect(begin.mock.calls.length).toBe(0);
    engine.renderNow();
    expect(engine.copyText()).toContain("C");
  });

  it("restarts the stream when the text shrinks or stops being a prefix", async () => {
    const el = mount({ streaming: "" }, { spec: 'text "one"\ntext "two"\n' });
    const engine = el.engine!;
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    el.spec = 'text "one"\n';
    await flush();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith('text "one"\n');
    el.spec = 'text "other"\n';
    await flush();
    expect(begin).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith('text "other"\n');
    expect(engine.spec).toBe('text "other"\n');
  });

  it("turning streaming on for an existing spec starts a stream that keeps state", async () => {
    const el = mount({}, { spec: COUNTER });
    pressButton(el);
    el.streaming = true;
    await flush();
    expect(el.engine!.isStreaming).toBe(true);
    expect(el.engine!.state.get("n")).toBe(1);
  });

  it("re-dispatches an emit: action as a bubbling sayshape-action event", () => {
    const el = mount({}, { spec: 'button "Send" on=emit:sent:5' });
    const seen: Array<CustomEvent> = [];
    document.body.addEventListener("sayshape-action", (e) => seen.push(e as CustomEvent));
    pressButton(el);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.detail.name).toBe("sent");
    expect(seen[0]!.detail.value).toBe(5);
    expect(seen[0]!.bubbles).toBe(true);
  });

  it("dispatches change, diagnostics, notify and render events", () => {
    const el = document.createElement("say-shape");
    const names: string[] = [];
    for (const n of ["change", "diagnostics", "notify", "render"]) el.addEventListener(`sayshape-${n}`, () => names.push(n));
    el.spec = 'state n=0\nbutton "Go" on=inc:n;notify:Hi\nbogus line';
    document.body.append(el);
    pressButton(el);
    expect(new Set(names)).toEqual(new Set(["change", "diagnostics", "notify", "render"]));
  });

  it("switches theme without recreating the engine", async () => {
    const el = mount({ theme: "light" }, { spec: 'text "Hi"' });
    const engine = el.engine!;
    expect(engine.theme).toBe(lightTheme);
    const setTheme = vi.spyOn(engine, "setTheme");
    el.setAttribute("theme", "dark");
    await flush();
    expect(setTheme).toHaveBeenCalledWith(darkTheme);
    expect(engine.theme).toBe(darkTheme);
    el.theme = lightTheme;
    await flush();
    expect(setTheme).toHaveBeenLastCalledWith(lightTheme);
    expect(el.engine).toBe(engine);
  });

  it("reads options and components once, at creation", async () => {
    const warn = vi.fn();
    const el = mount({}, { spec: 'text "Hi"', options: { onWarning: warn, minHeight: 321 } });
    el.engine!.renderNow();
    expect(el.engine!.canvas.style.height).toBe("321px");
    const engine = el.engine!;
    el.options = { minHeight: 999 };
    await flush();
    expect(el.engine).toBe(engine);
    expect(engine.canvas.style.height).toBe("321px");
  });

  it("keeps its state when moved in the DOM", async () => {
    const holder = document.createElement("div");
    document.body.append(holder);
    const el = mount({}, { spec: COUNTER });
    pressButton(el);
    const engine = el.engine!;
    const destroy = vi.spyOn(engine, "destroy");
    holder.append(el); // disconnect, then connect
    await flush();
    await flush();
    expect(destroy).not.toHaveBeenCalled();
    expect(el.engine).toBe(engine);
    expect(engine.state.get("n")).toBe(1);
    expect(el.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("tears down on removal: unsubscribes every listener and destroys the engine", async () => {
    const offs = trackUnsubscribes();
    const el = mount({}, { spec: COUNTER });
    const engine = el.engine!;
    expect(offs).toHaveLength(6);
    const destroy = vi.spyOn(engine, "destroy");
    el.remove();
    expect(destroy).not.toHaveBeenCalled(); // deferred to a microtask
    await flush();
    expect(destroy).toHaveBeenCalledTimes(1);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(el.engine).toBeNull();
    expect(el.querySelector("canvas")).toBeNull();
    // Nothing is dispatched any more.
    const seen = vi.fn();
    el.addEventListener("sayshape-change", seen);
    engine.state.set("n", 5);
    expect(seen).not.toHaveBeenCalled();
  });

  it("builds a new engine when reconnected after a real removal, never two on one canvas", async () => {
    const el = mount({}, { spec: COUNTER });
    const first = el.engine!;
    el.remove();
    await flush();
    document.body.append(el);
    expect(el.engine).not.toBe(first);
    expect(el.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("can be imported twice without throwing", async () => {
    vi.resetModules();
    await expect(import("../src/element")).resolves.toBeTruthy();
    expect(customElements.get("say-shape")).toBeDefined();
  });

  it("picks up a property set before the element was defined", () => {
    const el = document.createElement("div");
    document.body.append(el);
    (el as unknown as Record<string, unknown>).spec = 'text "early"';
    const named = document.createElement("say-shape");
    (named as unknown as Record<string, unknown>).theme = "dark";
    document.body.append(named);
    expect(named.engine!.theme).toBe(darkTheme);
  });

  it("keeps the engine's accessibility mirror and text layer in the page's DOM (the reason it uses light DOM)", () => {
    const el = mount({}, { spec: 'text "Hello"\nbutton "Go"' });
    el.engine!.renderNow();
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector("[data-sayshape-a11y]")).not.toBeNull();
    expect(el.querySelector("[data-sayshape-text]")).not.toBeNull();
    // Both sit next to the canvas, so document-level focus and selection can reach them.
    const canvas = el.querySelector("canvas")!;
    expect(canvas.parentElement!.querySelectorAll("[data-sayshape-a11y], [data-sayshape-text]").length).toBe(2);
    expect(document.querySelector("[role=status]")).not.toBeNull();
  });

  it("would lose the mirror's focus to a shadow root (why it isn't one)", () => {
    // The engine moves screen-reader focus with element.focus() and checks it with
    // document.activeElement (src/a11y/dom.ts). Inside a shadow root the document reports the host.
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("div");
    const canvas = document.createElement("canvas");
    wrapper.append(canvas);
    root.append(wrapper);
    const engine = new SayShape(canvas, { components: coreComponents });
    engine.setSpec('button "Go"');
    engine.renderNow();
    const button = root.querySelector<HTMLElement>("[data-sayshape-a11y] button")!;
    expect(button).not.toBeNull();
    button.focus();
    expect(root.activeElement).toBe(button);
    expect(document.activeElement).toBe(host);
    engine.destroy();

    // The same engine in the page's own DOM, as <say-shape> does it: the document sees the focused mirror element.
    const el = mount({}, { spec: 'button "Go"' });
    el.engine!.renderNow();
    const light = el.querySelector<HTMLElement>("[data-sayshape-a11y] button")!;
    light.focus();
    expect(document.activeElement).toBe(light);
  });
});
