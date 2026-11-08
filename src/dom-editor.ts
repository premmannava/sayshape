/**
 * The browser's editor host: one real <input>, placed exactly over the field
 * being typed in, with the field's font and colors and a transparent
 * background. SayShape keeps painting the box, label and focus ring; the input
 * paints only the text, caret and selection.
 *
 * It sits right after the canvas in the page, so Tab from the last element
 * leaves the canvas to whatever comes next, as it would from a normal field.
 * It's position: fixed and follows the field through page scrolls, resizes
 * and layout changes.
 */
import type { EditorEvents, EditorHost, EditorSpec, InputKind } from "./editor";

const MARK = "data-sayshape-editor";

/** Styles an inline style can't set: the placeholder's color and the search box's clear button. */
function ensureSheet(): void {
  if (document.getElementById("sayshape-editor-style")) return;
  const style = document.createElement("style");
  style.id = "sayshape-editor-style";
  style.textContent = `[${MARK}]::placeholder{color:var(--sayshape-editor-placeholder);opacity:1}
[${MARK}]::-webkit-search-cancel-button,[${MARK}]::-webkit-search-decoration{-webkit-appearance:none}`;
  document.head.append(style);
}

const TYPES: Record<InputKind, string> = { text: "text", email: "email", number: "text", password: "password", search: "search" };

export function domEditorHost(canvas: HTMLCanvasElement): EditorHost {
  let el: HTMLInputElement | HTMLTextAreaElement | null = null;
  let events: EditorEvents | null = null;
  let spec: EditorSpec | null = null;
  let composing = false;
  let frame = 0;
  const cleanup: Array<() => void> = [];

  const place = (): void => {
    if (!el || !spec) return;
    const r = canvas.getBoundingClientRect();
    // The canvas's CSS size can differ from its layout width if a page scales it.
    const sx = canvas.offsetWidth ? r.width / canvas.offsetWidth : 1;
    const sy = canvas.offsetHeight ? r.height / canvas.offsetHeight : 1;
    const s = el.style;
    s.left = `${r.left + spec.rect.x * sx}px`;
    s.top = `${r.top + spec.rect.y * sy}px`;
    s.width = `${spec.rect.w * sx}px`;
    s.height = `${spec.rect.h * sy}px`;
  };
  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; place(); });
  };

  const style = (s: EditorSpec): void => {
    if (!el) return;
    Object.assign(el.style, {
      position: "fixed", zIndex: "2147483000", margin: "0", padding: "0", border: "0", outline: "none",
      background: "transparent", boxShadow: "none", boxSizing: "border-box", appearance: "none",
      font: s.font, lineHeight: (s.lines ?? 1) > 1 && s.lineHeight ? `${s.lineHeight}px` : "normal", color: s.color, caretColor: s.accent, textAlign: "left",
      // Several lines: no resize handle (the field's size is the canvas's), scrolling inside when longer.
      // The scrollbar is hidden so the text wraps exactly as the canvas draws it; the wheel and the caret still scroll it.
      resize: "none", overflow: (s.lines ?? 1) > 1 ? "auto" : "", scrollbarWidth: (s.lines ?? 1) > 1 ? "none" : "",
    });
    el.style.setProperty("--sayshape-editor-placeholder", s.muted);
    el.style.setProperty("-webkit-appearance", "none");
    el.placeholder = s.placeholder;
    el.maxLength = s.max;
    el.setAttribute("aria-label", s.label);
    // The field's required and problem, as screen readers hear them on the canvas's mirror.
    if (s.required) el.setAttribute("aria-required", "true"); else el.removeAttribute("aria-required");
    if (s.problem) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-description", s.problem); }
    else { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-description"); }
  };

  const close = (): void => {
    // Listeners go first, so removing a focused input never reports a blur.
    cleanup.splice(0).forEach((f) => f());
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    el?.remove();
    el = null;
    events = null;
    spec = null;
    composing = false;
  };

  return {
    open(s, ev) {
      close();
      ensureSheet();
      spec = s;
      events = ev;
      // Several lines are a <textarea>, where Enter starts a new line; one line is an <input>.
      const multi = (s.lines ?? 1) > 1;
      const input = (el = multi ? document.createElement("textarea") : document.createElement("input"));
      input.setAttribute(MARK, "");
      if (input instanceof HTMLInputElement) {
        input.type = TYPES[s.kind];
        if (s.kind === "number") input.inputMode = "decimal";
        if (s.kind === "email") input.autocomplete = "email";
        if (s.kind === "password") input.autocomplete = "current-password";
      } else input.rows = s.lines ?? 2;
      input.spellcheck = s.kind === "text";
      style(s);
      input.value = s.value;
      if (canvas.isConnected) canvas.insertAdjacentElement("afterend", input);
      else document.body.append(input);
      place();

      const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
        target.addEventListener(type, fn, opts);
        cleanup.push(() => target.removeEventListener(type, fn, opts));
      };
      // While an input method is composing (Chinese, Japanese, Korean), wait for the finished text.
      on(input, "compositionstart", () => { composing = true; });
      on(input, "compositionend", () => { composing = false; events?.input(input.value); });
      on(input, "input", () => { if (!composing) events?.input(input.value); });
      on(input, "keydown", (e) => {
        const k = e as KeyboardEvent;
        if (k.isComposing || composing) return;
        if (events?.key(k.key, k.shiftKey)) k.preventDefault();
      });
      on(input, "blur", () => events?.blur());
      on(window, "scroll", schedule, { capture: true, passive: true });
      on(window, "resize", schedule, { passive: true });

      // Focus now, inside the press, so phones open their keyboard.
      input.focus({ preventScroll: true });
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch { /* email inputs don't support selection ranges */ }
    },
    update(s) {
      spec = s;
      if (!el) return;
      style(s);
      // Never rewrite the text under someone's fingers mid-composition.
      if (!composing && el.value !== s.value) el.value = s.value;
      place();
    },
    close,
  };
}
