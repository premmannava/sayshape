/**
 * The Muse adapter, run the way the widget file's loader will run it: its
 * exported source evaluated as a function expression and called with the
 * real engine (sayshape/testing's render()), the engine's browser exports
 * and a root, against a fake state bridge on a fake window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { build, transform } from "esbuild";
import { fileURLToPath } from "node:url";
import { render, type Rendered } from "../../src/testing";
import * as S from "../../src/browser";
import { adapterSource, isWidgetHost, MUSE_SOURCE, museAdapter, STATE_LIMIT, WIDGET_HOSTS, type AdapterHooks, type AdapterOptions } from "../src/widget-hosts";

type Obj = Record<string, unknown>;
const NOTICE = "Saved. Send a message to continue.";
const STORAGE_NAMES = /localStorage|sessionStorage|indexedDB|IDBFactory|openDatabase|cookie|CacheStorage|caches\b/i;

/** The bridge Muse puts on window: getState seeds the defaults when nothing is stored; every setState is echoed back. */
class FakeBridge {
  stored: Obj | null = null;
  writes: Obj[] = [];
  gets = 0;
  constructor(private target: EventTarget, public mode: "value" | "promise" = "value", public echo = true) {}
  getState(defaults: Obj): unknown {
    this.gets++;
    if (!this.stored) this.stored = structuredClone(defaults);
    const copy = structuredClone(this.stored);
    return this.mode === "promise" ? Promise.resolve(copy) : copy;
  }
  setState(next: Obj): void {
    this.writes.push(structuredClone(next));
    this.stored = structuredClone(next);
    if (this.echo) this.target.dispatchEvent(Object.assign(new Event("hatch-widget-state"), { detail: { state: structuredClone(next) } }));
  }
  /** What the model would read with its tool. */
  get state(): Obj { return this.stored ?? {}; }
}

let target: EventTarget;
let cssVars: Record<string, string>;
const g = globalThis as unknown as Record<string, unknown>;
const installed = ["addEventListener", "removeEventListener", "hatchWidget", "getComputedStyle", "document"];

beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  cssVars = { "--hatch-widget-bg": "transparent", "--hatch-widget-text": "Highlight" };
  g.addEventListener = target.addEventListener.bind(target);
  g.removeEventListener = target.removeEventListener.bind(target);
  g.getComputedStyle = () => ({ getPropertyValue: (n: string) => cssVars[n] ?? "" });
  g.document = { documentElement: {} };
});

const mounted: Array<{ ui: Rendered; hooks: AdapterHooks }> = [];
afterEach(() => {
  for (const m of mounted.splice(0)) { m.hooks.destroy(); m.ui.destroy(); }
  for (const k of installed) delete g[k];
  vi.useRealTimers();
});

function useBridge(mode: "value" | "promise" = "value", echo = true): FakeBridge {
  const b = new FakeBridge(target, mode, echo);
  g.hatchWidget = b;
  return b;
}

/** The adapter as the loader gets it: source text, evaluated. */
function evaluated(source: string): (ui: unknown, s: unknown, root: unknown) => AdapterHooks {
  return new Function(`return (${source});`)() as (ui: unknown, s: unknown, root: unknown) => AdapterHooks;
}

/** Render a spec and start the adapter on it, wired as the loader does: every emit: but "link" goes to hooks.emit. */
function mount(spec: string, options: AdapterOptions = {}): { ui: Rendered; hooks: AdapterHooks } {
  const ui = render(spec);
  const hooks = evaluated(adapterSource("muse", options))(ui.sayshape, S, undefined);
  ui.sayshape.on("action", (a) => { if (a.name !== "link") hooks.emit(a); });
  const m = { ui, hooks };
  mounted.push(m);
  return m;
}

function unmount(m: { ui: Rendered; hooks: AdapterHooks }): void {
  m.hooks.destroy();
  m.ui.destroy();
  mounted.splice(mounted.indexOf(m), 1);
}

const COUNTER = `state n=0
button "Add" on=inc:n
button "Send" on="emit:send:{n}"
`;

