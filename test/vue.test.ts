// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, shallowRef, type App } from "vue";
import { SayShape, darkTheme, lightTheme } from "../src/index";
import { createRecordingContext, ensurePath2D } from "../src/testing/canvas";
import SayShapeVue, { SayShape as Named, type ThemeInput } from "../src/vue";

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

interface Props { spec: string; streaming?: boolean; theme?: ThemeInput; resetStateOnChange?: boolean; options?: Record<string, unknown> }
interface Mounted {
  app: App;
  props: Props;
  root: HTMLElement;
  engine: () => SayShape;
  events: Record<string, unknown[]>;
}
const apps: App[] = [];

function mountVue(initial: Props): Mounted {
  const props = reactive<Props>({ ...initial });
  const events: Record<string, unknown[]> = {};
  const inst = shallowRef<{ engine: SayShape | null } | null>(null);
  const on = (name: string) => (payload: unknown) => { (events[name] ??= []).push(payload); };
  const app = createApp({
    render: () => h(SayShapeVue, {
      ...props, ref: inst, onAction: on("action"), onChange: on("change"), onDiagnostics: on("diagnostics"),
      onNavigate: on("navigate"), onNotify: on("notify"), onRender: on("render"),
    }),
  });
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  apps.push(app);
  return { app, props, root, events, engine: () => inst.value!.engine! };
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
  apps.splice(0).forEach((a) => a.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("sayshape/vue", () => {
  it("exports the component both ways", () => {
    expect(Named).toBe(SayShapeVue);
  });

  it("renders a spec", () => {
    const m = mountVue({ spec: 'text "Hello Vue"' });
    expect(m.root.querySelectorAll("canvas")).toHaveLength(1);
    m.engine().renderNow();
    expect(m.engine().copyText()).toContain("Hello Vue");
  });

  it("keeps state when the spec changes", async () => {
    const m = mountVue({ spec: COUNTER });
    pressButton(m.engine());
    expect(m.engine().state.get("n")).toBe(1);
    const setSpec = vi.spyOn(m.engine(), "setSpec");
    m.props.spec = COUNTER + '\ntext "more"';
    await nextTick();
    expect(setSpec).toHaveBeenCalledWith(COUNTER + '\ntext "more"', { resetState: false });
    m.engine().renderNow();
    expect(m.engine().state.get("n")).toBe(1);
  });

  it("resets state with resetStateOnChange", async () => {
    const m = mountVue({ spec: COUNTER, resetStateOnChange: true });
    pressButton(m.engine());
    m.props.spec = COUNTER + '\ntext "more"';
    await nextTick();
    m.engine().renderNow();
    expect(m.engine().state.get("n")).toBe(0);
  });

  it("skips a spec that didn't change", async () => {
    const m = mountVue({ spec: COUNTER });
    const setSpec = vi.spyOn(m.engine(), "setSpec");
    m.props.spec = COUNTER;
    m.props.theme = "auto";
    await nextTick();
    expect(setSpec).not.toHaveBeenCalled();
  });

  it("streams: pushes only the new text, then ends the stream", async () => {
    const m = mountVue({ spec: "", streaming: true });
    const engine = m.engine();
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    const end = vi.spyOn(engine, "endStream");
    for (const text of ['text "A"\n', 'text "A"\ntext "B"\n', 'text "A"\ntext "B"\ntext "C"']) {
      m.props.spec = text;
      await nextTick();
    }
    expect(push.mock.calls.map((c) => c[0])).toEqual(['text "A"\n', 'text "B"\n', 'text "C"']);
    expect(begin).not.toHaveBeenCalled(); // the stream began when the component mounted
    expect(end).not.toHaveBeenCalled();
    m.props.streaming = false;
    await nextTick();
    expect(end).toHaveBeenCalledTimes(1);
    expect(engine.isStreaming).toBe(false);
    engine.renderNow();
    expect(engine.copyText()).toContain("C");
  });

  it("restarts the stream when the text stops being a prefix", async () => {
    const m = mountVue({ spec: 'text "one"\ntext "two"\n', streaming: true });
    const engine = m.engine();
    const begin = vi.spyOn(engine, "beginStream");
    const push = vi.spyOn(engine, "push");
    m.props.spec = 'text "one"\n';
    await nextTick();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith('text "one"\n');
  });

  it("emits action for emit: presses, and the other events", () => {
    const m = mountVue({ spec: 'state n=0\nbutton "Send" on=inc:n;emit:sent:5;notify:Sent' });
    pressButton(m.engine());
    expect(m.events.action).toHaveLength(1);
    expect(m.events.action![0]).toMatchObject({ name: "sent", value: 5 });
    expect(m.events.change!.length).toBeGreaterThan(0);
    expect(m.events.notify).toEqual([{ text: "Sent" }]);
    expect(m.events.render!.length).toBeGreaterThan(0);
    expect(m.events.diagnostics).toBeDefined();
  });

  it("emits navigate when the screen changes", () => {
    const m = mountVue({ spec: 'screen name=one\n  button "Next" on=go:two\nscreen name=two\n  text "Two"' });
    pressButton(m.engine());
    expect(m.events.navigate).toEqual([{ screen: "two", from: "one" }]);
  });

  it("switches theme without recreating the engine", async () => {
    const m = mountVue({ spec: 'text "Hi"', theme: "light" });
    const engine = m.engine();
    expect(engine.theme).toBe(lightTheme);
    const setTheme = vi.spyOn(engine, "setTheme");
    m.props.theme = "dark";
    await nextTick();
    expect(setTheme).toHaveBeenCalledWith(darkTheme);
    expect(m.engine()).toBe(engine);
    expect(m.root.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("reads options once, at mount", async () => {
    const m = mountVue({ spec: 'text "Hi"', options: { minHeight: 321 } });
    const engine = m.engine();
    engine.renderNow();
    expect(engine.canvas.style.height).toBe("321px");
    m.props.options = { minHeight: 999 };
    await nextTick();
    expect(m.engine()).toBe(engine);
    expect(engine.canvas.style.height).toBe("321px");
  });

  it("on unmount unsubscribes every listener and destroys the engine", () => {
    const original = SayShape.prototype.on;
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(SayShape.prototype, "on").mockImplementation(function (this: SayShape, name: never, fn: never) {
      const off = vi.fn(original.call(this, name, fn));
      offs.push(off);
      return off;
    } as typeof SayShape.prototype.on);
    const m = mountVue({ spec: COUNTER });
    const engine = m.engine();
    const destroy = vi.spyOn(engine, "destroy");
    expect(offs).toHaveLength(6);
    m.app.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    for (const off of offs) expect(off).toHaveBeenCalledTimes(1);
    expect(m.root.querySelector("canvas")).toBeNull();
    expect(m.root.querySelector("[data-sayshape-a11y]")).toBeNull();
  });
});
