// @vitest-environment jsdom
import { StrictMode, createRef, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SayShape as Engine, darkTheme, lightTheme } from "../src/index";
import { SayShape } from "../src/react";
import { createRecordingContext, ensurePath2D } from "../src/testing/canvas";

const COUNTER = `state n=0\nbutton "Add" on=inc:n\n`;
const EMIT = `button "Send" on=emit:sent\n`;

let engines: Engine[] = [];
let destroyed: Engine[] = [];

beforeEach(() => {
  ensurePath2D();
  // jsdom has no matchMedia: the engine asks it for the color scheme and reduced motion.
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  engines = [];
  destroyed = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => createRecordingContext().context as never);
  // Count every engine made and every one destroyed, without changing what they do.
  const destroy = Engine.prototype.destroy;
  vi.spyOn(Engine.prototype, "destroy").mockImplementation(function (this: Engine) { destroyed.push(this); destroy.call(this); });
  const setSpec = Engine.prototype.setSpec;
  vi.spyOn(Engine.prototype, "setSpec").mockImplementation(function (this: Engine, ...a) { if (!engines.includes(this)) engines.push(this); setSpec.apply(this, a); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function press(engine: Engine, type: string): void {
  engine.renderNow();
  const hit = engine.hitRegions.find((h) => h.box.node.type === type);
  if (!hit) throw new Error(`no ${type} on screen`);
  act(() => engine.activate({ node: hit.box.node, box: hit.box }));
}

function engineOf(ref: { current: Engine | null }): Engine {
  if (!ref.current) throw new Error("no engine");
  return ref.current;
}

describe("<SayShape>", () => {
  it("renders a canvas and gives the engine through the ref", () => {
    const ref = createRef<Engine>();
    const { container } = render(<SayShape ref={ref} spec={COUNTER} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(ref.current).toBeInstanceOf(Engine);
    expect(engineOf(ref).spec).toBe(COUNTER);
  });

  it("keeps state when the spec changes", () => {
    const ref = createRef<Engine>();
    const { rerender } = render(<SayShape ref={ref} spec={COUNTER} />);
    press(engineOf(ref), "button");
    expect(engineOf(ref).state.get("n")).toBe(1);
    rerender(<SayShape ref={ref} spec={COUNTER + `text "more"\n`} />);
    expect(engineOf(ref).spec).toContain("more");
    expect(engineOf(ref).state.get("n")).toBe(1);
  });

  it("resets state on a spec change with resetStateOnChange", () => {
    const ref = createRef<Engine>();
    const { rerender } = render(<SayShape ref={ref} resetStateOnChange spec={COUNTER} />);
    press(engineOf(ref), "button");
    expect(engineOf(ref).state.get("n")).toBe(1);
    rerender(<SayShape ref={ref} resetStateOnChange spec={COUNTER + `text "more"\n`} />);
    engineOf(ref).renderNow(); // the spec's initial values are put back when it is read
    expect(engineOf(ref).state.get("n")).toBe(0);
  });

  it("does not call setSpec again for the same string", () => {
    const { rerender } = render(<SayShape spec={COUNTER} />);
    const spy = vi.mocked(Engine.prototype.setSpec);
    spy.mockClear();
    rerender(<SayShape spec={COUNTER} className="x" />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("pushes only the new text while streaming, and ends the stream", () => {
    const begin = vi.spyOn(Engine.prototype, "beginStream");
    const push = vi.spyOn(Engine.prototype, "push");
    const end = vi.spyOn(Engine.prototype, "endStream");
    const ref = createRef<Engine>();
    const a = `text "one"\n`;
    const b = a + `text "two"\n`;
    const c = b + `text "three"`;
    const { rerender } = render(<SayShape ref={ref} streaming spec={a} />);
    rerender(<SayShape ref={ref} streaming spec={b} />);
    rerender(<SayShape ref={ref} streaming spec={c} />);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(push.mock.calls.map((x) => x[0])).toEqual([a, `text "two"\n`, `text "three"`]);
    expect(end).not.toHaveBeenCalled();
    expect(engineOf(ref).isStreaming).toBe(true);
    rerender(<SayShape ref={ref} streaming={false} spec={c} />);
    expect(end).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(3);
    expect(engineOf(ref).isStreaming).toBe(false);
    expect(engineOf(ref).spec).toBe(c);
  });

  it("restarts the stream when the text is not an extension of the old one", () => {
    const begin = vi.spyOn(Engine.prototype, "beginStream");
    const ref = createRef<Engine>();
    const { rerender } = render(<SayShape ref={ref} streaming spec={`text "one"\ntext "two"\n`} />);
    rerender(<SayShape ref={ref} streaming spec={`text "one"\n`} />); // shrank
    expect(begin).toHaveBeenCalledTimes(2);
    rerender(<SayShape ref={ref} streaming spec={`text "other"\n`} />); // not a prefix
    expect(begin).toHaveBeenCalledTimes(3);
    expect(engineOf(ref).spec).toBe(`text "other"\n`);
  });

  it("catches up with the final text when streaming turns off in the same render", () => {
    const ref = createRef<Engine>();
    const { rerender } = render(<SayShape ref={ref} streaming spec={`text "a"\n`} />);
    rerender(<SayShape ref={ref} spec={`text "a"\ntext "b"\n`} />);
    expect(engineOf(ref).spec).toBe(`text "a"\ntext "b"\n`);
    expect(engineOf(ref).isStreaming).toBe(false);
  });

  it("calls onAction when an emit: button is pressed, with the latest handler", () => {
    const ref = createRef<Engine>();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<SayShape ref={ref} spec={EMIT} onAction={first} />);
    const engine = engineOf(ref);
    rerender(<SayShape ref={ref} spec={EMIT} onAction={second} />);
    expect(engineOf(ref)).toBe(engine);
    press(engine, "button");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0]).toMatchObject({ name: "sent" });
  });

  it("switches theme without recreating the engine", () => {
    const ref = createRef<Engine>();
    const setTheme = vi.spyOn(Engine.prototype, "setTheme");
    const { rerender } = render(<SayShape ref={ref} spec={COUNTER} theme={lightTheme} />);
    const engine = engineOf(ref);
    rerender(<SayShape ref={ref} spec={COUNTER} theme={darkTheme} />);
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith(darkTheme);
    expect(engineOf(ref)).toBe(engine);
    expect(destroyed).toHaveLength(0);
  });

  it("destroys the engine and unsubscribes every listener on unmount", () => {
    // Wrap on() so each unsubscribe function it hands out is counted.
    let subscribed = 0;
    let unsubscribed = 0;
    const on = Engine.prototype.on;
    vi.spyOn(Engine.prototype, "on").mockImplementation(function (this: Engine, name, fn) {
      subscribed++;
      const off = on.call(this, name, fn as never);
      return () => { unsubscribed++; off(); };
    });
    const ref = createRef<Engine>();
    const { unmount } = render(<SayShape ref={ref} spec={EMIT} />);
    const engine = engineOf(ref);
    expect(subscribed).toBe(6);
    expect(unsubscribed).toBe(0);
    unmount();
    expect(unsubscribed).toBe(6);
    expect(destroyed).toEqual([engine]);
    expect(ref.current).toBeNull();
  });

  it("leaves exactly one live engine under StrictMode", () => {
    const ref = createRef<Engine>();
    const { container, unmount } = render(
      <StrictMode>
        <SayShape ref={ref} spec={COUNTER} />
      </StrictMode>,
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    const live = engineOf(ref);
    // Every engine made was destroyed except the one now on the canvas.
    expect(destroyed).not.toContain(live);
    expect(engines.filter((e) => !destroyed.includes(e))).toEqual([live]);
    press(live, "button");
    expect(live.state.get("n")).toBe(1);
    unmount();
    expect(engines.every((e) => destroyed.includes(e))).toBe(true);
  });

  it("does not recreate the engine when handlers change on a parent re-render", () => {
    const ref = createRef<Engine>();
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((x) => x + 1);
      return <SayShape ref={ref} spec={EMIT} onAction={() => void n} />;
    }
    render(<Parent />);
    const engine = engineOf(ref);
    act(() => bump());
    act(() => bump());
    expect(engineOf(ref)).toBe(engine);
    expect(destroyed).toHaveLength(0);
  });
});