describe("the Muse adapter", () => {
  it("adds an emit: press to the bridge state, with its value, its time and the interface's state", () => {
    const bridge = useBridge();
    const { ui } = mount(COUNTER);
    ui.press({ text: "Add" });
    ui.press({ text: "Send" });
    const st = bridge.state;
    const actions = st.actions as Array<{ name: string; value: unknown; at: string }>;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ name: "send", value: 1 });
    expect(Number.isNaN(Date.parse(actions[0]!.at))).toBe(false);
    expect(st.state).toMatchObject({ n: 1 });
    expect(ui.sayshape.notification).toBe(NOTICE);
  });

  it("keeps the list of actions bounded, newest last", () => {
    const bridge = useBridge();
    const { ui } = mount(COUNTER, { maxActions: 3 });
    for (let i = 0; i < 5; i++) { ui.press({ text: "Add" }); ui.press({ text: "Send" }); }
    const actions = bridge.state.actions as Array<{ value: unknown }>;
    expect(actions.map((a) => a.value)).toEqual([3, 4, 5]);
  });

  it("restores the interface's state after a remount", () => {
    const bridge = useBridge();
    const first = mount(COUNTER);
    first.ui.press({ text: "Add" });
    first.ui.press({ text: "Add" });
    vi.advanceTimersByTime(1000);
    expect(bridge.state.state).toMatchObject({ n: 2 });
    unmount(first);
    const second = mount(COUNTER);
    second.ui.sayshape.renderNow();
    expect(second.ui.state.n).toBe(2);
    expect(second.ui.text()).toContain("Add");
  });

  it("restores before the first frame, as the loader calls it, and the spec's own starting values don't win", () => {
    const bridge = useBridge();
    const first = mount(COUNTER);
    first.ui.press({ text: "Add" });
    vi.advanceTimersByTime(1000);
    unmount(first);
    const writes = bridge.writes.length;
    // A fresh engine given its spec but not drawn yet, then the adapter: the loader's order.
    const ui = render("");
    ui.sayshape.setSpec(COUNTER, { resetState: true });
    const hooks = evaluated(adapterSource("muse"))(ui.sayshape, S, undefined);
    mounted.push({ ui, hooks });
    ui.sayshape.renderNow();
    vi.advanceTimersByTime(2000);
    expect(ui.state.n).toBe(1);
    expect(bridge.writes.length).toBe(writes);
  });

  it("restores what was saved for this interface only", () => {
    const bridge = useBridge();
    bridge.stored = { spec: "another", state: { n: 9 }, actions: [] };
    const { ui } = mount(COUNTER);
    expect(ui.state.n).toBe(0);
  });

  it("restores when getState returns a promise, and holds emits until it does", async () => {
    const bridge = useBridge("promise");
    bridge.stored = null;
    const first = mount(COUNTER);
    first.ui.press({ text: "Add" });
    first.ui.press({ text: "Send" });
    expect(bridge.writes).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect((bridge.state.actions as unknown[]).length).toBe(1);
    expect(bridge.state.state).toMatchObject({ n: 1 });
    unmount(first);
    const second = mount(COUNTER);
    expect(second.ui.state.n).toBe(0);
    await vi.runAllTimersAsync();
    expect(second.ui.state.n).toBe(1);
  });

  it("applies newer state from the bridge and never writes in response", () => {
    const bridge = useBridge();
    const { ui } = mount(COUNTER);
    const spec = (bridge.state as { spec: string }).spec;
    const before = bridge.writes.length;
    target.dispatchEvent(Object.assign(new Event("hatch-widget-state"), { detail: { state: { spec, state: { n: 5 }, actions: [] } } }));
    vi.advanceTimersByTime(5000);
    expect(ui.state.n).toBe(5);
    expect(bridge.writes.length).toBe(before);
  });

  it("doesn't loop on its own echoes, and ignores a late echo of an older write", () => {
    const bridge = useBridge("value", false);
    const { ui } = mount(COUNTER);
    ui.press({ text: "Add" });
    vi.advanceTimersByTime(1000);
    const older = structuredClone(bridge.writes.at(-1)!);
    ui.press({ text: "Add" });
    vi.advanceTimersByTime(1000);
    expect(bridge.writes).toHaveLength(2);
    target.dispatchEvent(Object.assign(new Event("hatch-widget-state"), { detail: { state: older } }));
    vi.advanceTimersByTime(5000);
    expect(ui.state.n).toBe(2);
    expect(bridge.writes).toHaveLength(2);
  });

  it("saves at most about twice a second, and saves the last change", () => {
    const bridge = useBridge();
    const { ui } = mount(COUNTER);
    for (let i = 0; i < 20; i++) { ui.press({ text: "Add" }); vi.advanceTimersByTime(50); }
    // 20 presses over a second.
    expect(bridge.writes.length).toBeGreaterThanOrEqual(2);
    expect(bridge.writes.length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(1000);
    expect(bridge.state.state).toMatchObject({ n: 20 });
  });

  it("skips saving a state over the limit, and says so", () => {
    const bridge = useBridge();
    const { ui } = mount(COUNTER);
    ui.set("notes", "x".repeat(STATE_LIMIT + 1));
    vi.advanceTimersByTime(1000);
    expect(bridge.state.state).toBeNull();
    expect(String(bridge.state.stateNote)).toMatch(/larger than 8192 bytes/);
    ui.set("notes", "short");
    vi.advanceTimersByTime(1000);
    expect(bridge.state.state).toMatchObject({ notes: "short" });
    expect(bridge.state.stateNote).toBeUndefined();
  });

  it("never saves a password field's value, in state or in an emitted action", () => {
    const bridge = useBridge();
    const { ui } = mount(`state pw="" who="" form={user: "", secret: ""}
input bind=who label="Name"
input bind=pw kind=password label="Password"
input bind=form.secret kind=password label="PIN"
input bind=form.user label="User"
button "Go" on="emit:login:{pw}"
`);
    ui.type({ type: "input", line: 2 }, "Ada");
    ui.type({ type: "input", line: 3 }, "hunter22");
    ui.type({ type: "input", line: 4 }, "8642");
    ui.type({ type: "input", line: 5 }, "ada");
    ui.key("Tab");
    vi.advanceTimersByTime(1000);
    ui.press({ text: "Go" });
    vi.advanceTimersByTime(1000);
    expect(ui.state.pw).toBe("hunter22");
    const st = bridge.state.state as Obj;
    expect(st.who).toBe("Ada");
    expect(st).not.toHaveProperty("pw");
    expect(st.form).toEqual({ user: "ada", secret: "" });
    const all = JSON.stringify(bridge.writes);
    expect(all).not.toContain("hunter22");
    expect(all).not.toContain("8642");
    expect((bridge.state.actions as Array<{ name: string }>)[0]!.name).toBe("login");
  });

  it("saves no state when it can't tell where a password field keeps its value", () => {
    const bridge = useBridge();
    const { ui } = mount(`state users=[{name: "a", pw: ""}] q=""
derive shown={search(users, q)}
each items=shown as=u
  input bind=u.pw kind=password label="Password"
`);
    ui.type("input", "s3cret!");
    ui.key("Tab");
    ui.set("q", "");
    ui.set("q", "a");
    vi.advanceTimersByTime(1000);
    expect(JSON.stringify(bridge.writes)).not.toContain("s3cret!");
    expect(bridge.writes.length).toBeGreaterThan(0);
    expect(bridge.state.state).toBeNull();
    expect(String(bridge.state.stateNote)).toMatch(/password/);
    expect(ui.state.users).toEqual([{ name: "a", pw: "s3cret!" }]);
  });

  it("blanks a password field inside each over a list in state", () => {
    const bridge = useBridge();
    const { ui } = mount(`state users=[{name: "a", pw: ""}, {name: "b", pw: ""}]
each items=users as=u
  input bind=u.pw kind=password label="Password"
`);
    ui.type({ id: "3:input#1" }, "s3cret!");
    ui.key("Tab");
    vi.advanceTimersByTime(1000);
    expect(JSON.stringify(bridge.writes)).not.toContain("s3cret!");
    expect(bridge.state.state).toEqual({ users: [{ name: "a", pw: "" }, { name: "b", pw: "" }] });
  });

  it("applies the app's colors when they arrive late, readable, and ignores the defaults read at startup", () => {
    useBridge();
    const { ui } = mount(COUNTER);
    const setTheme = vi.spyOn(ui.sayshape, "setTheme");
    vi.advanceTimersByTime(300);
    expect(setTheme).not.toHaveBeenCalled();
    target.dispatchEvent(Object.assign(new Event("message"), {
      data: { cssVariables: { "--hatch-widget-bg": "#181819", "--hatch-widget-surface": "#292C2A", "--hatch-widget-text": "#FFFFFF", "--hatch-widget-accent": "#508401" } },
    }));
    expect(setTheme).toHaveBeenCalledTimes(1);
    const c = ui.sayshape.theme.colors;
    expect(c.surface).toBe("#181819");
    expect(c.raised).toBe("#292c2a");
    expect(c.ink).toBe("#ffffff");
    // #508401 is under 4.5:1 on that background, so it's lightened until it reads.
    expect(c.accent).not.toBe("#508401");
    for (const back of [c.surface, c.raised]) {
      expect(contrast(c.accent, back)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, back)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    // The same colors again change nothing.
    target.dispatchEvent(Object.assign(new Event("message"), { data: { cssVariables: { "--hatch-widget-bg": "#181819" } } }));
    expect(setTheme).toHaveBeenCalledTimes(1);
  });

  it("picks up the app's colors from CSS variables that change after load", () => {
    useBridge();
    const { ui } = mount(COUNTER);
    cssVars = { "--hatch-widget-bg": "#ffffff", "--hatch-widget-text": "#cccccc", "--hatch-widget-accent": "#ffd400" };
    vi.advanceTimersByTime(1000);
    const c = ui.sayshape.theme.colors;
    expect(c.surface).toBe("#ffffff");
    // Pale text and accent on white are darkened until they read.
    expect(contrast(c.ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accent, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("ignores the app's colors when the server chose a theme", () => {
    useBridge();
    const { ui } = mount(COUNTER, { ignoreAppColors: true });
    const setTheme = vi.spyOn(ui.sayshape, "setTheme");
    cssVars = { "--hatch-widget-bg": "#181819", "--hatch-widget-text": "#ffffff" };
    target.dispatchEvent(Object.assign(new Event("message"), { data: { cssVariables: { "--hatch-widget-bg": "#181819", "--hatch-widget-text": "#ffffff" } } }));
    vi.advanceTimersByTime(5000);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("does nothing, and doesn't throw, without a bridge", () => {
    const { ui, hooks } = mount(COUNTER);
    expect(() => { ui.press({ text: "Add" }); ui.press({ text: "Send" }); hooks.emit("plain"); vi.advanceTimersByTime(5000); }).not.toThrow();
    expect(ui.state.n).toBe(1);
    expect(ui.sayshape.notification).toBeNull();
  });

  it("doesn't throw when getState or setState do", () => {
    g.hatchWidget = { getState() { throw new Error("no"); }, setState() { throw new Error("no"); } };
    const { ui } = mount(COUNTER);
    expect(() => { ui.press({ text: "Add" }); ui.press({ text: "Send" }); vi.advanceTimersByTime(5000); }).not.toThrow();
  });
});

describe("the adapter's source", () => {
  it("lists the hosts by name", () => {
    expect(Object.keys(WIDGET_HOSTS)).toEqual(["muse"]);
    expect(isWidgetHost("muse")).toBe(true);
    expect(isWidgetHost("toString")).toBe(false);
    expect(WIDGET_HOSTS.muse.source).toBe(MUSE_SOURCE);
  });

  it("names no browser storage and stands alone", () => {
    expect(MUSE_SOURCE).not.toMatch(STORAGE_NAMES);
    expect(adapterSource("muse", { ignoreAppColors: true })).not.toMatch(STORAGE_NAMES);
    expect(MUSE_SOURCE).not.toMatch(/\bimport\b|\brequire\(|hatch\.(call|navigate)/);
    expect(MUSE_SOURCE.startsWith("function museAdapter(")).toBe(true);
  });

  it("uses ES2020 syntax only", async () => {
    const wrapped = `(${MUSE_SOURCE});`;
    const latest = await transform(wrapped, { target: "esnext", loader: "js" });
    const es2020 = await transform(wrapped, { target: "es2020", loader: "js" });
    expect(es2020.code).toBe(latest.code);
  });

  it("keeps its default limit in step with STATE_LIMIT", () => {
    expect(MUSE_SOURCE).toContain(`: ${STATE_LIMIT};`);
    expect(museAdapter.length).toBe(4);
  });

  it("bakes in only well-formed settings", () => {
    const src = adapterSource("muse", { stateLimit: Number.NaN, saveEvery: -1, ignoreAppColors: "yes" as unknown as boolean });
    expect(src).toContain(`{"ignoreAppColors":false,"stateLimit":${STATE_LIMIT}}`);
  });

  it("survives the MCP package's build, minified or not, and runs when evaluated", async () => {
    const entry = fileURLToPath(new URL("../src/widget-hosts/index.ts", import.meta.url));
    for (const minify of [false, true]) {
      const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", target: "node20", minify });
      const mod = (await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0]!.text).toString("base64")}`)) as { adapterSource: typeof adapterSource };
      const source = mod.adapterSource("muse");
      expect(source).not.toMatch(STORAGE_NAMES);
      const bridge = useBridge();
      const ui = render(COUNTER);
      const hooks = evaluated(source)(ui.sayshape, S, undefined);
      mounted.push({ ui, hooks });
      ui.sayshape.on("action", (a) => hooks.emit(a));
      ui.press({ text: "Add" });
      ui.press({ text: "Send" });
      expect((bridge.state.actions as Array<{ name: string; value: unknown }>)[0]).toMatchObject({ name: "send", value: 1 });
    }
  });
});

function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const n = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
    return 0.2126 * n[0]! + 0.7152 * n[1]! + 0.0722 * n[2]!;
  };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
