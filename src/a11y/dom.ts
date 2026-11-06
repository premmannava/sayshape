/**
 * The browser's accessibility host: a container placed right after the
 * canvas, covering it exactly, holding
 *
 * - two live regions, so screen readers hear messages and new screens;
 * - the mirror: one DOM element per accessibility node, each absolutely
 *   positioned over the part of the canvas it stands for, so a screen
 *   reader's focus box, touch exploration on phones and the browser's
 *   scroll-into-view all land in the right place.
 *
 * The mirror is invisible (filter: opacity(0%), transparent text) and
 * never takes pointer events, so the mouse still reaches the canvas. Real
 * buttons, checkboxes, radios and range inputs are used where they help:
 * phones' screen readers then activate and adjust them without any keys.
 * Nothing in it acts on its own: clicks, keys and focus go back to the
 * engine through MirrorEvents, and the next update shows the result.
 */
import type { AccessibilityHost, MirrorEvents, Politeness } from "./host";
import type { AccessibleNode, Role } from "./semantics";
import type { Rect } from "../types";

export const A11Y_MARK = "data-sayshape-a11y";

/** Hidden from sight but not from assistive technology. */
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", border: "0",
  overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap",
};

/** How long a live region waits after clearing, so the same message twice is still read twice. */
const ANNOUNCE_DELAY_MS = 60;

type Native = "button" | "checkbox" | "radio" | "range";

/** Roles drawn as a native element, and which. */
const NATIVE: Partial<Record<Role, Native>> = { button: "button", checkbox: "checkbox", switch: "checkbox", radio: "radio", slider: "range" };

/** Roles named by aria-label even when they have no children (their content isn't text). */
const LABELLED = new Set<Role>([
  "img", "checkbox", "switch", "radio", "slider", "spinbutton", "textbox", "searchbox", "combobox",
  "progressbar", "meter", "separator", "figure", "table", "grid", "list", "listbox", "tablist",
  "radiogroup", "group", "region", "navigation", "main", "dialog",
]);

interface Entry {
  el: HTMLElement;
  role: Role;
  /** The node it shows, kept current so events act on the latest frame. */
  node: AccessibleNode;
  /** ARIA attributes set last time, to clear the ones no longer wanted. */
  attrs: Set<string>;
}

