/**
 * sayshape/element: the <say-shape> web component.
 *
 *   <say-shape theme="auto" spec='text "Hello" style=title'></say-shape>
 *
 *   <say-shape>
 *     <script type="text/sayshape">
 *       state n=0
 *       button "Add" on=inc:n
 *     </script>
 *   </say-shape>
 *
 * Importing this module defines the element (safe to import twice).
 *
 * Light DOM, on purpose: the engine's accessibility mirror and text layer are
 * real DOM placed beside the canvas, and they need the page's own document
 * for focus (document.activeElement), selection (document.getSelection) and
 * caret lookups. A shadow root hides all three. See docs/integration/web-component.md.
 */
import type { ComponentDef, SayShape } from "../index";
import {
  createSession,
  type ForwardedEvent,
  type ForwardedPayloads,
  type SayShapeWrapperOptions,
  type Session,
  type SyncProps,
  type ThemeInput,
} from "./sync";

export type { ThemeInput, SayShapeWrapperOptions } from "./sync";

export const SCRIPT_TYPE = "text/sayshape";
const STYLE_ID = "sayshape-element-style";

// In Node (server rendering, tests of other code) there is no HTMLElement: the module still loads.
const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : class {}) as typeof HTMLElement;

type Props = {
  spec: string | undefined;
  streaming: boolean | undefined;
  theme: ThemeInput | undefined;
  resetStateOnChange: boolean | undefined;
};
const PROPS = ["spec", "streaming", "theme", "resetStateOnChange", "options", "components"] as const;

/** Remove the indentation every line of a spec in a <script> has in common, so the page can indent it. */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  let common = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    common = Math.min(common, /^[ \t]*/.exec(line)![0].length);
  }
  if (!Number.isFinite(common) || common === 0) return lines.join("\n");
  return lines.map((l) => l.slice(common)).join("\n");
}

function booleanAttribute(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value !== "false";
}

function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // :where() keeps this at zero specificity, so any page rule beats it.
  style.textContent = ":where(say-shape){display:block;min-width:0}";
  (document.head ?? document.documentElement).append(style);
}

export class SayShapeElement extends Base {
  static observedAttributes = ["spec", "theme", "streaming", "reset-state-on-change"];

  private props: Props = { spec: undefined, streaming: undefined, theme: undefined, resetStateOnChange: undefined };
  private _options: SayShapeWrapperOptions | undefined;
  private _components: ComponentDef[] | undefined;
  private session: Session | null = null;
  private wrapper: HTMLDivElement | null = null;
  private observer: MutationObserver | null = null;
  private pending = false;
  private syncQueued = false;

  /** The engine, once the element is connected; null before that and after it is removed. */
  get engine(): SayShape | null {
    return this.session?.engine ?? null;
  }

  /** The spec text. A property you set wins over the `spec` attribute, which wins over a child <script type="text/sayshape">. */
  get spec(): string {
    if (this.props.spec !== undefined) return this.props.spec;
    const attr = this.getAttribute("spec");
    if (attr !== null) return attr;
    return this.scriptSpec();
  }
  set spec(value: string | undefined | null) { this.props.spec = value ?? undefined; this.queueSync(); }

  /** Treat spec as text that is still growing (a model's stream). */
  get streaming(): boolean {
    return this.props.streaming ?? booleanAttribute(this.getAttribute("streaming")) ?? false;
  }
  set streaming(value: boolean | undefined) { this.props.streaming = value === undefined ? undefined : !!value; this.queueSync(); }

  /** "auto", "light", "dark" or a Theme object. As an attribute only the three names work. */
  get theme(): ThemeInput | undefined {
    if (this.props.theme !== undefined) return this.props.theme;
    const attr = this.getAttribute("theme");
    return attr === "auto" || attr === "light" || attr === "dark" ? attr : undefined;
  }
  set theme(value: ThemeInput | undefined | null) { this.props.theme = value ?? undefined; this.queueSync(); }

