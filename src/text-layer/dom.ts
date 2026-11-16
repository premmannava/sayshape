/**
 * The browser's text layer: a container placed right after the canvas,
 * covering it exactly, holding one real, transparent text element for each line
 * of text the canvas drew, at the same place, in the same font. The browser
 * can then select it, copy it and find it with Ctrl/Cmd+F, while the canvas
 * stays the only thing that draws.
 *
 * The layer is aria-hidden (the accessibility mirror is what screen readers
 * read) and never takes pointer events: a click reaches the canvas and
 * whatever element is under it. Only a drag that starts on text turns into a
 * selection; the layer then answers the caret lookups for the pointer and the
 * engine drops the press, so selecting text in a pressable card never presses it.
 *
 * Copying a selection is handled here too, so a table's cells come out
 * tab-separated (selection.ts) instead of on lines of their own.
 */
import type { PointerInfo, TextLayerHost, TextLayerInfo, TextLine } from "./host";
import { blockBounds, ClickCounter, wordBounds } from "./gesture";
import { lineAtPoint, nearestLine, pieceOf, selectionText, type Piece } from "./selection";

export const TEXT_LAYER_MARK = "data-sayshape-text";

/** How far the pointer must move, in CSS pixels, before a press becomes a selection. */
const DRAG_SLOP = 4;

interface Entry {
  el: HTMLElement;
  text: Text;
}

/** Distinguishes several interfaces' layers on one page, for the highlight's style rule. */
let layers = 0;

interface CaretDocument {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
}

/** How long a finger must stay down, in milliseconds, before it counts as a long press and not a tap. Native selection starts at about the same time. */
const LONG_PRESS_MS = 500;
/** How far a finger may move, in CSS pixels, and still be a tap or a long press, not a swipe. */
const TOUCH_SLOP = 10;

export interface DomTextLayerOptions {
  /** Let a long press on a touch screen select a word natively (only where touch is the main pointer). */
  touch?: boolean;
}

