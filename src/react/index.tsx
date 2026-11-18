"use client";
/**
 * sayshape/react: render a SayShape spec from React.
 *
 *   <SayShape spec={spec} onAction={handle} />
 *
 * The engine is created once, in an effect (so never on the server), and
 * destroyed in that effect's cleanup (so React's StrictMode double mount
 * leaves exactly one). Everything else a prop can change is applied to that
 * engine: a new spec, streaming text, a theme. Handlers are read through a
 * ref, so passing a new inline function never resubscribes anything.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from "react";
import { SayShape as Engine, coreComponents, type SayShapeEvents, type SayShapeOptions, type Theme, type ComponentDef } from "../index";

export type { SayShapeEvents, SayShapeOptions, Theme, ComponentDef };

/** The engine's options the wrapper doesn't take as props of their own. Read once, when the engine is created. */
export type SayShapeEngineOptions = Omit<SayShapeOptions, "components">;

export interface SayShapeProps {
  /** The spec. A new string replaces the screen, keeping state unless `resetStateOnChange`. */
  spec: string;
  /** Reset state to the spec's initial values whenever `spec` changes. Default false. */
  resetStateOnChange?: boolean;
  /**
   * Treat `spec` as text still arriving: it only grows, and only the new part
   * is pushed to the engine. Turn it off when the text is complete.
   */
  streaming?: boolean;
  /** A theme, or "auto" to follow light and dark mode. Applied to the running engine, never by recreating it. */
  theme?: Theme | "auto";
  /** Engine options (animate, imageHosts, loadImage, ...). Read once: change them by giving the component a new `key`. */
  options?: SayShapeEngineOptions;
  /** Components to register. Default: the core components. Read once: change them by giving the component a new `key`. */
  components?: ComponentDef[];
  /** An `emit:` action ran. */
  onAction?: (event: SayShapeEvents["action"]) => void;
  /** A state value changed. */
  onChange?: (event: SayShapeEvents["change"]) => void;
  /** The spec's problems changed. */
  onDiagnostics?: (diagnostics: SayShapeEvents["diagnostics"]) => void;
  /** The visible screen changed. */
  onNavigate?: (event: SayShapeEvents["navigate"]) => void;
  /** A `notify:` action showed a message. */
  onNotify?: (event: SayShapeEvents["notify"]) => void;
  /** A frame was painted. */
  onRender?: (metrics: SayShapeEvents["render"]) => void;
  /** Class for the element that holds the canvas. */
  className?: string;
  /** Style for the element that holds the canvas. */
  style?: CSSProperties;
}

type Handlers = Pick<SayShapeProps, "onAction" | "onChange" | "onDiagnostics" | "onNavigate" | "onNotify" | "onRender">;

/** What the engine has been given so far, so a prop change turns into only the calls it needs. */
interface Live {
  engine: Engine;
  /** The spec text the engine holds, or null before the first one. */
  text: string | null;
  streaming: boolean;
  theme: Theme | "auto" | undefined;
}

// useLayoutEffect warns when rendered on a server (React 18); nothing runs there anyway.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function SayShapeImpl(props: SayShapeProps, ref: Ref<Engine>): ReactElement {
  const { spec, resetStateOnChange = false, streaming = false, theme, options, components, className, style } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live | null>(null);

  // The latest handlers and creation-time inputs, so the effects below can have no dependencies on them.
  const handlers = useRef<Handlers>(props);
  const creation = useRef({ theme, options, components });
  const latest = useRef({ spec, streaming, resetStateOnChange });
  useIsoLayoutEffect(() => {
    handlers.current = props;
    latest.current = { spec, streaming, resetStateOnChange };
  });

  // One engine per mount: made here, destroyed in the cleanup. StrictMode runs
  // create, destroy, create, so a second engine never sits on the same canvas.
  useIsoLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { theme: t, options: o, components: c } = creation.current;
    const initialTheme = t ?? o?.theme;
    const engine = new Engine(canvas, { ...o, components: c ?? coreComponents, ...(initialTheme !== undefined ? { theme: initialTheme } : {}) });
    const state: Live = { engine, text: null, streaming: false, theme: initialTheme };
    live.current = state;

    const off = [
      engine.on("action", (e) => handlers.current.onAction?.(e)),
      engine.on("change", (e) => handlers.current.onChange?.(e)),
      engine.on("diagnostics", (e) => handlers.current.onDiagnostics?.(e)),
      engine.on("navigate", (e) => handlers.current.onNavigate?.(e)),
      engine.on("notify", (e) => handlers.current.onNotify?.(e)),
      engine.on("render", (e) => handlers.current.onRender?.(e)),
    ];
    // The spec the engine starts with is whatever the props say now.
    applySpec(state, latest.current.spec, latest.current.streaming, latest.current.resetStateOnChange);

    return () => {
      off.forEach((f) => f());
      engine.destroy();
      live.current = null;
    };
  }, []);

  // The forwarded ref gets the engine (null until it exists, and again after unmount).
  useImperativeHandle(ref, () => live.current?.engine as Engine);

  useIsoLayoutEffect(() => {
    const state = live.current;
    if (state) applySpec(state, spec, streaming, resetStateOnChange);
  }, [spec, streaming, resetStateOnChange]);

  useIsoLayoutEffect(() => {
    const state = live.current;
    if (!state) return;
    const next = theme ?? creation.current.options?.theme;
    if (next === state.theme) return;
    state.theme = next;
    state.engine.setTheme(next ?? "auto");
  }, [theme]);

  // The engine sizes the canvas to this element's width and follows its resizing.
  // min-width 0 lets it shrink inside a flex or grid container.
  return (
    <div className={className} style={{ minWidth: 0, ...style }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

/**
 * Bring the engine in line with the props.
 *
 * Not streaming: a changed string is a setSpec (state kept unless asked).
 * Streaming: the text is treated as growing, so only the new characters are
 * pushed. If it shrinks or stops being an extension of what the engine has,
 * the stream starts over. When streaming turns off, the engine is caught up
 * with the final text and told the stream ended.
 */
function applySpec(live: Live, spec: string, streaming: boolean, reset: boolean): void {
  const { engine } = live;
  if (streaming || live.streaming) {
    if (!live.streaming || live.text === null || !spec.startsWith(live.text)) {
      engine.beginStream({ keepState: !reset });
      live.streaming = true;
      live.text = "";
    }
    const added = spec.slice(live.text!.length);
    if (added) engine.push(added);
    live.text = spec;
    if (!streaming) {
      engine.endStream();
      live.streaming = false;
    }
    return;
  }
  if (spec === live.text) return;
  engine.setSpec(spec, { resetState: reset });
  live.text = spec;
}

/**
 * Renders a SayShape spec onto a canvas that fills the width of its container.
 * The ref is the engine (`SayShape` from "sayshape"): `state`, `copyText()`, `diagnostics` and the rest.
 */
export const SayShape = forwardRef<Engine, SayShapeProps>(SayShapeImpl);
SayShape.displayName = "SayShape";

export default SayShape;
