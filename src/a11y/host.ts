/**
 * Where accessibility output goes. The engine only talks to this interface:
 * the browser host (domAccessibilityHost in ./dom.ts) puts live regions and
 * the mirror beside the canvas; sayshape/testing records what it's given,
 * so announcements are tested in Node like everything else.
 */
export type Politeness = "polite" | "assertive";

export interface AccessibilityHost {
  /**
   * Have screen readers say something: polite waits for a pause (a message,
   * a new screen), assertive interrupts (errors only).
   */
  announce(text: string, politeness?: Politeness): void;
  /** Remove everything the host added to the page. */
  destroy(): void;
}

/** A host that does nothing, for environments with no DOM and no fake, or accessibility: "off". */
export const noAccessibility: AccessibilityHost = { announce() {}, destroy() {} };
