/**
 * What <say-shape>, the Vue component and the Svelte action share: one engine
 * on one canvas, kept in step with a spec, a theme and a streaming flag.
 *
 * Every wrapper behaves the same because they all go through `createSession`:
 *
 * - a spec change calls setSpec and keeps state (unless resetStateOnChange),
 *   and is skipped when the string didn't change;
 * - with streaming on, the spec is text that is still growing: beginStream
 *   once, push only what was added, endStream when streaming turns off. A spec
 *   that shrinks or stops being a prefix of what was streamed starts the
 *   stream again;
 * - a theme change calls setTheme, never a new engine;
 * - `options` and `components` are read once, when the engine is created;
 * - destroy() unsubscribes every listener and destroys the engine, and a
 *   canvas never has two engines.
 *
 * The engine comes from the core entry (`../index`), so the build shares the
 * core chunks and this file adds no framework code.
 */
import { SayShape, coreComponents, darkTheme, lightTheme, type ComponentDef, type SayShapeEvents, type SayShapeOptions, type Theme } from "../index";

/** A theme as a wrapper takes it: a Theme object, "auto", or the names of the two built-in themes. */
export type ThemeInput = Theme | "auto" | "light" | "dark";

/** The engine events the wrappers pass on. */
export const FORWARDED_EVENTS = ["action", "change", "diagnostics", "navigate", "notify", "render"] as const;
export type ForwardedEvent = (typeof FORWARDED_EVENTS)[number];
export type ForwardedPayloads = Pick<SayShapeEvents, ForwardedEvent>;

/** The options the wrappers take from the host; components and theme have props of their own. */
export type SayShapeWrapperOptions = Omit<SayShapeOptions, "components" | "theme">;

/** What changes while the engine lives. */
export interface SyncProps {
  spec: string;
  streaming?: boolean;
  theme?: ThemeInput;
  resetStateOnChange?: boolean;
}

/** What is read once, when the engine is created. */
export interface SessionConfig {
  options?: SayShapeWrapperOptions;
  components?: ComponentDef[];
  /** Called for each forwarded engine event. */
  emit: <K extends ForwardedEvent>(name: K, payload: ForwardedPayloads[K]) => void;
}

export interface Session {
  readonly engine: SayShape;
  /** Bring the engine in line with these props. Safe to call as often as you like: unchanged values do nothing. */
  update(props: SyncProps): void;
  /** Unsubscribe every listener and destroy the engine. */
  destroy(): void;
}

export function resolveThemeInput(theme: ThemeInput | undefined): Theme | "auto" {
  if (theme === "light") return lightTheme;
  if (theme === "dark") return darkTheme;
  return theme ?? "auto";
}

/** The session that owns each canvas, so a second one replaces the first instead of sitting beside it. */
const owners = new WeakMap<HTMLCanvasElement, Session>();

export function createSession(canvas: HTMLCanvasElement, config: SessionConfig, initial: SyncProps): Session {
  owners.get(canvas)?.destroy();

  const engineOptions: SayShapeOptions = {
    ...config.options,
    components: config.components ?? (config.options as Partial<SayShapeOptions> | undefined)?.components ?? coreComponents,
    ...(initial.theme !== undefined ? { theme: resolveThemeInput(initial.theme) } : {}),
  };
  const engine = new SayShape(canvas, engineOptions);

  const listen = <K extends ForwardedEvent>(name: K) => engine.on(name, (payload) => config.emit(name, payload));
  const unsubscribe = FORWARDED_EVENTS.map((name) => listen(name));

  let theme = initial.theme;
  // Text already given to the engine as a stream, or null when no stream is running.
  let streamed: string | null = null;
  let spec = engine.spec;
  let destroyed = false;

  const syncStream = (text: string, reset: boolean) => {
    if (streamed !== null && text.startsWith(streamed)) {
      if (text.length > streamed.length) engine.push(text.slice(streamed.length));
    } else {
      // Starting, or the text shrank or changed under us: start the stream again.
      engine.beginStream({ keepState: !reset });
      if (text) engine.push(text);
    }
    streamed = text;
  };

  const update = (props: SyncProps) => {
    if (destroyed) return;
    const reset = props.resetStateOnChange === true;

    if (props.theme !== theme) {
      theme = props.theme;
      engine.setTheme(resolveThemeInput(theme));
    }

    const text = props.spec ?? "";
    if (props.streaming) {
      if (streamed === null || text !== streamed) syncStream(text, reset);
      spec = text;
      return;
    }
    if (streamed !== null) {
      // Streaming just turned off: make sure the engine has all of the text, then close the stream.
      if (text !== streamed) syncStream(text, reset);
      engine.endStream();
      streamed = null;
      spec = text;
      return;
    }
    if (text !== spec) {
      engine.setSpec(text, { resetState: reset });
      spec = text;
    }
  };

  const session: Session = {
    engine,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe.forEach((off) => off());
      engine.destroy();
      if (owners.get(canvas) === session) owners.delete(canvas);
    },
  };
  owners.set(canvas, session);
  update(initial);
  return session;
}