export function domTextLayer(canvas: HTMLCanvasElement, options: DomTextLayerOptions = {}): TextLayerHost {
  const id = String(++layers);
  const container = document.createElement("div");
  container.setAttribute(TEXT_LAYER_MARK, id);
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "absolute", left: "0", top: "0", width: "0", height: "0", margin: "0", padding: "0",
    pointerEvents: "none", overflow: "hidden",
    // Real text, drawn in nothing: the canvas draws the words. Forced colors must not paint it.
    color: "transparent", whiteSpace: "pre", userSelect: "text", webkitUserSelect: "text", forcedColorAdjust: "none",
    background: "transparent", textRendering: "auto",
  } as Partial<CSSStyleDeclaration>);
  if (canvas.isConnected) canvas.insertAdjacentElement("afterend", container);
  else document.body.append(container);

  // The highlight rule goes in through the style sheet object, which a page's content security policy
  // doesn't block the way it blocks a <style> element's text.
  let sheet: CSSStyleSheet | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let lastRule = "";
  const setHighlight = (accent: string, forced: boolean): void => {
    const css = highlightCss(id, accent, forced);
    if (css === lastRule) return;
    lastRule = css;
    try {
      if (!sheet) {
        const made = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, made];
        sheet = made;
      }
      sheet.replaceSync(css);
    } catch {
      if (!styleEl) { styleEl = document.createElement("style"); container.append(styleEl); }
      styleEl.textContent = css;
    }
  };

  // Touch selection needs the words themselves to receive touches, so the browser's own long press
  // (its handles and Copy menu) works on them. That only makes sense where touch is the main pointer;
  // elsewhere the layer never takes a pointer event.
  const coarse = typeof matchMedia === "function" && options.touch === true ? matchMedia("(pointer: coarse)") : null;
  let touchLines = !!coarse?.matches;
  const onCoarseChange = (): void => {
    touchLines = !!coarse?.matches;
    for (const entry of entries.values()) entry.el.style.pointerEvents = touchLines ? "auto" : "";
  };
  coarse?.addEventListener?.("change", onCoarseChange);

  const entries = new Map<string, Entry>();
  let shown: readonly TextLine[] = [];
  let order: HTMLElement[] = [];

  const positionContainer = (info: TextLayerInfo): void => {
    const s = container.style;
    s.left = `${canvas.offsetLeft}px`;
    s.top = `${canvas.offsetTop}px`;
    s.width = `${info.width}px`;
    s.height = `${info.height}px`;
  };

  const place = (el: HTMLElement, l: TextLine): void => {
    const s = el.style;
    s.position = "absolute";
    s.left = `${l.x}px`;
    s.top = `${l.y}px`;
    s.width = `${l.w}px`;
    s.height = `${l.h}px`;
    s.margin = s.padding = s.border = "0";
    s.font = l.font;
    s.lineHeight = `${l.h}px`;
    s.whiteSpace = "pre";
    s.overflow = "visible";
    s.pointerEvents = touchLines ? "auto" : "";
    // Same as the canvas, so a swipe over words scrolls the page as it does anywhere else.
    s.touchAction = touchLines ? "pan-y pinch-zoom" : "";
    const c = l.clip;
    if (c) {
      const t = Math.max(0, c.y - l.y), r = Math.max(0, l.x + l.w - (c.x + c.w)), b = Math.max(0, l.y + l.h - (c.y + c.h)), lf = Math.max(0, c.x - l.x);
      s.clipPath = t || r || b || lf ? `inset(${t}px ${r}px ${b}px ${lf}px)` : "";
    } else s.clipPath = "";
  };

  // ---- selecting

  let start: { x: number; y: number } | null = null;
  let anchor: { node: Node; offset: number } | null = null;
  let selecting = false;
  let gesture = false;
  const clicks = new ClickCounter();

  const inLayer = (n: Node | null): boolean => !!n && container.contains(n);
  const layerSelection = (): Selection | null => {
    const sel = document.getSelection();
    return sel && !sel.isCollapsed && inLayer(sel.anchorNode) && inLayer(sel.focusNode) ? sel : null;
  };
  const clientOf = (x: number, y: number): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  };

  /** The caret position in the layer nearest the point: always inside a line, so the gaps between lines still extend the selection. */
  const caretAt = (x: number, y: number): { node: Node; offset: number } | null => {
    const i = nearestLine(shown, x, y);
    const line = shown[i];
    if (!line) return null;
    const entry = entries.get(line.key);
    if (!entry) return null;
    const px = Math.min(Math.max(x, line.x + 0.5), line.x + Math.max(1, line.w) - 0.5);
    const at = clientOf(px, line.y + line.h / 2);
    const doc = document as unknown as CaretDocument;
    // The layer takes pointer events only for this lookup, which hit-tests like a pointer would.
    container.style.pointerEvents = "auto";
    try {
      let found: { node: Node; offset: number } | null = null;
      if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(at.x, at.y);
        if (p) found = { node: p.offsetNode, offset: p.offset };
      } else if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(at.x, at.y);
        if (r) found = { node: r.startContainer, offset: r.startOffset };
      }
      if (found && inLayer(found.node) && found.node.nodeType === Node.TEXT_NODE) return found;
    } finally {
      container.style.pointerEvents = "none";
    }
    // The lookup landed elsewhere: the start or the end of that line, by which side the point is on.
    return { node: entry.text, offset: x < line.x + line.w / 2 ? 0 : entry.text.length };
  };

  const extendTo = (x: number, y: number): void => {
    const sel = document.getSelection();
    const focus = caretAt(x, y);
    if (!sel || !anchor || !focus) return;
    sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  };

  /** Double-click: the word under the point. False when it isn't on a word. */
  const selectWordAt = (x: number, y: number): boolean => {
    if (lineAtPoint(shown, x, y) < 0) return false;
    const at = caretAt(x, y);
    const sel = document.getSelection();
    if (!at || !sel || at.node.nodeType !== Node.TEXT_NODE) return false;
    const w = wordBounds((at.node as Text).data, at.offset);
    if (!w) return false;
    sel.setBaseAndExtent(at.node, w[0], at.node, w[1]);
    return true;
  };

  /** Triple-click: everything drawn as the same block (a paragraph's lines, one table cell). */
  const selectBlockAt = (i: number): boolean => {
    const [s, e] = blockBounds(shown, i);
    const first = entries.get(shown[s]!.key), last = entries.get(shown[e]!.key);
    const sel = document.getSelection();
    if (!first || !last || !sel) return false;
    sel.setBaseAndExtent(first.text, 0, last.text, last.text.length);
    return true;
  };

  /** The selection's words, with a table's cells tab-separated. */
  const selectedText = (sel: Selection): string => {
    const range = sel.getRangeAt(0);
    const pieces: Piece[] = [];
    shown.forEach((line) => {
      const entry = entries.get(line.key);
      if (!entry || !range.intersectsNode(entry.el)) return;
      const len = entry.text.length;
      let s = 0, e = len;
      if (range.startContainer === entry.text) s = range.startOffset;
      else if (range.startContainer === entry.el) s = range.startOffset > 0 ? len : 0;
      if (range.endContainer === entry.text) e = range.endOffset;
      else if (range.endContainer === entry.el) e = range.endOffset > 0 ? len : 0;
      const slice = entry.text.data.slice(s, e);
      if (slice) pieces.push(pieceOf(line, slice));
    });
    return selectionText(pieces);
  };

  const onCopy = (e: ClipboardEvent): void => {
    const sel = layerSelection();
    if (!sel || !e.clipboardData) return;
    const text = selectedText(sel);
    if (!text) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  // A drag that starts on the canvas must not start the browser's own selection of the page around it.
  const onSelectStart = (e: Event): void => e.preventDefault();
  canvas.addEventListener("selectstart", onSelectStart);
  // On the layer itself, only a finger's long press may start the browser's own selection;
  // a mouse selects through the host's drag, as everywhere.
  let lastType = "";
  const onLayerSelectStart = (e: Event): void => { if (lastType !== "touch") e.preventDefault(); };
  container.addEventListener("selectstart", onLayerSelectStart);

  // ---- touch: a long press selects natively; a tap, a swipe and a drag go on to the canvas

  type Phase = "wait" | "long" | "swipe" | "none";
  let touch: { id: number; phase: Phase; x0: number; y0: number; x: number; y: number; timer: number } | null = null;

  /** Replay a pointer event onto the canvas, where the engine listens, as if it had landed there. */
  const send = (type: string, e: { clientX: number; clientY: number; pointerId: number; pointerType: string }, at?: { x: number; y: number }): void => {
    const init: PointerEventInit = {
      bubbles: true, cancelable: true, composed: true,
      clientX: at?.x ?? e.clientX, clientY: at?.y ?? e.clientY,
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: true,
      button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    };
    canvas.dispatchEvent(typeof PointerEvent === "function" ? new PointerEvent(type, init) : (Object.assign(new MouseEvent(type, init), { pointerId: e.pointerId, pointerType: e.pointerType }) as unknown as Event));
  };
  const endTouch = (): void => {
    if (touch) clearTimeout(touch.timer);
    touch = null;
  };
  const onLayerDown = (e: PointerEvent): void => {
    lastType = e.pointerType;
    if (!touchLines) return;
    if (e.pointerType !== "touch") { send("pointerdown", e); canvas.focus({ preventScroll: true }); return; }
    // A second finger is a pinch: nothing is pressed or selected.
    if (touch) { endTouch(); touch = { id: e.pointerId, phase: "none", x0: 0, y0: 0, x: 0, y: 0, timer: 0 }; return; }
    const t = { id: e.pointerId, phase: "wait" as Phase, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: 0 };
    t.timer = window.setTimeout(() => { if (touch === t && t.phase === "wait") t.phase = "long"; }, LONG_PRESS_MS);
    touch = t;
  };
  const onLayerMove = (e: PointerEvent): void => {
    if (!touchLines) return;
    if (e.pointerType !== "touch") { send("pointermove", e); return; }
    const t = touch;
    if (!t || t.id !== e.pointerId) return;
    t.x = e.clientX; t.y = e.clientY;
    if (t.phase === "wait" && Math.hypot(t.x - t.x0, t.y - t.y0) > TOUCH_SLOP) {
      // A swipe, or a drag of something under the words: it reaches the canvas from where the finger went down.
      clearTimeout(t.timer);
      t.phase = "swipe";
      send("pointerdown", e, { x: t.x0, y: t.y0 });
    }
    if (t.phase === "swipe") send("pointermove", e);
  };
  const onLayerUp = (e: PointerEvent): void => {
    if (!touchLines) return;
    if (e.pointerType !== "touch") { send("pointerup", e); return; }
    const t = touch;
    endTouch();
    if (!t || t.id !== e.pointerId) return;
    if (t.phase === "wait") {
      // A tap: pressed and released, exactly once, on whatever is drawn there.
      send("pointerdown", e);
      send("pointerup", e);
      canvas.focus({ preventScroll: true });
    } else if (t.phase === "swipe") send("pointerup", e);
    // "long": the browser's selection took over; letting go presses nothing.
  };
  const onLayerCancel = (e: PointerEvent): void => {
    if (!touchLines) return;
    if (e.pointerType !== "touch") { send("pointercancel", e); return; }
    const t = touch;
    endTouch();
    // The browser took the gesture (a scroll, a pinch, its own selection): a swipe already begun is finished.
    if (t && t.id === e.pointerId && t.phase === "swipe") send("pointercancel", e);
  };
  container.addEventListener("pointerdown", onLayerDown);
  container.addEventListener("pointermove", onLayerMove);
  container.addEventListener("pointerup", onLayerUp);
  container.addEventListener("pointercancel", onLayerCancel);
  container.addEventListener("pointerleave", (e) => { if (touchLines && e.pointerType !== "touch") send("pointerleave", e); });

  return {
    surface: container,
    update(lines, info) {
      positionContainer(info);
      setHighlight(info.accent, info.forcedColors);
      const seen = new Set<string>();
      const next: HTMLElement[] = [];
      for (const l of lines) {
        let entry = entries.get(l.key);
        if (!entry) {
          const el = document.createElement("div");
          const text = document.createTextNode(l.text);
          el.append(text);
          entry = { el, text };
          entries.set(l.key, entry);
        } else if (entry.text.data !== l.text) entry.text.data = l.text;
        place(entry.el, l);
        seen.add(l.key);
        next.push(entry.el);
      }
      for (const [key, entry] of entries) {
        if (seen.has(key)) continue;
        entry.el.remove();
        entries.delete(key);
      }
      // Reading order is DOM order, which is what selecting across lines and finding both follow.
      let moved = next.length !== order.length;
      if (!moved) for (let i = 0; i < next.length; i++) if (next[i] !== order[i]) { moved = true; break; }
      if (moved) {
        let ref: Node | null = styleEl;
        next.forEach((el) => {
          if (el.parentNode !== container || (ref ? ref.nextSibling : container.firstChild) !== el) container.insertBefore(el, ref ? ref.nextSibling : container.firstChild);
          ref = el;
        });
      }
      order = next;
      shown = lines;
    },
    pointerDown(x, y, info: PointerInfo) {
      start = null;
      selecting = false;
      anchor = null;
      gesture = false;
      if (info.button !== 0) return;
      const had = layerSelection();
      const count = info.pointerType === "touch" ? 1 : clicks.press(x, y, info.time ?? performance.now(), info.button);
      const i = lineAtPoint(shown, x, y);
      if (info.pointerType !== "touch" && i >= 0 && !info.pressable) {
        // Shift+click: the selection's anchor stays, its other end moves to the click.
        if (info.shiftKey && had && had.anchorNode) {
          anchor = { node: had.anchorNode, offset: had.anchorOffset };
          extendTo(x, y);
          anchor = null;
          gesture = true;
          return;
        }
        if (count === 2 && selectWordAt(x, y)) { gesture = true; return; }
        if (count === 3 && selectBlockAt(i)) { gesture = true; return; }
      }
      // A new press (a tap too) ends the old selection, as a click on a page does.
      if (had || (!document.getSelection()?.isCollapsed && inLayer(document.getSelection()?.anchorNode ?? null))) document.getSelection()?.removeAllRanges();
      if (info.pointerType === "touch") return;
      if (i < 0) return;
      start = { x, y };
    },
    pointerMove(x, y) {
      if (selecting) { extendTo(x, y); return true; }
      if (!start || Math.hypot(x - start.x, y - start.y) < DRAG_SLOP) return false;
      anchor = caretAt(start.x, start.y);
      if (!anchor) { start = null; return false; }
      selecting = true;
      extendTo(x, y);
      return true;
    },
    pointerUp() {
      const was = selecting || gesture;
      gesture = false;
      start = null;
      selecting = false;
      anchor = null;
      return was;
    },
    lineAt(x, y) {
      return lineAtPoint(shown, x, y) >= 0;
    },
    destroy() {
      document.removeEventListener("copy", onCopy);
      endTouch();
      coarse?.removeEventListener?.("change", onCoarseChange);
      canvas.removeEventListener("selectstart", onSelectStart);
      if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheet = null;
      entries.clear();
      container.remove();
    },
  };
}

/** The highlight over selected words: the theme's accent, see-through so the drawn words show; the person's own colors when forced. */
export function highlightCss(id: string, accent: string, forced: boolean): string {
  const scope = `[${TEXT_LAYER_MARK}="${id}"] ::selection`;
  if (forced) return `${scope}{background:Highlight;color:HighlightText;}`;
  const rgb = hexToRgb(accent);
  const fill = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.34)` : `color-mix(in srgb, ${accent} 34%, transparent)`;
  return `${scope}{background:${fill};color:transparent;}`;
}

function hexToRgb(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
