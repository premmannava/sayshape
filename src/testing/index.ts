/**
 * Test helpers for SayShape (`sayshape/testing`).
 *
 * `render()` runs the real engine (parse, layout, paint, hit testing,
 * pointer and keyboard handling) against a recording stand-in for the
 * canvas, so interaction tests run in Node with any test runner:
 *
 *   const ui = render(`state n=0\nbutton "Add" on=inc:n`);
 *   ui.press({ type: "button", text: "Add" });
 *   expect(ui.state.n).toBe(1);
 *
 * Nothing here is used by the engine itself, and it has no dependencies.
 */
import type { ComponentDef } from "../component";
import { coreComponents } from "../components";
import { SayShape, type SayShapeEvents, type SayShapeOptions } from "../engine";
import { interpolate } from "../expr";
import { eachInstances, scopeOf } from "../each";
import type { EditorEvents, EditorHost, EditorSpec } from "../editor";
import type { AccessibilityHost, MirrorEvents, Politeness } from "../a11y/host";
import type { AccessibleNode } from "../a11y/semantics";
import { isVisible, walkBoxes } from "../layout";
import { lightTheme, type Theme } from "../theme";
import type { Box, Diagnostic, HitRegion, SayShapeNode, Value } from "../types";
import { ensurePath2D, FakeCanvas, type DrawOp } from "./canvas";

export { createRecordingContext, FakeCanvas, monoWidth, type DrawOp } from "./canvas";
export { ManualClock } from "./clock";
import { ManualClock } from "./clock";

export interface RenderOptions {
  /** Components to register. Default: the core components (add `mapComponents` for maps). */
  components?: ComponentDef[];
  /** Layout width in CSS pixels. Default 600. */
  width?: number;
  /** Default: the light theme. */
  theme?: Theme;
  /** Padding around the screen. Default 20, like the engine. */
  padding?: number;
  /** Passed to the engine, to test images (Node has no image loading of its own). */
  imageHosts?: string[];
  loadImage?: SayShapeOptions["loadImage"];
  /** The visible part of the canvas, for popup placement. Default: from the top, unbounded. */
  viewport?: { top: number; bottom: number };
  /** Today's date as YYYY-MM-DD, for date pickers. Default: the machine's local day. */
  today?: string;
  /** Experimental behavior: `every` rules and dragging in scenes. Turns on the manual clock too. */
  behavior?: boolean;
  /**
   * Use a clock the test advances (ui.clock.advance(ms)) instead of real time.
   * Default: on with behavior, off otherwise.
   */
  clock?: boolean;
  /** Scene motion and fade-ins. Default false, so screens are still. Pair with clock to draw a scene at a chosen time. */
  animate?: boolean;
  /** As if the person prefers reduced motion: rules wait for a first press or key. Default false. */
  reducedMotion?: boolean;
  /** The engine's bareRootCard option: a card that is the only top-level element draws no frame. Default false. */
  bareRootCard?: boolean;
}

/** The test's clock: advance it to run rules' ticks and move scenes on, without waiting. */
export interface TestClock {
  /** Milliseconds since the screen was rendered. */
  now(): number;
  /** Move time on, running every tick that falls due on the way (and drawing after each). */
  advance(ms: number): void;
  /** Timers still waiting: 0 means nothing will change by itself. */
  readonly pending: number;
}

/** Which element to find. A string is shorthand for `{ type }`. */
export type Query =
  | string
  | {
      type?: string;
      /** Matches the element's text as written in the spec or as currently shown (with {expressions} filled in). */
      text?: string | RegExp;
      /** The spec line the element is on. */
      line?: number;
      /**
       * The element's id. Inside each, copies share a line, so pick one by its
       * id: the line, type and item key, like "3:card#2".
       */
      id?: string;
    };

export interface Found {
  node: SayShapeNode;
  /** The element's box, or null when it's hidden by `if=` or not laid out. */
  box: Box | null;
  /** The text as currently shown, with {expressions} filled in. */
  shownText: string | undefined;
}

export interface Emitted {
  name: string;
  value: Value | undefined;
}

