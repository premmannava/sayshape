/**
 * Where the text layer goes. The engine only talks to this interface: the
 * browser host (domTextLayer in ./dom.ts) puts an invisible layer of real
 * text over the canvas, so words can be selected, copied and found with the
 * browser's Find; sayshape/testing records what it's given, so the layer is
 * tested in Node like everything else.
 *
 * The canvas stays the only thing that draws. Nothing here paints.
 */
import type { Rect } from "../types";

/** One drawn line of text, as the canvas drew it: where, in what font, and what it belongs to. */
export interface TextLine {
  /** Stable between frames while the same line is drawn (its element and the order it was drawn in), so a host can reuse its node. */
  key: string;
  text: string;
  /** The words' box in canvas CSS pixels: x is the left edge of the words, y the top of their line. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The canvas font string the words were drawn in (weight, size and family). */
  font: string;
  /** Things drawn as one piece of text (a paragraph's wrapped lines, one table cell's lines) share a block. */
  block: string;
  /** Blocks of one table row share a row; copied as tab-separated cells. Undefined outside tables. */
  row?: string;
  /** The part of the screen that shows, when the words are cut off (a scrolling element, a table's frame). */
  clip?: Rect;
}

/** What the host needs to know besides the lines. */
export interface TextLayerInfo {
  /** The canvas's size in CSS pixels. */
  width: number;
  height: number;
  /** The theme's accent, for the selection highlight (a CSS color). */
  accent: string;
  /** Whether the system's forced colors are in use: the highlight then takes the person's own colors. */
  forcedColors: boolean;
}

export interface PointerInfo {
  pointerType: string;
  button: number;
  /** Shift was held: with a selection, the press extends it to the point. */
  shiftKey?: boolean;
  /** An element that does something when pressed is under the point. Its text keeps the plain click: no word or block selecting on repeated clicks. */
  pressable?: boolean;
  /** When the press happened, in milliseconds, to count double and triple clicks. */
  time?: number;
}

export interface TextLayerHost {
  /** Show exactly these lines, in reading order, replacing what was shown. */
  update(lines: readonly TextLine[], info: TextLayerInfo): void;
  /**
   * The pointer went down on the canvas at this point (CSS pixels from its
   * top-left corner). A plain click must still reach the element under it, so a
   * host only starts selecting once the pointer has been dragged.
   */
  pointerDown?(x: number, y: number, info: PointerInfo): void;
  /** The pointer moved with the button held. True once it's selecting text: the engine then drops the press. */
  pointerMove?(x: number, y: number): boolean;
  /** The pointer was released. True when that ended a selection, so the engine doesn't treat it as a click. */
  pointerUp?(): boolean;
  /** Whether there's text under this point (to show a text cursor over text nothing else uses). */
  lineAt?(x: number, y: number): boolean;
  /**
   * What touches land on, when the host takes them (touch selection): the engine's own touch
   * handling for scrolling elements is attached to it too, as to the canvas.
   */
  readonly surface?: EventTarget;
  /** Remove everything the host added to the page. */
  destroy(): void;
}

/** A host that does nothing: the option off, or no DOM and no fake. */
export const noTextLayer: TextLayerHost = { update() {}, destroy() {} };

/** Which elements' text is in the layer. Controls (buttons, inputs, selects, switches) are never in it. */
export const SELECTABLE = new Set(["text", "stat", "table", "details", "callout", "badge", "list-item"]);

/** How long drawing must stay unchanged before the layer is rebuilt, so a streamed spec builds it once. */
export const SETTLE_MS = 120;

/** The longest the layer waits for drawing to settle, so text that never stops changing (a ticking number) still gets a layer. */
export const TEXT_MAX_WAIT_MS = 1000;

/** How far past the visible part of the page lines are kept, so a little scrolling needs no rebuild. */
export const OVERSCAN = 400;

/**
 * Whether a long press selects text on touch screens when the host doesn't say. Off until the manual check
 * on real phones (docs/plans/selectable-text/touch-checklist.md) has been done: emulated touch can't
 * show the browser's own long-press selection. Turning it on is this one line.
 */
export const TOUCH_SELECT_DEFAULT = false;
