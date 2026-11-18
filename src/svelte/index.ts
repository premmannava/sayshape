/**
 * sayshape/svelte: SayShape as a Svelte action (Svelte 4 and 5, svelte is an optional peer dependency).
 *
 *   <div use:sayshape={{ spec, theme: "auto", onAction: (e) => console.log(e.name) }}></div>
 *
 * Plain JavaScript that needs no Svelte compiler and imports nothing from svelte.
 * The action puts a canvas inside the element it is used on and fills its width.
 */
import type { ComponentDef, SayShape } from "../index";
import { createSession, type ForwardedPayloads, type SayShapeWrapperOptions, type Session, type ThemeInput } from "../element/sync";

export type { ThemeInput, SayShapeWrapperOptions } from "../element/sync";

export interface SayShapeParams {
  /** The spec text. */
  spec: string;
  /** Treat spec as text that is still growing: only the new characters are pushed. */
  streaming?: boolean;
  /** "auto", "light", "dark" or a Theme object. */
  theme?: ThemeInput;
  /** Start from the spec's own initial state whenever spec changes, instead of keeping it. */
  resetStateOnChange?: boolean;
  /** Engine options. Read once, when the action starts: changing them needs the element to be recreated ({#key}). */
  options?: SayShapeWrapperOptions;
  /** Components to register. Read once, when the action starts. Default: the core components. */
  components?: ComponentDef[];
  /** Called once with the engine, right after it is created. */
  onReady?: (engine: SayShape) => void;
  onAction?: (event: ForwardedPayloads["action"]) => void;
  onChange?: (event: ForwardedPayloads["change"]) => void;
  onDiagnostics?: (event: ForwardedPayloads["diagnostics"]) => void;
  onNavigate?: (event: ForwardedPayloads["navigate"]) => void;
  onNotify?: (event: ForwardedPayloads["notify"]) => void;
  onRender?: (event: ForwardedPayloads["render"]) => void;
}

const HANDLERS = {
  action: "onAction",
  change: "onChange",
  diagnostics: "onDiagnostics",
  navigate: "onNavigate",
  notify: "onNotify",
  render: "onRender",
} as const;

export function sayshape(node: HTMLElement, params: SayShapeParams): { update(params: SayShapeParams): void; destroy(): void } {
  let latest = params;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  node.append(canvas);

  // Handlers are looked up when an event fires, so a new callback takes effect without touching the engine.
  const session: Session = createSession(
    canvas,
    {
      options: params.options,
      components: params.components,
      emit: (name, payload) => (latest[HANDLERS[name]] as ((p: unknown) => void) | undefined)?.(payload),
    },
    params,
  );
  params.onReady?.(session.engine);

  return {
    update(next) {
      latest = next;
      session.update(next);
    },
    destroy() {
      session.destroy();
      canvas.remove();
    },
  };
}

export default sayshape;