export interface Rendered {
  /** The engine instance, for anything the helpers don't cover. */
  sayshape: SayShape;
  /** The stand-in canvas, for sending raw events. */
  canvas: FakeCanvas;
  /** Current state, as a plain object. */
  readonly state: Record<string, Value>;
  readonly diagnostics: Diagnostic[];
  /** Every `emit:` the screen has sent, oldest first. */
  readonly emitted: Emitted[];
  /** Warnings from the engine (e.g. a blocked image), oldest first. Collected here instead of the console. */
  readonly warnings: string[];
  /** Drawing calls from the most recent frame. */
  readonly drawOps: DrawOp[];
  /** Interactive regions from the most recent frame. */
  readonly hits: readonly HitRegion[];
  /** The element with keyboard focus, if any. */
  readonly focused: SayShapeNode | null;
  /** The open popup (a select's options): its owner, where it is, and its pressable regions. */
  readonly popup: SayShape["openPopupInfo"];
  /** What screen readers have been told (notify: messages, new screens), oldest first. */
  readonly announcements: Announcement[];
  /**
   * The mirror as the engine drives it: which node it last asked to hold DOM
   * focus, whether the screen is busy, and the events a screen reader would
   * send (activate a node, move to one, press a key on one), by node key.
   */
  readonly mirror: Mirror;
  /** The test's clock (render with behavior: true or clock: true). */
  readonly clock: TestClock;

  /**
   * The screen as a screen reader gets it: each shown element's role, name
   * and state, in reading order. Leave out `full` for a compact, printable
   * form; pass it for the AccessibleNode tree itself.
   */
  accessibility(): AccessibleSummary;
  accessibility(opts: { full: true }): AccessibleNode;

  /** Elements matching a query, in spec order. Hidden elements are included with `box: null`. */
  findAll(query: Query): Found[];
  /** The single element matching a query. Throws if there are none or several. */
  find(query: Query): Found;
  /** Whether an element matching the query is laid out (not hidden by `if=`). */
  isShown(query: Query): boolean;
  /** Text drawn in the most recent frame, one entry per line of text. */
  text(): string[];
  /** The screen as a host's Copy text button would copy it (SayShape.copyText()). */
  copyText(): string;

  /** Click the centre of an element through the real pointer path. Throws if it can't be pressed. */
  press(query: Query): void;
  /** Click at a point, in CSS pixels from the canvas's top-left corner. */
  click(x: number, y: number): void;
  /**
   * Press an element, move the pointer to a point in a few steps, and let go,
   * through the real pointer path. Points are CSS pixels from the canvas's
   * top-left corner; y defaults to where the drag started.
   */
  drag(query: Query, toX: number, toY?: number): void;
  /**
   * Turn the mouse wheel at a point, in CSS pixels from the canvas's top-left
   * corner. deltaX is a sideways swipe; shift holds Shift, as for sideways
   * scrolling with an ordinary wheel.
   */
  wheel(x: number, y: number, deltaY: number, opts?: { deltaX?: number; shift?: boolean }): void;
  /** Send a key press to the canvas, e.g. key("Tab"), key("Enter"), key("Tab", { shift: true }). */
  key(key: string, opts?: { shift?: boolean }): void;
  /** Move keyboard focus with Tab (or Shift+Tab when `back` is true). */
  tab(back?: boolean): void;
  /** Change a state value, as the host app might. */
  set(key: string, value: Value): void;
  /**
   * Type into a field as a person would: press it (unless it's already being
   * typed in), then enter the text one character at a time. With replace,
   * the field is cleared first. Keys like Enter then go to the field.
   */
  type(query: Query, text: string, opts?: { replace?: boolean }): void;
  /** The text box over the field being typed in, or null. */
  readonly editor: FakeEditor | null;

  /** Replace the spec. State is kept unless resetState is true. */
  setSpec(spec: string, opts?: { resetState?: boolean }): void;
  /** Stream a spec in chunks, rendering after each one, as a model's response would arrive. */
  stream(chunks: Iterable<string>, opts?: { keepState?: boolean }): void;

  /** Remove listeners. */
  destroy(): void;
}

