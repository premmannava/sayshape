/**
 * Where accessibility output goes. The engine only talks to this interface:
 * the browser host (domAccessibilityHost in ./dom.ts) puts live regions and
 * the mirror beside the canvas; sayshape/testing records what it's given,
 * so announcements and the mirror's traffic are tested in Node like
 * everything else.
 */
import type { AccessibleNode } from "./semantics";

export type Politeness = "polite" | "assertive";

/** A key press as the engine needs it: what a browser KeyboardEvent carries. */
export interface MirrorKey {
  key: string;
  shiftKey: boolean;
  /** Stop the browser's own handling (scrolling on Space, moving focus on Tab). */
  preventDefault(): void;
}

/** What a mirror reports back to the engine: things a screen reader or the keyboard did to its nodes. */
export interface MirrorEvents {
  /** DOM focus landed on a node (a screen reader moved there, or Tab from outside). */
  focus(key: string): void;
  /** A node was activated (a screen reader's double tap, Enter on a native button). */
  activate(key: string): void;
  /** A key was pressed on a node, as on the canvas. */
  key(event: MirrorKey): void;
  /**
   * A slider or stepper was nudged the way phones' screen readers do it (a
   * swipe up or down), by one step up or down.
   */
  step(key: string, direction: 1 | -1): void;
  /** DOM focus left the mirror for somewhere outside the canvas and the mirror. */
  blur(): void;
}

export interface AccessibilityHost {
  /**
   * Have screen readers say something: polite waits for a pause (a message,
   * a new screen), assertive interrupts (errors only).
   */
  announce(text: string, politeness?: Politeness): void;
  /** Start reporting what happens to the mirror. Called once, before the first update. */
  connect?(events: MirrorEvents): void;
  /**
   * The screen changed: show this tree. busy is true while a spec streams
   * in or data loads, so screen readers wait for the finished screen.
   */
  update?(tree: AccessibleNode, busy: boolean): void;
  /**
   * The engine moved keyboard focus to this node. Move DOM focus to it when
   * the canvas or the mirror has DOM focus now, or always with force (the
   * person is tabbing through the interface). Returns whether it did.
   */
  focus?(key: string, force?: boolean): boolean;
  /** Whether a DOM element is part of what this host added (the mirror). */
  owns?(element: unknown): boolean;
  /** Remove everything the host added to the page. */
  destroy(): void;
}

/** A host that does nothing, for environments with no DOM and no fake, or accessibility: "off". */
export const noAccessibility: AccessibilityHost = { announce() {}, destroy() {} };
