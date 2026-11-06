/**
 * Accessibility semantics: what an element is to a screen reader.
 *
 * The canvas is one picture to assistive technology. Components describe
 * themselves with ComponentDef.semantics (a role, a name, a state), the
 * engine gathers that into a tree of AccessibleNodes after each frame
 * (src/a11y/tree.ts), and an AccessibilityHost turns the tree into
 * something a screen reader can read: in browsers, a hidden DOM mirror
 * beside the canvas (CLAUDE.md rule 7 allows this one other DOM use).
 *
 * Like layout, none of this touches the DOM, so it is tested in Node
 * through sayshape/testing.
 */
import type { PropReader } from "../component";
import type { Box, HitRegion, Rect, SayShapeNode } from "../types";

/** The ARIA roles SayShape elements use. */
export const ROLES = [
  "alert", "button", "cell", "checkbox", "code", "columnheader", "combobox", "dialog", "figure", "grid",
  "group", "heading", "img", "link", "list", "listbox", "listitem", "main", "meter", "navigation",
  "note", "option", "progressbar", "radio", "radiogroup", "region", "row", "rowheader", "searchbox",
  "separator", "slider", "spinbutton", "status", "switch", "tab", "table", "tablist", "tabpanel", "text", "textbox",
] as const;
export type Role = (typeof ROLES)[number];

/** A value on a scale (slider, stepper, progress, meter). */
export interface RangeValue {
  now?: number;
  min?: number;
  max?: number;
  /** How the value reads aloud when the number alone isn't enough, e.g. "$40" or "4 of 5 stars". */
  text?: string;
}

/** What one element (or one part of an element) is, for assistive technology. */
export interface Semantics {
  role: Role;
  /** What it's called: a button's label, an image's description. */
  name?: string;
  /** Extra detail read after the name, like a field's hint. */
  description?: string;
  /** Heading level, 1 to 6. */
  level?: number;
  value?: RangeValue;
  checked?: boolean | "mixed";
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  current?: boolean | "page" | "step" | "date";
  required?: boolean;
  invalid?: boolean;
  multiselectable?: boolean;
  sort?: "ascending" | "descending";
  /** Replaces the role's spoken name, e.g. "carousel" for a region. Use sparingly. */
  roleDescription?: string;
}

/**
 * A part of an element that is pressable on its own (a star, a page number,
 * a stepper's + button), matched to the hit region painted with the same
 * detail (PaintContext.addHit).
 */
export interface PartSemantics extends Semantics {
  detail: unknown;
}

/** What ComponentDef.semantics returns for an element that is something. */
export interface ElementSemantics extends Semantics {
  /**
   * When the element's one pressable region is painted with a detail (a
   * slider's "track"), that detail, so the element's own node is the one
   * focus and presses go to.
   */
  detail?: unknown;
  /** Its pressable parts, each its own node inside this one. */
  parts?: PartSemantics[];
}

/**
 * What ComponentDef.semantics may return:
 * - ElementSemantics: the element is a node of its own, its children inside it;
 * - null: it is only layout or decoration, and its children stand in its place;
 * - false: it and everything inside it are hidden (a loading placeholder).
 */
export type SemanticsResult = ElementSemantics | null | false;

/** What ComponentDef.semantics gets. */
export interface SemanticsContext {
  /** Typed access to a node's props, with expressions worked out. */
  props(node: SayShapeNode): PropReader;
  /** A node's quoted text as shown, with {expressions} filled in. */
  text(node: SayShapeNode): string | undefined;
  /** All the words shown inside a box, in reading order (for a pressable card's name). */
  textWithin(box: Box): string;
  /** The hit regions this element painted in the latest frame. */
  regions: readonly HitRegion[];
  /** Whether this element's popup is open. */
  popupOpen: boolean;
  /** Today's date as YYYY-MM-DD. */
  today(): string;
}

/** One node of the accessibility tree. */
export interface AccessibleNode extends Semantics {
  /** Stable across frames: the element's id, plus the part's detail for parts. Hosts diff by it. */
  key: string;
  /** Where it is, in canvas CSS pixels. */
  rect: Rect;
  /** Whether keyboard focus can land on it. */
  focusable: boolean;
  /** The element it describes, and the part, for routing focus and presses back to the engine. */
  node: SayShapeNode;
  detail?: unknown;
  children: AccessibleNode[];
}

/** The key a node or part goes by in the tree. */
export function accessibleKey(node: SayShapeNode, detail?: unknown): string {
  return detail === undefined ? node.id : `${node.id}|${partKey(detail)}`;
}

function partKey(detail: unknown): string {
  if (typeof detail === "string" || typeof detail === "number" || typeof detail === "boolean") return String(detail);
  try { return JSON.stringify(detail) ?? String(detail); } catch { return String(detail); }
}