export function render(spec: string, opts: RenderOptions = {}): Rendered {
  ensurePath2D();
  const canvas = new FakeCanvas();
  const announcements: Announcement[] = [];
  const mirrorState = { focused: null as string | null, busy: false, updates: 0, quiet: 0, events: null as MirrorEvents | null };
  const accessibility: AccessibilityHost = {
    announce: (text, politeness = "polite") => { announcements.push({ text, politeness }); },
    connect: (events) => { mirrorState.events = events; },
    update: (_tree, busy, o) => { mirrorState.busy = busy; mirrorState.updates++; if (o?.quiet) mirrorState.quiet++; },
    focus: (key) => { mirrorState.focused = key; return true; },
    destroy() {},
  };
  let editingNode = (): string | null => null;
  const editor = new FakeEditorHost(() => editingNode());
  const manual = opts.clock ?? !!opts.behavior ? new ManualClock(() => flushLater()) : null;
  let flushLater = () => {};
  const sayshape: SayShape = new SayShape(canvas as unknown as HTMLCanvasElement, {
    editor,
    accessibility,
    components: opts.components ?? coreComponents,
    theme: opts.theme ?? lightTheme,
    width: opts.width ?? 600,
    padding: opts.padding,
    animate: opts.animate ?? false,
    imageHosts: opts.imageHosts,
    ...(opts.behavior ? { behavior: true } : {}),
    ...(manual ? { clock: manual } : {}),
    reducedMotion: !!opts.reducedMotion,
    ...(opts.bareRootCard ? { bareRootCard: true } : {}),
    loadImage: opts.loadImage,
    onWarning: (m) => warnings.push(m),
    viewport: opts.viewport ? () => opts.viewport! : undefined,
    today: opts.today ? () => opts.today! : undefined,
  });

  const emitted: Emitted[] = [];
  const warnings: string[] = [];
  let drawOps: DrawOp[] = [];
  sayshape.on("action", (e: SayShapeEvents["action"]) => emitted.push({ name: e.name, value: e.value }));
  sayshape.on("render", () => { drawOps = canvas.takeDrawOps(); });
  editingNode = () => sayshape.editing?.node.id ?? null;

  const flush = () => sayshape.renderNow();
  flushLater = flush;
  sayshape.setSpec(spec);
  flush();

  const describeQuery = (q: Query) => (typeof q === "string" ? q : JSON.stringify(q, (_k, v) => (v instanceof RegExp ? String(v) : v)));

  const boxesById = () => {
    const map = new Map<string, Box>();
    if (sayshape.boxes) walkBoxes(sayshape.boxes, (b) => { if (!map.has(b.node.id)) map.set(b.node.id, b); });
    return map;
  };

  const findAll = (query: Query): Found[] => {
    const q = typeof query === "string" ? { type: query } : query;
    const boxes = boxesById();
    const out: Found[] = [];
    const scope = sayshape.state.scope;
    const walk = (n: SayShapeNode) => {
      if (n.id !== "root") {
        const shownText = n.text === undefined ? undefined : interpolate(n.text, scopeOf(n, scope));
        const textOk =
          q.text === undefined ||
          (q.text instanceof RegExp
            ? (n.text !== undefined && q.text.test(n.text)) || (shownText !== undefined && q.text.test(shownText))
            : n.text === q.text || shownText === q.text);
        if ((q.type === undefined || n.type === q.type) && (q.line === undefined || n.line === q.line) && (q.id === undefined || n.id === q.id) && textOk) {
          out.push({ node: n, box: boxes.get(n.id) ?? null, shownText });
        }
      }
      // An each stands for its copies, one set per item; its if= picks items (see eachInstances).
      if (n.type === "each") eachInstances(n, scopeOf(n, scope)).forEach(walk);
      else n.children.forEach(walk);
    };
    if (sayshape.tree) walk(sayshape.tree);
    return out;
  };

  const find = (query: Query): Found => {
    const all = findAll(query);
    if (all.length === 1) return all[0]!;
    if (!all.length) throw new Error(`No element matches ${describeQuery(query)}`);
    const where = all.map((f) => (f.node.id.includes("#") ? f.node.id : `line ${f.node.line}`)).join(", ");
    throw new Error(`${all.length} elements match ${describeQuery(query)} (${where}). Add text, line or id to the query`);
  };

  const pointer = (type: string, x: number, y: number) => canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });

  /** A point inside the element's first pressable region that the element itself receives. */
  const pressPoint = (query: Query): readonly [number, number] => {
      const found = find(query);
      const name = `"${found.node.type}" on line ${found.node.line}`;
      if (!found.box) throw new Error(`${name} is hidden, so it can't be pressed`);
      // Its own region first: the one a tip= adds under it only shows the tip.
      const mine = sayshape.hitRegions.filter((h) => h.box.node.id === found.node.id);
      const region = mine.find((h) => h.detail !== "tip") ?? mine[0];
      if (!region) throw new Error(`${name} isn't pressable right now (it may be disabled or not interactive)`);
      // Click the centre, or the first point in the region that this element
      // receives itself (a button inside a pressable card covers its centre).
      const b = region.box;
      const ours = (x: number, y: number) => {
        const t = sayshape.targetAt(x, y);
        return !!t && t.node.id === found.node.id && t.detail === region.detail;
      };
      const points = [[0.5, 0.5], ...[0.1, 0.3, 0.5, 0.7, 0.9].flatMap((fy) => [0.05, 0.25, 0.5, 0.75, 0.95].map((fx) => [fx, fy]))];
      const at = points.map(([fx, fy]) => [b.x + b.w * fx!, b.y + b.h * fy!] as const).find(([x, y]) => ours(x, y));
      if (!at) throw new Error(`${name} is covered by other pressable elements, so it can't be pressed`);
      return at;
  };

  const ui: Rendered = {
    sayshape,
    canvas,
    get state() { return sayshape.state.snapshot(); },
    get diagnostics() { return sayshape.diagnostics; },
    get emitted() { return emitted; },
    get warnings() { return warnings; },
    get drawOps() { return drawOps; },
    get hits() { return sayshape.hitRegions; },
    get focused() { return sayshape.focus?.node ?? null; },
    get popup() { return sayshape.openPopupInfo; },
    get announcements() { return announcements; },
    clock: {
      now: () => (manual ? manual.now() : 0),
      advance: (ms) => {
        if (!manual) throw new Error("This screen uses real time. Render it with behavior: true or clock: true to advance its clock");
        manual.advance(ms);
      },
      get pending() { return manual?.pending ?? 0; },
    },
    mirror: {
      get focused() { return mirrorState.focused; },
      get busy() { return mirrorState.busy; },
      get updates() { return mirrorState.updates; },
      get quietUpdates() { return mirrorState.quiet; },
      keyOf(query) {
        const found = find(query);
        // An element's own node comes before its parts, in reading order.
        const node = findNode(sayshape.accessibilityTree(), (n) => n.node.id === found.node.id);
        if (!node) throw new Error(`"${found.node.type}" on line ${found.node.line} has no node of its own in the accessibility tree`);
        return node.key;
      },
      activate(key) { mirrorState.events?.activate(key); flush(); },
      focus(key) { mirrorState.events?.focus(key); flush(); },
      key(key, o = {}) {
        let prevented = false;
        mirrorState.events?.key({ key, shiftKey: !!o.shift, preventDefault: () => { prevented = true; } });
        flush();
        return prevented;
      },
      step(key, direction) { mirrorState.events?.step(key, direction); flush(); },
      blur() { mirrorState.events?.blur(); flush(); },
    },
    accessibility: ((o?: { full: true }) => {
      const tree = sayshape.accessibilityTree();
      if (!tree) throw new Error("Nothing has been rendered yet");
      return o?.full ? tree : summarize(tree);
    }) as Rendered["accessibility"],

    findAll,
    find,
    isShown: (query) => find(query).box !== null,
    text: () => drawOps.filter((d) => d.op === "fillText").map((d) => String(d.args[0])),
    copyText: () => sayshape.copyText(),

    wheel(x, y, deltaY, o = {}) {
      canvas.dispatch("wheel", { clientX: x, clientY: y, deltaY, deltaX: o.deltaX ?? 0, shiftKey: !!o.shift });
      flush();
    },

    press(query) {
      const at = pressPoint(query);
      ui.click(at[0], at[1]);
    },

    drag(query, toX, toY) {
      const [x0, y0] = pressPoint(query);
      const y1 = toY ?? y0;
      pointer("pointermove", x0, y0);
      pointer("pointerdown", x0, y0);
      flush();
      for (const f of [0.25, 0.5, 0.75, 1]) {
        pointer("pointermove", x0 + (toX - x0) * f, y0 + (y1 - y0) * f);
        flush();
      }
      pointer("pointerup", toX, y1);
      flush();
    },

    click(x, y) {
      pointer("pointermove", x, y);
      pointer("pointerdown", x, y);
      pointer("pointerup", x, y);
      flush();
    },

    key(key, o = {}) {
      // While a field is being typed in, keys go to its text box, as in a browser.
      const open = editor.current;
      if (open) {
        const handled = open.events.key(key, !!o.shift);
        if (!handled && key === "Tab") open.events.blur();
      } else canvas.dispatch("keydown", { key, shiftKey: !!o.shift });
      flush();
    },

    type(query, text, o = {}) {
      const found = find(query);
      if (editor.current?.node !== found.node.id) ui.press(query);
      const open = editor.current;
      if (!open || open.node !== found.node.id) throw new Error(`"${found.node.type}" on line ${found.node.line} can't be typed in`);
      if (o.replace) { open.spec.value = ""; open.events.input(""); flush(); }
      for (const ch of text) {
        // Like a browser's maxlength: characters past the limit aren't added.
        const now = editor.current ?? open;
        if (now.spec.value.length >= now.spec.max) break;
        now.spec.value += ch;
        now.events.input(now.spec.value);
        flush();
      }
    },
    get editor() { return editor.current ? editor.current.spec : null; },

    tab(back = false) {
      ui.key("Tab", { shift: back });
    },

    set(key, value) {
      sayshape.state.set(key, value);
      flush();
    },

    setSpec(next, o) {
      sayshape.setSpec(next, o);
      flush();
    },

    stream(chunks, o) {
      sayshape.beginStream(o);
      flush();
      for (const c of chunks) {
        sayshape.push(c);
        flush();
      }
      sayshape.endStream();
      flush();
    },

    destroy() {
      sayshape.destroy();
    },
  };
  return ui;
}

