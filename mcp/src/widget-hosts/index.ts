/**
 * Host adapters: each connects a SayShape interface to one chat app's widget
 * bridge. The widget file's loader takes an adapter as the source of a
 * function expression and calls it once, after the interface's first
 * ui.setSpec(spec):
 *
 *   var hooks = (SOURCE)(ui, S, root);
 *
 * where ui is the SayShape instance, S the engine's browser global and root
 * the fragment's wrapping element. It returns { emit(action) }, which gets
 * every emit: action except "link". A second app is a second file like
 * muse.ts, listed here.
 */
import { MUSE_SOURCE, STATE_LIMIT } from "./muse";
import type { AdapterOptions } from "./types";

export type { Adapter, AdapterAction, AdapterHooks, AdapterOptions } from "./types";
export { museAdapter, MUSE_SOURCE, STATE_LIMIT } from "./muse";

/** The apps there's an adapter for, by the name a server setting would use. */
export const WIDGET_HOSTS = {
  muse: { title: "Muse", source: MUSE_SOURCE },
} as const;

export type WidgetHostName = keyof typeof WIDGET_HOSTS;

export function isWidgetHost(name: string): name is WidgetHostName {
  return Object.prototype.hasOwnProperty.call(WIDGET_HOSTS, name);
}

/**
 * An adapter's source with the server's settings baked in, still a function
 * of (ui, S, root) for the loader. Settings go in as JSON, so nothing from
 * outside reaches the widget as code.
 */
export function adapterSource(name: WidgetHostName, options: AdapterOptions = {}): string {
  const num = (v: unknown, fallback?: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  const settings: AdapterOptions = {
    ignoreAppColors: options.ignoreAppColors === true,
    stateLimit: num(options.stateLimit, STATE_LIMIT),
    saveEvery: num(options.saveEvery),
    maxActions: num(options.maxActions),
  };
  // Settings are numbers and true or false only, so their JSON is safe anywhere in a script.
  const json = JSON.stringify(settings);
  return `function (ui, S, root) { return (${WIDGET_HOSTS[name].source})(ui, S, root, ${json}); }`;
}
