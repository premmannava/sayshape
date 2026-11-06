// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A11Y_MARK, domAccessibilityHost } from "../../src/a11y/dom";
import type { AccessibilityHost, MirrorEvents, MirrorKey } from "../../src/a11y/host";
import type { AccessibleNode, Semantics } from "../../src/a11y/semantics";
import type { SayShapeNode } from "../../src/types";

const element = (id: string): SayShapeNode => ({ id, type: "test", props: {}, children: [], line: 1, indent: 0 });

let nodes = 0;
/** A tree node, at a made-up place unless given one. */
function n(key: string, s: Semantics & { focusable?: boolean; x?: number; y?: number }, children: AccessibleNode[] = []): AccessibleNode {
  const { focusable = false, x = 10, y = 10 + 40 * nodes++, ...sem } = s;
  return { ...sem, key, rect: { x, y, w: 100, h: 30 }, focusable, node: element(key), children };
}
const root = (children: AccessibleNode[]): AccessibleNode => ({
  key: "root", role: "group", name: "Generated interface", rect: { x: 0, y: 0, w: 400, h: 300 }, focusable: false, node: element("root"), children,
});

/** Records what the mirror reports back. */
function recorder(): MirrorEvents & { log: string[]; keys: string[] } {
  const log: string[] = [];
  const keys: string[] = [];
  return {
    log,
    keys,
    focus: (k) => log.push(`focus ${k}`),
    activate: (k) => log.push(`activate ${k}`),
    key: (e: MirrorKey) => { keys.push(e.key); log.push(`key ${e.key}`); },
    step: (k, d) => log.push(`step ${k} ${d}`),
    blur: () => log.push("blur"),
  };
}