/** The mirror, as sayshape/testing records it, with the events a screen reader would send. */
export interface Mirror {
  /** The node key the engine last asked to hold DOM focus. */
  readonly focused: string | null;
  /** Whether the last update said the screen was busy (streaming or loading). */
  readonly busy: boolean;
  /** How many times the mirror was rebuilt. */
  readonly updates: number;
  /** How many of those rebuilds came from rules ticking (behavior on), kept quiet. */
  readonly quietUpdates: number;
  /** The key of an element's own node, for the methods below. */
  keyOf(query: Query): string;
  /** Activate a node, as a screen reader's double tap does. */
  activate(key: string): void;
  /** Move to a node, as a screen reader's focus does. */
  focus(key: string): void;
  /** Press a key while a mirror node has focus. Returns whether the engine stopped the browser's own handling. */
  key(key: string, opts?: { shift?: boolean }): boolean;
  /** Nudge a slider one step, as phones' screen readers do. */
  step(key: string, direction: 1 | -1): void;
  /** DOM focus left the mirror for the rest of the page. */
  blur(): void;
}

function findNode(n: AccessibleNode | null, test: (n: AccessibleNode) => boolean): AccessibleNode | null {
  if (!n) return null;
  if (test(n)) return n;
  for (const c of n.children) {
    const f = findNode(c, test);
    if (f) return f;
  }
  return null;
}

