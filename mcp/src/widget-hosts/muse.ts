/**
 * The Muse adapter: connects a SayShape interface in a Muse widget to the
 * app's state bridge, the only documented way out of a widget.
 *
 * - emit: actions are added to a short list in the bridge state, beside the
 *   interface's state, for the model to read with its tool on the next turn.
 * - The interface's state is saved there too (throttled, without passwords,
 *   and skipped when it's too big for the model to read cheaply), and put
 *   back when the widget is mounted again.
 * - Newer state from the bridge is applied, and never answered with a write:
 *   every write is echoed back, so answering would loop.
 * - The app's colors, once they arrive, become the interface's theme, made
 *   readable, unless the server chose a theme itself.
 *
 * museAdapter is shipped as its own source text (MUSE_SOURCE) and called by
 * the widget file's loader as `(SOURCE)(ui, S, root)`, so it must stand alone:
 * no imports at run time, nothing from outside its body, ES2020 syntax, and
 * no browser-storage names anywhere in it, comments included, because Muse
 * rejects widgets whose source mentions them.
 */
import type { AdapterAction, AdapterHooks, AdapterEngine, AdapterNode, AdapterOptions, AdapterUi } from "./types";

/** Saves of the interface's state stop above this many bytes of JSON. */
export const STATE_LIMIT = 8192;