describe("the browser accessibility host", () => {
  let canvas: HTMLCanvasElement;
  let host: AccessibilityHost;

  beforeEach(() => {
    vi.useFakeTimers();
    nodes = 0;
    document.body.innerHTML = "<main><button id=before>before</button><canvas tabindex=0></canvas><button id=after>after</button></main>";
    canvas = document.querySelector("canvas")!;
    host = domAccessibilityHost(canvas);
  });
  afterEach(() => {
    host.destroy();
    vi.useRealTimers();
  });

  const container = () => document.querySelector(`[${A11Y_MARK}]`) as HTMLElement | null;
  const live = (p: string) => container()!.querySelector(`[aria-live="${p}"]`)!;
  const mirror = () => container()!.querySelector('[role="group"]') as HTMLElement;

  describe("live regions", () => {
    it("sit right after the canvas: a polite one and an assertive one", () => {
      expect(canvas.nextElementSibling).toBe(container());
      expect([live("polite").getAttribute("role"), live("assertive").getAttribute("role")]).toEqual(["status", "alert"]);
      expect(live("polite").getAttribute("aria-atomic")).toBe("true");
    });

    it("show an announcement after a short pause, so a repeat is read again", () => {
      host.announce("Saved");
      expect(live("polite").textContent).toBe("");
      vi.advanceTimersByTime(100);
      expect(live("polite").textContent).toBe("Saved");
      host.announce("Saved");
      expect(live("polite").textContent).toBe("");
      vi.advanceTimersByTime(100);
      expect(live("polite").textContent).toBe("Saved");
    });

    it("send assertive announcements to the alert region only", () => {
      host.announce("Couldn't save", "assertive");
      vi.advanceTimersByTime(100);
      expect(live("assertive").textContent).toBe("Couldn't save");
      expect(live("polite").textContent).toBe("");
    });

    it("are kept out of sight", () => {
      const s = (live("polite") as HTMLElement).style;
      expect([s.position, s.width, s.height, s.overflow]).toEqual(["absolute", "1px", "1px", "hidden"]);
    });
  });

  describe("the mirror", () => {
    it("is invisible and lets the pointer through to the canvas", () => {
      const s = container()!.style;
      expect([s.position, s.pointerEvents, s.filter]).toEqual(["absolute", "none", "opacity(0%)"]);
    });

    it("names the whole interface and shows each node with its role", () => {
      host.update!(root([
        n("1:text", { role: "heading", name: "Trail socks", level: 2 }),
        n("2:button", { role: "button", name: "Add to cart", focusable: true }),
        n("3:image", { role: "img", name: "Blue socks" }),
      ]), false);
      const m = mirror();
      expect(m.getAttribute("aria-label")).toBe("Generated interface");
      const [heading, button, img] = [...m.children] as HTMLElement[];
      expect([heading!.getAttribute("role"), heading!.getAttribute("aria-level"), heading!.textContent]).toEqual(["heading", "2", "Trail socks"]);
      expect([button!.tagName, button!.getAttribute("type"), button!.textContent]).toEqual(["BUTTON", "button", "Add to cart"]);
      expect([img!.getAttribute("role"), img!.getAttribute("aria-label")]).toEqual(["img", "Blue socks"]);
    });

    it("places each node over its part of the canvas, relative to its parent", () => {
      host.update!(root([n("list", { role: "list", x: 20, y: 50 }, [n("item", { role: "listitem", name: "One", x: 30, y: 60 })])]), false);
      const list = mirror().children[0] as HTMLElement;
      const item = list.children[0] as HTMLElement;
      expect([list.style.left, list.style.top, list.style.width, list.style.height]).toEqual(["20px", "50px", "100px", "30px"]);
      expect([item.style.left, item.style.top]).toEqual(["10px", "10px"]);
    });

    it("uses native controls where phones' screen readers need them", () => {
      host.update!(root([
        n("c", { role: "checkbox", name: "Agree", checked: true, focusable: true }),
        n("s", { role: "switch", name: "Updates", checked: false, focusable: true }),
        n("r", { role: "radio", name: "Medium", checked: true, focusable: true }),
        n("v", { role: "slider", name: "Price", value: { now: 120, min: 20, max: 300, text: "$120" }, focusable: true }),
      ]), false);
      const [c, s, r, v] = [...mirror().children] as HTMLInputElement[];
      expect([c!.type, c!.checked, c!.getAttribute("aria-label")]).toEqual(["checkbox", true, "Agree"]);
      expect([s!.type, s!.getAttribute("role"), s!.checked]).toEqual(["checkbox", "switch", false]);
      expect([r!.type, r!.checked]).toEqual(["radio", true]);
      expect([v!.type, v!.min, v!.max, v!.value, v!.getAttribute("aria-valuetext")]).toEqual(["range", "20", "300", "120", "$120"]);
    });

    it("writes states as ARIA attributes and clears ones no longer set", () => {
      host.update!(root([n("t", { role: "tab", name: "Specs", selected: true, disabled: true, focusable: true })]), false);
      const tab = mirror().children[0]!;
      expect([tab.getAttribute("aria-selected"), tab.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
      host.update!(root([n("t", { role: "tab", name: "Specs", selected: false, focusable: true })]), false);
      expect([tab.getAttribute("aria-selected"), tab.hasAttribute("aria-disabled")]).toEqual(["false", false]);
    });

    it("keeps every node out of the page's Tab order", () => {
      host.update!(root([n("b", { role: "button", name: "Go", focusable: true }), n("t", { role: "text", name: "Hi" })]), false);
      const [b, t] = [...mirror().children] as HTMLElement[];
      expect(b!.tabIndex).toBe(-1);
      expect(t!.hasAttribute("tabindex")).toBe(false);
      expect(t!.hasAttribute("role")).toBe(false);
    });

    it("keeps the same element for the same key, so a screen reader keeps its place", () => {
      host.update!(root([n("a", { role: "button", name: "A" }), n("b", { role: "button", name: "B" })]), false);
      const b = mirror().children[1];
      host.update!(root([n("b", { role: "button", name: "B again" }), n("c", { role: "button", name: "C" })]), false);
      expect(mirror().children[0]).toBe(b);
      expect(b!.textContent).toBe("B again");
      expect([...mirror().children].map((e) => e.textContent)).toEqual(["B again", "C"]);
    });

    it("replaces an element whose role changed", () => {
      host.update!(root([n("x", { role: "button", name: "X" })]), false);
      const was = mirror().children[0];
      host.update!(root([n("x", { role: "link", name: "X" })]), false);
      expect(mirror().children[0]).not.toBe(was);
      expect(mirror().children[0]!.getAttribute("role")).toBe("link");
    });

    it("marks the interface busy while it's still coming in", () => {
      host.update!(root([]), true);
      expect(mirror().getAttribute("aria-busy")).toBe("true");
      host.update!(root([]), false);
      expect(mirror().hasAttribute("aria-busy")).toBe(false);
    });
  });

  describe("focus and actions", () => {
    let events: ReturnType<typeof recorder>;
    beforeEach(() => {
      events = recorder();
      host.connect!(events);
      host.update!(root([
        n("go", { role: "button", name: "Go", focusable: true }),
        n("next", { role: "button", name: "Next", focusable: true }),
        n("price", { role: "slider", name: "Price", value: { now: 120, min: 20, max: 300 }, focusable: true }),
      ]), false);
    });
    const el = (i: number) => mirror().children[i] as HTMLElement;

    it("moves DOM focus when the canvas has it, without reporting it back", () => {
      canvas.focus();
      expect(host.focus!("go")).toBe(true);
      expect(document.activeElement).toBe(el(0));
      expect(host.focus!("next")).toBe(true);
      expect(document.activeElement).toBe(el(1));
      expect(events.log).toEqual([]);
    });

    it("never takes focus from the rest of the page, unless forced", () => {
      (document.getElementById("after") as HTMLElement).focus();
      expect(host.focus!("go")).toBe(false);
      expect(document.activeElement!.id).toBe("after");
      expect(host.focus!("go", true)).toBe(true);
      expect(document.activeElement).toBe(el(0));
    });

    it("reports focus a screen reader moves, clicks and keys", () => {
      el(1).focus();
      el(1).click();
      el(1).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(events.log).toEqual(["focus next", "activate next", "key Enter"]);
    });

    it("reports a key or a click on a node inside another once, for that node only", () => {
      host.update!(root([n("box", { role: "group", name: "Box" }, [n("inner", { role: "button", name: "Inner", focusable: true })])]), false);
      const inner = mirror().children[0]!.children[0] as HTMLElement;
      inner.focus();
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      inner.click();
      expect(events.log).toEqual(["focus inner", "key ArrowDown", "activate inner"]);
    });

    it("turns a screen reader adjusting a range input into one step, keeping the engine's value", () => {
      const slider = el(2) as HTMLInputElement;
      slider.value = "180";
      slider.dispatchEvent(new Event("input"));
      expect(events.log).toEqual(["step price 1"]);
      expect(slider.value).toBe("120");
      slider.value = "60";
      slider.dispatchEvent(new Event("input"));
      expect(events.log.at(-1)).toBe("step price -1");
    });

    it("doesn't let a native checkbox toggle itself", () => {
      host.update!(root([n("c", { role: "checkbox", name: "Agree", checked: false, focusable: true })]), false);
      const box = mirror().children[0] as HTMLInputElement;
      box.click();
      expect(box.checked).toBe(false);
      expect(events.log).toEqual(["activate c"]);
    });

    it("reports when focus leaves for the rest of the page, not for the canvas", () => {
      el(0).focus();
      canvas.focus();
      expect(events.log).toEqual(["focus go"]);
      el(0).focus();
      (document.getElementById("after") as HTMLElement).focus();
      expect(events.log.at(-1)).toBe("blur");
    });

    it("keeps focus in the interface when the focused element disappears", () => {
      canvas.focus();
      host.focus!("next");
      host.update!(root([n("go", { role: "button", name: "Go", focusable: true })]), false);
      expect(document.activeElement).toBe(mirror());
      expect(events.log).toEqual([]);
    });

    it("keeps focus on an element that moved to a new parent", () => {
      canvas.focus();
      host.focus!("next");
      const was = document.activeElement;
      host.update!(root([n("box", { role: "group", name: "Box" }, [n("next", { role: "button", name: "Next", focusable: true })])]), false);
      expect(document.activeElement).toBe(was);
      expect(mirror().children[0]!.contains(was)).toBe(true);
      expect(events.log).toEqual([]);
    });

    it("still sends keys to the engine while the root holds focus", () => {
      canvas.focus();
      host.focus!("next");
      host.update!(root([n("go", { role: "button", name: "Go", focusable: true })]), false);
      mirror().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(events.log).toEqual(["key Tab"]);
    });

    it("says whether an element is its own", () => {
      expect(host.owns!(el(0))).toBe(true);
      expect(host.owns!(canvas)).toBe(false);
      expect(host.owns!(null)).toBe(false);
    });
  });

  it("removes itself, and pending announcements, when destroyed", () => {
    host.announce("Later");
    host.destroy();
    vi.advanceTimersByTime(100);
    expect(container()).toBeNull();
  });

  it("works for a canvas not yet in the page", () => {
    host.destroy();
    const loose = document.createElement("canvas");
    host = domAccessibilityHost(loose);
    expect(container()!.parentElement).toBe(document.body);
  });
});
