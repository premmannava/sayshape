// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A11Y_MARK, domAccessibilityHost } from "../../src/a11y/dom";

describe("the browser accessibility host", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "<main><canvas></canvas><p>after</p></main>";
    canvas = document.querySelector("canvas")!;
  });
  afterEach(() => vi.useRealTimers());

  const root = () => document.querySelector(`[${A11Y_MARK}]`) as HTMLElement | null;

  it("sits right after the canvas, with a polite and an assertive live region", () => {
    domAccessibilityHost(canvas);
    expect(canvas.nextElementSibling).toBe(root());
    const regions = [...root()!.children];
    expect(regions.map((r) => [r.getAttribute("role"), r.getAttribute("aria-live"), r.getAttribute("aria-atomic")])).toEqual([
      ["status", "polite", "true"],
      ["alert", "assertive", "true"],
    ]);
  });

  it("puts an announcement in the region after a short pause, so a repeat is read again", () => {
    const host = domAccessibilityHost(canvas);
    const polite = root()!.querySelector('[aria-live="polite"]')!;
    host.announce("Saved");
    expect(polite.textContent).toBe("");
    vi.advanceTimersByTime(100);
    expect(polite.textContent).toBe("Saved");
    host.announce("Saved");
    expect(polite.textContent).toBe("");
    vi.advanceTimersByTime(100);
    expect(polite.textContent).toBe("Saved");
  });

  it("sends assertive announcements to the alert region only", () => {
    const host = domAccessibilityHost(canvas);
    host.announce("Couldn't save", "assertive");
    vi.advanceTimersByTime(100);
    expect(root()!.querySelector('[aria-live="assertive"]')!.textContent).toBe("Couldn't save");
    expect(root()!.querySelector('[aria-live="polite"]')!.textContent).toBe("");
  });

  it("keeps its live regions out of sight", () => {
    domAccessibilityHost(canvas);
    for (const r of root()!.children) {
      const s = (r as HTMLElement).style;
      expect([s.position, s.width, s.height, s.overflow]).toEqual(["absolute", "1px", "1px", "hidden"]);
    }
  });

  it("removes itself, and pending announcements, when destroyed", () => {
    const host = domAccessibilityHost(canvas);
    host.announce("Later");
    host.destroy();
    vi.advanceTimersByTime(100);
    expect(root()).toBeNull();
  });

  it("works for a canvas not yet in the page", () => {
    const loose = document.createElement("canvas");
    const host = domAccessibilityHost(loose);
    expect(root()!.parentElement).toBe(document.body);
    host.destroy();
  });
});
