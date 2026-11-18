// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SayShape, darkTheme, lightTheme } from "../src/index";
import { createRecordingContext, ensurePath2D } from "../src/testing/canvas";
import sayshape, { type SayShapeParams } from "../src/svelte";

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

/** Use the action the way Svelte does: on an element, with params, then update(), then destroy(). */
function use(params: SayShapeParams) {
  const node = document.createElement("div");
  document.body.append(node);
  let engine!: SayShape;
  const action = sayshape(node, { ...params, onReady: (e) => { engine = e; params.onReady?.(e); } });
  return { node, action, engine };
}

function pressButton(engine: SayShape): void {
  engine.renderNow();
  const region = engine.hitRegions.find((h) => h.box.node.type === "button")!;
  const x = region.box.x + region.box.w / 2, y = region.box.y + region.box.h / 2;
  for (const type of ["pointermove", "pointerdown", "pointerup"]) {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    Object.assign(e, { pointerId: 1, pointerType: "mouse" });
    engine.canvas.dispatchEvent(e);
  }
  engine.renderNow();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("sayshape/svelte", () => {
  it("renders a spec into the element it is used on", () => {
    const { node, engine } = use({ spec: 'text "Hello Svelte"' });
    expect(node.querySelectorAll("canvas")).toHaveLength(1);
    engine.renderNow();
    expect(engine.copyText()).toContain("Hello Svelte");
  });

  it("keeps state when the spec changes", () => {
    const base: SayShapeParams = { spec: COUNTER };
    const { action, engine } = use(base);
    pressButton(engine);
    expect(engine.state.get("n")).toBe(1);
    const setSpec = vi.spyOn(engine, "setSpec");
    action.update({ ...base, spec: COUNTER + '\ntext "more"' });
    expect(setSpec).toHaveBeenCalledWith(COUNTER + '\ntext "more"', { resetState: false });
    engine.renderNow();
    expect(engine.state.get("n")).toBe(1);
  });

  it("resets state with resetStateOnChange", () => {
    const base: SayShapeParams = { spec: COUNTER, resetStateOnChange: true };
    const { action, engine } = use(base);
    pressButton(engine);
    action.update({ ...base, spec: COUNTER + '\ntext "more"' });
    engine.renderNow();
    expect(engine.state.get("n")).toBe(0);
  });

  it("does nothing when update() is called with the same values (Svelte calls it often)", () => {
    const base: SayShapeParams = { spec: COUNTER, theme: "auto" };
    const { action, engine } = use(base);
    const setSpec = vi.spyOn(engine, "setSpec");
    const setTheme = vi.spyOn(engine, "setTheme");
    action.update({ ...base });
    action.update({ ...base });
    expect(setSpec).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("streams: pushes only the new text, then ends the stream", () => {
    const base: SayShapeParams = { spec: "", streaming: true };
    const { action, engine } = use(base);
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    const end = vi.spyOn(engine, "endStream");
    for (const spec of ['text "A"\n', 'text "A"\ntext "B"\n', 'text "A"\ntext "B"\ntext "C"']) action.update({ ...base, spec });
    expect(push.mock.calls.map((c) => c[0])).toEqual(['text "A"\n', 'text "B"\n', 'text "C"']);
    expect(begin).not.toHaveBeenCalled();
    action.update({ spec: 'text "A"\ntext "B"\ntext "C"', streaming: false });
    expect(end).toHaveBeenCalledTimes(1);
    expect(engine.isStreaming).toBe(false);
    engine.renderNow();
    expect(engine.copyText()).toContain("C");
  });

  it("restarts the stream when the text shrinks", () => {
    const base: SayShapeParams = { spec: 'text "one"\ntext "two"\n', streaming: true };
    const { action, engine } = use(base);
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    action.update({ ...base, spec: 'text "one"\n' });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith('text "one"\n');
  });

  it("calls onAction for emit: presses and the other handlers", () => {
    const onAction = vi.fn(), onChange = vi.fn(), onNotify = vi.fn(), onRender = vi.fn(), onDiagnostics = vi.fn();
    const { engine } = use({ spec: 'state n=0\nbutton "Send" on=inc:n;emit:sent:5;notify:Sent', onAction, onChange, onNotify, onRender, onDiagnostics });
    pressButton(engine);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]![0]).toMatchObject({ name: "sent", value: 5 });
    expect(onChange).toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith({ text: "Sent" });
    expect(onRender).toHaveBeenCalled();
  });

  it("calls onNavigate when the screen changes", () => {
    const onNavigate = vi.fn();
    const { engine } = use({ spec: 'screen name=one\n  button "Next" on=go:two\nscreen name=two\n  text "Two"', onNavigate });
    pressButton(engine);
    expect(onNavigate).toHaveBeenCalledWith({ screen: "two", from: "one" });
  });

  it("uses the newest handler without touching the engine", () => {
    const first = vi.fn(), second = vi.fn();
    const base: SayShapeParams = { spec: 'button "Send" on=emit:sent', onAction: first };
    const { action, engine } = use(base);
    action.update({ ...base, onAction: second });
    pressButton(engine);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("switches theme without recreating the engine", () => {
    const base: SayShapeParams = { spec: 'text "Hi"', theme: "light" };
    const { node, action, engine } = use(base);
    expect(engine.theme).toBe(lightTheme);
    const setTheme = vi.spyOn(engine, "setTheme");
    action.update({ ...base, theme: "dark" });
    expect(setTheme).toHaveBeenCalledWith(darkTheme);
    expect(engine.theme).toBe(darkTheme);
    expect(node.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("reads options once", () => {
    const base: SayShapeParams = { spec: 'text "Hi"', options: { minHeight: 321 } };
    const { action, engine } = use(base);
    engine.renderNow();
    action.update({ ...base, options: { minHeight: 999 } });
    engine.renderNow();
    expect(engine.canvas.style.height).toBe("321px");
  });

  it("destroy() unsubscribes every listener, destroys the engine and removes its DOM", () => {
    const original = SayShape.prototype.on;
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(SayShape.prototype, "on").mockImplementation(function (this: SayShape, name: never, fn: never) {
      const off = vi.fn(original.call(this, name, fn));
      offs.push(off);
      return off;
    } as typeof SayShape.prototype.on);
    const { node, action, engine } = use({ spec: COUNTER });
    const destroy = vi.spyOn(engine, "destroy");
    expect(offs).toHaveLength(6);
    action.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(node.querySelector("canvas")).toBeNull();
    expect(node.querySelector("[data-sayshape-a11y]")).toBeNull();
    // A second destroy is harmless.
    expect(() => action.destroy()).not.toThrow();
  });
});