  get resetStateOnChange(): boolean {
    return this.props.resetStateOnChange ?? booleanAttribute(this.getAttribute("reset-state-on-change")) ?? false;
  }
  set resetStateOnChange(value: boolean | undefined) { this.props.resetStateOnChange = value === undefined ? undefined : !!value; this.queueSync(); }

  /** Engine options. Read once, when the element connects: set it before then, or reconnect the element. */
  get options(): SayShapeWrapperOptions | undefined { return this._options; }
  set options(value: SayShapeWrapperOptions | undefined) { this._options = value; }

  /** Components to register. Read once, when the element connects. Default: the core components. */
  get components(): ComponentDef[] | undefined { return this._components; }
  set components(value: ComponentDef[] | undefined) { this._components = value; }

  connectedCallback(): void {
    // A property set before the element was defined sits on the instance and hides the accessor.
    for (const name of PROPS) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = (this as unknown as Record<string, unknown>)[name];
        delete (this as unknown as Record<string, unknown>)[name];
        (this as unknown as Record<string, unknown>)[name] = value;
      }
    }
    // Moving an element disconnects then connects it: cancel the pending teardown and keep the engine.
    this.pending = false;
    if (this.session) {
      this.watch();
      return;
    }
    ensureStyle();
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    wrapper.append(canvas);
    this.append(wrapper);
    this.wrapper = wrapper;
    this.session = createSession(
      canvas,
      {
        options: this._options,
        components: this._components,
        emit: (name, payload) => this.forward(name, payload),
      },
      this.current(),
    );
    this.watch();
  }

  disconnectedCallback(): void {
    // Not yet: a move disconnects and reconnects in the same task. Wait a microtask.
    this.pending = true;
    queueMicrotask(() => {
      if (!this.pending || this.isConnected) return;
      this.pending = false;
      this.teardown();
    });
  }

  attributeChangedCallback(): void {
    this.queueSync();
  }

  private current(): SyncProps {
    return { spec: this.spec, streaming: this.streaming, theme: this.theme, resetStateOnChange: this.resetStateOnChange };
  }

  private scriptSpec(): string {
    for (const child of Array.from(this.children)) {
      if (child.tagName === "SCRIPT" && child.getAttribute("type") === SCRIPT_TYPE) return dedent(child.textContent ?? "");
    }
    return "";
  }

  /** Several property changes in one task become one update. */
  private queueSync(): void {
    if (!this.session || this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      this.session?.update(this.current());
    });
  }

  private watch(): void {
    if (this.observer || typeof MutationObserver === "undefined") return;
    // Only the <script> child's text matters; the engine's own DOM beside the canvas is ignored.
    this.observer = new MutationObserver((records) => {
      if (records.some((r) => !(this.wrapper && this.wrapper.contains(r.target)))) this.queueSync();
    });
    this.observer.observe(this, { childList: true, characterData: true, subtree: true });
  }

  private forward<K extends ForwardedEvent>(name: K, detail: ForwardedPayloads[K]): void {
    this.dispatchEvent(new CustomEvent(`sayshape-${name}`, { detail, bubbles: true, composed: true }));
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.session?.destroy();
    this.session = null;
    this.wrapper?.remove();
    this.wrapper = null;
  }
}

export interface SayShapeElementEventMap {
  "sayshape-action": CustomEvent<ForwardedPayloads["action"]>;
  "sayshape-change": CustomEvent<ForwardedPayloads["change"]>;
  "sayshape-diagnostics": CustomEvent<ForwardedPayloads["diagnostics"]>;
  "sayshape-navigate": CustomEvent<ForwardedPayloads["navigate"]>;
  "sayshape-notify": CustomEvent<ForwardedPayloads["notify"]>;
  "sayshape-render": CustomEvent<ForwardedPayloads["render"]>;
}

declare global {
  interface HTMLElementEventMap extends SayShapeElementEventMap {}
  interface HTMLElementTagNameMap {
    "say-shape": SayShapeElement;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("say-shape")) {
  customElements.define("say-shape", SayShapeElement);
}