export function museAdapter(ui: AdapterUi, S: AdapterEngine, root: unknown, options?: AdapterOptions): AdapterHooks {
  // Everything Muse calls its bridge, its event and its colors, in one place.
  const MUSE = {
    bridge: "hatchWidget",
    stateEvent: "hatch-widget-state",
    cssPrefix: "--hatch-widget-",
    colors: ["bg", "surface", "surface-muted", "text", "muted", "border", "accent", "on-accent", "focus", "shadow"],
  };
  const NOTICE = "Saved. Send a message to continue.";

  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  type Obj = { [key: string]: Json };
  type Step = string | number;
  interface Bridge {
    getState(defaults: Obj): unknown;
    setState(next: Obj): unknown;
  }
  interface Host {
    addEventListener?(type: string, fn: (e: Event) => void): void;
    removeEventListener?(type: string, fn: (e: Event) => void): void;
    getComputedStyle?(el: unknown): { getPropertyValue(name: string): string };
    document?: { documentElement?: unknown; head?: unknown };
    MutationObserver?: new (fn: () => void) => { observe(target: unknown, o: Record<string, boolean>): void; disconnect(): void };
    TextEncoder?: new () => { encode(s: string): { length: number } };
  }

  const o = options || {};
  const stateLimit = typeof o.stateLimit === "number" ? o.stateLimit : 8192;
  const saveEvery = typeof o.saveEvery === "number" ? o.saveEvery : 500;
  const maxActions = typeof o.maxActions === "number" ? o.maxActions : 20;
  const host = globalThis as unknown as Host & Record<string, unknown>;
  const cleanups: Array<() => void> = [];
  const listen = (type: string, fn: (e: Event) => void) => {
    if (typeof host.addEventListener !== "function") return;
    host.addEventListener(type, fn);
    cleanups.push(() => host.removeEventListener && host.removeEventListener(type, fn));
  };

  const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
  const toJson = (v: unknown): Json => {
    try { const s = JSON.stringify(v); return s === undefined ? null : (JSON.parse(s) as Json); } catch (e) { return null; }
  };
  const bytes = (s: string): number => (host.TextEncoder ? new host.TextEncoder().encode(s).length : s.length);

  // ------------------------------------------------------------ passwords

  /**
   * Where password fields keep their values, as paths into state ("*" for
   * every item of a list), or null when one can't be told from the spec (a
   * field inside an each over a worked-out list): then nothing is saved.
   */
  const passwordPaths = (): Step[][] | null => {
    const out: Step[][] = [];
    let unknown = false;
    const IDENT = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
    const resolve = (raw: string | undefined, vars: Record<string, Step[] | null>): Step[] | null => {
      if (raw === undefined) return null;
      const path = raw.trim().replace(/^\{\s*([\s\S]*?)\s*\}$/, "$1");
      if (!IDENT.test(path)) return null;
      const parts = path.split(".");
      const first = parts[0] as string;
      if (Object.prototype.hasOwnProperty.call(vars, first)) {
        const base = vars[first];
        return base ? base.concat(parts.slice(1)) : null;
      }
      if (ui.state.isDerived(first)) return null;
      return parts;
    };
    const walk = (n: AdapterNode, vars: Record<string, Step[] | null>): void => {
      let inner = vars;
      if (n.type === "each") {
        const list = resolve(n.props.items, vars);
        inner = Object.assign({}, vars);
        inner[n.props.as || "item"] = list ? list.concat(["*"]) : null;
        if (n.props.index) inner[n.props.index] = null;
      }
      const kind = n.props.kind;
      if (n.type === "input" && kind !== undefined && (kind.trim() === "password" || kind.indexOf("{") >= 0)) {
        const where = n.props.bind === undefined ? [] : resolve(n.props.bind, vars);
        if (where === null) unknown = true;
        else if (where.length) out.push(where);
      }
      for (const c of n.children) walk(c, inner);
    };
    if (ui.tree) walk(ui.tree, {});
    return unknown ? null : out;
  };

  /** Removes (at the top) or blanks (inside a record) what each path points at; collects the values it found. */
  const scrub = (value: Obj, paths: Step[][], found: string[]): void => {
    const visit = (at: Json, path: Step[], i: number): void => {
      const step = path[i];
      if (step === undefined || at === null || typeof at !== "object") return;
      const last = i === path.length - 1;
      const keys: Step[] = step === "*" ? (Array.isArray(at) ? at.map((_x, k) => k) : []) : [step];
      for (const k of keys) {
        const holder = at as { [key: string]: Json };
        const v = holder[k];
        if (v === undefined) continue;
        if (!last) { visit(v, path, i + 1); continue; }
        if (typeof v === "string" && v) found.push(v);
        if (i === 0) delete holder[k];
        else holder[k] = "";
      }
    };
    for (const p of paths) visit(value, p, 0);
  };

  // ------------------------------------------------------------ the bridge

  const bridge = host[MUSE.bridge] as Bridge | undefined;
  const hasBridge = !!bridge && typeof bridge.getState === "function" && typeof bridge.setState === "function";
  const spec = (() => {
    // A fingerprint of the spec, so state saved for one interface isn't put into another.
    const text = ui.spec;
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8) + "-" + text.length;
  })();
  const defaults: Obj = { spec, state: null, actions: [] };

  /** The bridge's state as last read or written: every write starts from it, so nothing else in it is lost. */
  let current: Obj = defaults;
  /** The interface state the bridge holds, as JSON, to skip saves that would change nothing. */
  let saved = "null";
  /** What was written lately, as JSON: the bridge echoes each write back, maybe late. */
  const recent: string[] = [];
  let ready = false;
  let applying = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite = -Infinity;
  const waiting: AdapterAction[] = [];

  /** The interface's state as it would be saved, and why it isn't when it isn't. */
  const statePart = (): { json: string; value: Json; note?: string; passwords: string[] | null } => {
    const paths = passwordPaths();
    const value = toJson(ui.state.snapshot());
    if (!isObj(value)) return { json: "null", value: null, passwords: [] };
    if (!paths) return { json: "password", value: null, note: "Not saved: the interface has a password field", passwords: null };
    const passwords: string[] = [];
    scrub(value, paths, passwords);
    const json = JSON.stringify(value);
    if (bytes(json) > stateLimit) return { json, value: null, note: "Not saved: larger than " + stateLimit + " bytes", passwords };
    return { json, value, passwords };
  };

  const write = (next: Obj): void => {
    if (!bridge) return;
    try { bridge.setState(next); } catch (e) { return; }
    current = next;
    recent.push(JSON.stringify(next.state === undefined ? null : next.state));
    if (recent.length > 8) recent.shift();
    lastWrite = Date.now();
  };

  const withState = (part: { value: Json; note?: string }, extra?: Obj): Obj => {
    const next: Obj = Object.assign({}, current, { spec, state: part.value }, extra || {});
    if (part.note) next.stateNote = part.note;
    else delete next.stateNote;
    return next;
  };

  const saveNow = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const part = statePart();
    if (part.json === saved && current.spec === spec) return;
    saved = part.json;
    write(withState(part));
  };

  const scheduleSave = (): void => {
    if (!hasBridge || applying) return;
    if (!ready) { dirty = true; return; }
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; saveNow(); }, Math.max(0, lastWrite + saveEvery - Date.now()));
  };

  /** Put state from the bridge into the interface. Its changes are not the person's, so nothing is saved for them. */
  const apply = (state: Json): void => {
    if (!isObj(state)) return;
    const now = ui.state.snapshot();
    applying = true;
    try {
      for (const key of Object.keys(state)) {
        if (JSON.stringify(now[key]) === JSON.stringify(state[key])) continue;
        try { ui.state.set(key, state[key] as never); } catch (e) { /* a name that's derived now, or a value that can't be data */ }
      }
    } finally {
      applying = false;
    }
  };

  /** Take the bridge's state as the truth: the start, or newer state from elsewhere. */
  const adopt = (st: unknown): void => {
    current = isObj(st) ? st : defaults;
    if (current.spec === spec) {
      apply(current.state === undefined ? null : current.state);
      saved = JSON.stringify(current.state === undefined ? null : current.state);
    } else {
      // Saved for another interface (or nothing saved yet): this one's state replaces it on the next save.
      saved = "\u0000";
    }
  };

  const record = (action: AdapterAction): void => {
    const part = statePart();
    let value: Json = toJson(action.value === undefined ? null : action.value);
    if (part.passwords === null) value = null;
    else if (part.passwords.length) {
      const hide = (v: Json): Json => {
        if (typeof v === "string") return part.passwords && part.passwords.indexOf(v) >= 0 ? "" : v;
        if (Array.isArray(v)) return v.map(hide);
        if (isObj(v)) { const r: Obj = {}; for (const k of Object.keys(v)) r[k] = hide(v[k] as Json); return r; }
        return v;
      };
      value = hide(value);
    }
    if (bytes(JSON.stringify(value)) > stateLimit / 4) value = null;
    const list = Array.isArray(current.actions) ? current.actions.slice() : [];
    list.push({ name: action.name, value, at: new Date().toISOString() });
    while (list.length > maxActions) list.shift();
    if (timer !== null) { clearTimeout(timer); timer = null; }
    saved = part.json;
    write(withState(part, { actions: list }));
  };

  const begin = (st: unknown): void => {
    if (ready) return;
    adopt(st);
    ready = true;
    for (const a of waiting.splice(0)) record(a);
    if (dirty || current.spec !== spec) { dirty = false; scheduleSave(); }
  };

  if (hasBridge && bridge) {
    cleanups.push(ui.on("change", () => scheduleSave()));
    listen(MUSE.stateEvent, (e: Event) => {
      const detail = (e as Event & { detail?: unknown }).detail;
      const st = isObj(detail) ? detail.state : undefined;
      if (!isObj(st)) return;
      if (!ready) { begin(st); return; }
      // An echo of one of this widget's own writes, maybe an older one: nothing new, and never answered.
      if (recent.indexOf(JSON.stringify(st.state === undefined ? null : st.state)) >= 0) return;
      adopt(st);
    });
    let got: unknown;
    try { got = bridge.getState(defaults); } catch (e) { got = undefined; }
    if (got && typeof (got as { then?: unknown }).then === "function") {
      (got as Promise<unknown>).then(begin, () => begin(undefined));
    } else {
      begin(got);
    }
  }

  // ------------------------------------------------------------ colors

  if (!o.ignoreAppColors) {
    const fromMessage: Record<string, string> = {};
    const rgb = (v: string | undefined): [number, number, number] | null => {
      const s = (v || "").trim().toLowerCase();
      let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
      if (m) {
        let h = m[1] as string;
        if (h.length === 3) h = h.split("").map((c) => c + c).join("");
        if (h.length === 8 && h.slice(6) !== "ff") return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
      if (!m) return null;
      if (m[4] !== undefined && Number(m[4]) < (m[5] ? 100 : 1)) return null;
      const c: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return c.every((x) => Number.isFinite(x) && x <= 255) ? c : null;
    };
    const hex = (c: [number, number, number]): string =>
      "#" + c.map((x) => ("0" + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2)).join("");
    const color = (v: string | undefined): string | null => { const c = rgb(v); return c ? hex(c) : null; };
    const lum = (v: string): number => {
      const c = rgb(v) || [0, 0, 0];
      const lin = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    };
    const contrast = (a: string, b: string): number => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const mix = (a: string, b: string, t: number): string => {
      const x = rgb(a) || [0, 0, 0], y = rgb(b) || [0, 0, 0];
      return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
    };
    /** The color, moved toward white or near-black by the least amount that reads at min:1 on every background. */
    const readable = (want: string, backs: string[], min: number): string => {
      const ok = (c: string) => backs.every((b) => contrast(c, b) >= min);
      if (ok(want)) return want;
      const toward = lum(backs[0] as string) > 0.18 ? "#0b0f14" : "#ffffff";
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const t = (lo + hi) / 2; if (ok(mix(want, toward, t))) hi = t; else lo = t; }
      let out = mix(want, toward, hi);
      for (let t = hi; !ok(out) && t < 1; t = Math.min(1, t + 0.01)) out = mix(want, toward, t);
      return out;
    };

    const read = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const doc = host.document;
      const el = root && typeof root === "object" ? root : doc && doc.documentElement;
      let style: { getPropertyValue(name: string): string } | null = null;
      try { style = el && typeof host.getComputedStyle === "function" ? host.getComputedStyle(el) : null; } catch (e) { style = null; }
      for (const name of MUSE.colors) {
        const v = fromMessage[name] || (style ? style.getPropertyValue(MUSE.cssPrefix + name) : "");
        if (v && v.trim()) out[name] = v.trim();
      }
      return out;
    };

    /** The app's colors as the interface's theme: its background, cards, text and accent, each kept readable. */
    const themeOf = (c: Record<string, string>): unknown => {
      const surface = color(c.bg);
      const text = color(c.text);
      if (!surface || !text) return null;
      const dark = lum(surface) < 0.18;
      const base = dark ? S.darkTheme : S.lightTheme;
      const raised = color(c.surface) || (dark ? mix(surface, text, 0.045) : surface);
      const backs = [surface, raised];
      const ink = readable(text, backs, 4.5);
      const accent = readable(color(c.accent) || (base.colors.accent as string), backs, 4.5);
      const onWanted = color(c["on-accent"]);
      const onAccent = onWanted && contrast(onWanted, accent) >= 4.5
        ? onWanted
        : contrast(accent, "#ffffff") >= contrast(accent, "#0b0f14") ? "#ffffff" : "#0b0f14";
      const colors: Record<string, string> = {
        surface,
        raised,
        ink,
        muted: readable(color(c.muted) || mix(ink, surface, 0.35), backs, 4.5),
        line: color(c.border) || mix(ink, surface, 0.82),
        control: readable(color(c.border) || mix(ink, surface, 0.55), backs, 3),
        accent,
        accent2: accent,
        onAccent,
        series1: accent,
        focus: readable(color(c.focus) || accent, backs, 3),
        good: readable(base.colors.good as string, backs, 4.5),
        warn: readable(base.colors.warn as string, backs, 4.5),
        bad: readable(base.colors.bad as string, backs, 4.5),
      };
      return S.extendTheme(base as never, { name: base.name + " (app)", colors });
    };

    let shown = "";
    const update = (): void => {
      try {
        const c = read();
        const key = JSON.stringify(c);
        if (key === shown) return;
        const theme = themeOf(c);
        if (!theme) return;
        shown = key;
        ui.setTheme(theme as never);
      } catch (e) { /* the interface keeps the colors it has */ }
    };

    listen("message", (e: Event) => {
      const data = (e as Event & { data?: unknown }).data;
      const vars = isObj(data) ? data.cssVariables : undefined;
      if (!isObj(vars)) return;
      for (const k of Object.keys(vars)) {
        const v = vars[k];
        const name = k.replace(/^--/, "").replace(/^hatch-widget-/, "");
        if (typeof v === "string" && MUSE.colors.indexOf(name) >= 0) fromMessage[name] = v;
      }
      update();
    });
    // The CSS variables may change after load, with no message: watch the root's attributes and the page's style sheets.
    const doc = host.document;
    if (host.MutationObserver && doc) {
      try {
        const watch = new host.MutationObserver(update);
        if (doc.documentElement) watch.observe(doc.documentElement, { attributes: true });
        if (doc.head) watch.observe(doc.head, { childList: true, subtree: true, characterData: true });
        cleanups.push(() => watch.disconnect());
      } catch (e) { /* no watching: messages and the checks below still work */ }
    }
    for (const ms of [0, 250, 1000, 3000]) {
      const t = setTimeout(update, ms);
      cleanups.push(() => clearTimeout(t));
    }
  }

  return {
    emit(action: AdapterAction | string): void {
      if (!hasBridge) return;
      const a: AdapterAction = typeof action === "string" ? { name: action } : { name: String(action && action.name), value: action && action.value };
      if (!ready) waiting.push(a);
      else record(a);
      ui.notify(NOTICE);
    },
    destroy(): void {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      for (const f of cleanups.splice(0)) { try { f(); } catch (e) { /* already gone */ } }
    },
  };
}

/** museAdapter's source, for the widget file's loader to call as `(MUSE_SOURCE)(ui, S, root)`. */
export const MUSE_SOURCE: string = museAdapter.toString();