/** Something a screen reader was told. */
export interface Announcement {
  text: string;
  politeness: Politeness;
}

/**
 * One accessibility node, compactly: its role, its name, and its state
 * written as words ("checked", "disabled", "value 3"), then its children.
 */
export interface AccessibleSummary {
  role: string;
  name?: string;
  state?: string[];
  children?: AccessibleSummary[];
}

const STATE_FLAGS = ["selected", "expanded", "disabled", "pressed", "required", "invalid", "multiselectable"] as const;

function summarize(n: AccessibleNode): AccessibleSummary {
  const state: string[] = [];
  if (n.checked !== undefined) state.push(n.checked === "mixed" ? "mixed" : n.checked ? "checked" : "not checked");
  for (const f of STATE_FLAGS) if (n[f] !== undefined) state.push(n[f] ? f : `not ${f}`);
  if (n.current) state.push(n.current === true ? "current" : `current ${n.current}`);
  if (n.level !== undefined) state.push(`level ${n.level}`);
  if (n.sort) state.push(`sorted ${n.sort}`);
  if (n.value) {
    const v = n.value;
    if (v.text !== undefined) state.push(`value ${v.text}`);
    else if (v.now !== undefined) state.push(`value ${v.now}`);
    if (v.min !== undefined || v.max !== undefined) state.push(`range ${v.min ?? ""} to ${v.max ?? ""}`);
  }
  if (n.focusable) state.push("focusable");
  const out: AccessibleSummary = { role: n.role };
  if (n.name) out.name = n.name;
  if (state.length) out.state = state;
  if (n.children.length) out.children = n.children.map(summarize);
  return out;
}

/** The text box a fake editor host shows: what a person would see in it. */
export type FakeEditor = EditorSpec;

/**
 * The editor host for tests: no DOM, it keeps what the engine asked for, so
 * type() and key() can drive it like a person at a keyboard.
 */
class FakeEditorHost implements EditorHost {
  current: { spec: EditorSpec; events: EditorEvents; node: string | null } | null = null;
  constructor(private editingNode: () => string | null) {}
  open(spec: EditorSpec, events: EditorEvents): void {
    this.current = { spec: { ...spec }, events, node: this.editingNode() };
  }
  update(spec: EditorSpec): void {
    if (this.current) this.current = { ...this.current, spec: { ...spec }, node: this.editingNode() };
  }
  close(): void {
    this.current = null;
  }
}
