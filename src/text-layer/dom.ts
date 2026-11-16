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

export function domTextLayer(canvas: HTMLCanvasElement): TextLayerHost {
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

  return {
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
      if (info.pointerType === "touch" || info.button !== 0) return;
      // A new press ends the old selection, as a click on a page does.
      if (layerSelection()) document.getSelection()?.removeAllRanges();
      if (lineAtPoint(shown, x, y) < 0) return;
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
      const was = selecting;
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