export function domAccessibilityHost(canvas: HTMLCanvasElement): AccessibilityHost {
  const container = document.createElement("div");
  container.setAttribute(A11Y_MARK, "");
  Object.assign(container.style, {
    position: "absolute", left: "0", top: "0", width: "0", height: "0", margin: "0", padding: "0",
    pointerEvents: "none", filter: "opacity(0%)", color: "transparent", overflow: "visible",
  } satisfies Partial<CSSStyleDeclaration>);

  const region = (politeness: Politeness): HTMLElement => {
    const el = document.createElement("div");
    el.setAttribute("role", politeness === "assertive" ? "alert" : "status");
    el.setAttribute("aria-live", politeness);
    el.setAttribute("aria-atomic", "true");
    Object.assign(el.style, VISUALLY_HIDDEN);
    container.append(el);
    return el;
  };
  const regions: Record<Politeness, HTMLElement> = { polite: region("polite"), assertive: region("assertive") };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  // The tree's root: the whole interface, named after the canvas. It can hold
  // focus itself, so focus has somewhere to stay when its element disappears.
  const treeRoot = document.createElement("div");
  treeRoot.setAttribute("role", "group");
  treeRoot.tabIndex = -1;
  place(treeRoot, { x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 });
  container.append(treeRoot);

  if (canvas.isConnected) canvas.insertAdjacentElement("afterend", container);
  else document.body.append(container);

  const entries = new Map<string, Entry>();
  let events: MirrorEvents | null = null;
  // Keys pressed while the root holds focus (its element went away) still go
  // to the engine, so Tab carries on through the interface instead of leaving it.
  treeRoot.addEventListener("keydown", (e) => { if (e.target === treeRoot) events?.key(e); });
  /** Set while the engine moves focus, so the focus event isn't reported back as a screen reader's move. */
  let moving = false;

  const owns = (el: unknown): boolean => el instanceof Node && container.contains(el);

  const create = (node: AccessibleNode): Entry => {
    const native = NATIVE[node.role];
    let el: HTMLElement;
    if (native === "button") {
      const b = document.createElement("button");
      b.type = "button";
      el = b;
    } else if (native) {
      const i = document.createElement("input");
      i.type = native;
      if (native === "range") i.step = "any";
      el = i;
    } else el = document.createElement("div");
    // Plain text needs no role; native elements carry their own, except a switch.
    if ((!native && node.role !== "text") || node.role === "switch") el.setAttribute("role", node.role);

    const entry: Entry = { el, role: node.role, node, attrs: new Set() };
    el.addEventListener("focus", () => { if (!moving) events?.focus(entry.node.key); });
    // Clicks and keys bubble up through the nodes a node sits in: each
    // element answers only for itself, or a key would be handled twice.
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      // The engine decides what a press does; a native checkbox mustn't toggle itself.
      e.preventDefault();
      events?.activate(entry.node.key);
    });
    el.addEventListener("keydown", (e) => { if (e.target === el) events?.key(e); });
    el.addEventListener("blur", (e) => {
      const to = e.relatedTarget;
      if (to !== canvas && !owns(to)) events?.blur();
    });
    if (native === "range") {
      // Phones' screen readers adjust a range input directly (no keys): turn
      // that into one step, then show the engine's value again.
      el.addEventListener("input", () => {
        const input = el as HTMLInputElement;
        const was = entry.node.value?.now ?? Number(input.defaultValue);
        const dir = Number(input.value) >= was ? 1 : -1;
        input.value = String(was);
        events?.step(entry.node.key, dir);
      });
    }
    return entry;
  };

  const apply = (entry: Entry, node: AccessibleNode, parentRect: Rect): void => {
    entry.node = node;
    const el = entry.el;
    place(el, node.rect, parentRect);
    const attrs = new Map<string, string>();
    const leaf = node.children.length === 0;
    const native = NATIVE[node.role];
    const name = node.name ?? "";
    // Text a leaf held as its name goes once it has children of its own.
    if (!leaf) for (const n of [...el.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
    if (leaf && !native && !LABELLED.has(node.role)) {
      if (el.textContent !== name) el.textContent = name;
    } else if (name) attrs.set("aria-label", name);
    if (native === "button" && leaf && el.textContent !== name) { el.textContent = name; attrs.delete("aria-label"); }
    if (node.description) attrs.set("aria-description", node.description);
    if (node.level !== undefined) attrs.set("aria-level", String(node.level));
    if (node.roleDescription) attrs.set("aria-roledescription", node.roleDescription);
    if (node.disabled) attrs.set("aria-disabled", "true");
    for (const k of ["selected", "expanded", "pressed", "required", "invalid", "multiselectable"] as const) {
      if (node[k] !== undefined) attrs.set(`aria-${k}`, String(node[k]));
    }
    if (node.current) attrs.set("aria-current", node.current === true ? "true" : node.current);
    if (node.sort) attrs.set("aria-sort", node.sort);
    if (node.checked !== undefined) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        el.checked = node.checked === true;
        el.indeterminate = node.checked === "mixed";
      } else attrs.set("aria-checked", String(node.checked));
    }
    const v = node.value;
    const field = node.role === "textbox" || node.role === "searchbox";
    if (node.placeholder) attrs.set("aria-placeholder", node.placeholder);
    if (field) {
      // A text field's content is what's typed in it.
      const typed = v?.text ?? "";
      if (leaf && el.textContent !== typed) el.textContent = typed;
    } else if (v) {
      if (el instanceof HTMLInputElement && el.type === "range") {
        if (v.min !== undefined) el.min = String(v.min);
        if (v.max !== undefined) el.max = String(v.max);
        if (v.now !== undefined) { el.value = String(v.now); el.defaultValue = String(v.now); }
      } else {
        if (v.now !== undefined) attrs.set("aria-valuenow", String(v.now));
        if (v.min !== undefined) attrs.set("aria-valuemin", String(v.min));
        if (v.max !== undefined) attrs.set("aria-valuemax", String(v.max));
      }
      if (v.text !== undefined) attrs.set("aria-valuetext", v.text);
    }
    // Focus moves only through the engine, so nothing joins the page's Tab order.
    if (node.focusable || native) el.tabIndex = -1;
    else el.removeAttribute("tabindex");

    for (const old of entry.attrs) if (!attrs.has(old)) el.removeAttribute(old);
    for (const [k, val] of attrs) if (el.getAttribute(k) !== val) el.setAttribute(k, val);
    entry.attrs = new Set(attrs.keys());
  };

  /** Show a node's children inside its element, reusing elements by key, in order. */
  const renderChildren = (parent: HTMLElement, node: AccessibleNode, seen: Set<string>): void => {
    node.children.forEach((child, i) => {
      let entry = entries.get(child.key);
      if (entry && entry.role !== child.role) { entry.el.remove(); entry = undefined; }
      if (!entry) entries.set(child.key, (entry = create(child)));
      seen.add(child.key);
      apply(entry, child, node.rect);
      if (parent.children[i] !== entry.el) parent.insertBefore(entry.el, parent.children[i] ?? null);
      renderChildren(entry.el, child, seen);
    });
    // Elements left over past the children (their nodes moved or went away).
    while (parent.children.length > node.children.length) parent.lastElementChild!.remove();
  };

  const positionContainer = (): void => {
    const s = container.style;
    s.left = `${canvas.offsetLeft}px`;
    s.top = `${canvas.offsetTop}px`;
    s.width = `${canvas.offsetWidth}px`;
    s.height = `${canvas.offsetHeight}px`;
  };

  return {
    announce(text, politeness = "polite") {
      const el = regions[politeness];
      el.textContent = "";
      const t = setTimeout(() => { timers.delete(t); el.textContent = text; }, ANNOUNCE_DELAY_MS);
      timers.add(t);
    },
    connect(ev) {
      events = ev;
    },
    update(tree, busy) {
      positionContainer();
      const active = document.activeElement;
      const hadFocus = active !== treeRoot && owns(active);
      place(treeRoot, tree.rect, { x: 0, y: 0, w: 0, h: 0 });
      if (tree.name) treeRoot.setAttribute("aria-label", tree.name);
      if (busy) treeRoot.setAttribute("aria-busy", "true");
      else treeRoot.removeAttribute("aria-busy");
      const seen = new Set<string>();
      renderChildren(treeRoot, tree, seen);
      for (const [key, entry] of entries) {
        if (seen.has(key)) continue;
        entry.el.remove();
        entries.delete(key);
      }
      // Moving a focused element to a new parent drops its focus, and one that
      // went away takes focus with it: put focus back on it, or keep it in the
      // interface (on the root) rather than losing it to the page.
      if (hadFocus && document.activeElement !== active) {
        moving = true;
        try { (owns(active) ? (active as HTMLElement) : treeRoot).focus({ preventScroll: true }); } finally { moving = false; }
      }
    },
    focus(key, force = false) {
      const entry = entries.get(key);
      if (!entry) return false;
      const active = document.activeElement;
      if (active === entry.el) return true;
      if (!force && active !== canvas && !owns(active)) return false;
      moving = true;
      try { entry.el.focus(); } finally { moving = false; }
      return document.activeElement === entry.el;
    },
    owns,
    destroy() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      entries.clear();
      events = null;
      container.remove();
    },
  };
}

/** Put an element over its rectangle, relative to its parent's. */
function place(el: HTMLElement, r: Rect, parent: Rect): void {
  const s = el.style;
  s.position = "absolute";
  s.left = `${r.x - parent.x}px`;
  s.top = `${r.y - parent.y}px`;
  s.width = `${Math.max(0, r.w)}px`;
  s.height = `${Math.max(0, r.h)}px`;
  s.margin = "0";
  s.padding = "0";
  s.border = "0";
  s.boxSizing = "border-box";
  s.overflow = "visible";
  s.background = "transparent";
  s.font = "inherit";
}
