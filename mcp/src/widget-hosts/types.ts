/**
 * What a widget-host adapter is given and gives back. Types only: an adapter
 * is shipped as the source text of one function (see index.ts), so nothing
 * here may be needed at run time.
 *
 * These describe just the parts of the engine an adapter uses, structurally,
 * so a test can pass the real SayShape instance and the real theme helpers.
 */

/** A spec element as the engine's parse tree holds it: raw prop strings. */
export interface AdapterNode {
  type: string;
  props: Record<string, string>;
  children: AdapterNode[];
}

/** The SayShape instance (`ui` in the loader). */
export interface AdapterUi {
  readonly spec: string;
  readonly tree: AdapterNode | null;
  readonly state: {
    snapshot(): Record<string, unknown>;
    // The engine's Value type is narrower; an adapter only passes back what it read as JSON.
    set(key: string, value: never): void;
    isDerived(key: string): boolean;
  };
  on(name: "change", fn: (p: { key: string }) => void): () => void;
  notify(text: string): void;
  setTheme(theme: never): void;
}

/** A theme's colors, as far as an adapter reads and writes them. */
export interface AdapterTheme {
  name: string;
  colors: Record<string, string>;
}

/** The engine's browser global (`S` in the loader): what src/browser.ts exports. */
export interface AdapterEngine {
  lightTheme: AdapterTheme;
  darkTheme: AdapterTheme;
  extendTheme(from: never, patch: { name?: string; colors?: Record<string, string> }): unknown;
}

/** Settings the server bakes into the adapter's source (index.ts adapterSource). */
export interface AdapterOptions {
  /** The server was given --theme, --accent or --colors: keep the interface's own colors, ignore the app's. */
  ignoreAppColors?: boolean;
  /** Skip saving the interface's state when it serializes to more bytes than this. Default STATE_LIMIT. */
  stateLimit?: number;
  /** The least time between two saves of the interface's state, in milliseconds. Default 500. */
  saveEvery?: number;
  /** How many emitted actions the bridge keeps, newest last. Default 20. */
  maxActions?: number;
}

/** An emit: action as the loader passes it on. */
export interface AdapterAction {
  name: string;
  value?: unknown;
}

/** What an adapter returns to the loader. */
export interface AdapterHooks {
  emit(action: AdapterAction | string): void;
  /** Stop listening (for tests, and for a loader that remounts in place). */
  destroy(): void;
}

export type Adapter = (ui: AdapterUi, S: AdapterEngine, root: unknown, options?: AdapterOptions) => AdapterHooks;
