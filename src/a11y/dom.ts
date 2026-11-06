/**
 * The browser's accessibility host: a container placed right after the
 * canvas holding two live regions, so screen readers hear messages and
 * screen changes the canvas only draws.
 */
import type { AccessibilityHost, Politeness } from "./host";

export const A11Y_MARK = "data-sayshape-a11y";

/** Hidden from sight but not from assistive technology. */
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", border: "0",
  overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap",
};

/** How long a live region waits after clearing, so the same message twice is still read twice. */
const ANNOUNCE_DELAY_MS = 60;

export function domAccessibilityHost(canvas: HTMLCanvasElement): AccessibilityHost {
  const root = document.createElement("div");
  root.setAttribute(A11Y_MARK, "");
  const region = (politeness: Politeness): HTMLElement => {
    const el = document.createElement("div");
    el.setAttribute("role", politeness === "assertive" ? "alert" : "status");
    el.setAttribute("aria-live", politeness);
    el.setAttribute("aria-atomic", "true");
    Object.assign(el.style, VISUALLY_HIDDEN);
    root.append(el);
    return el;
  };
  const regions: Record<Politeness, HTMLElement> = { polite: region("polite"), assertive: region("assertive") };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  if (canvas.isConnected) canvas.insertAdjacentElement("afterend", root);
  else document.body.append(root);

  return {
    announce(text, politeness = "polite") {
      const el = regions[politeness];
      el.textContent = "";
      const t = setTimeout(() => { timers.delete(t); el.textContent = text; }, ANNOUNCE_DELAY_MS);
      timers.add(t);
    },
    destroy() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      root.remove();
    },
  };
}
