/**
 * menu: a button that opens a short list of actions, for the things that can
 * be done to one item (edit, duplicate, delete) without a row of buttons.
 *
 *   menu "Actions"
 *     menu-item "Edit" icon=file on=go:edit
 *     menu-item "Duplicate" icon=copy on=emit:duplicate
 *     menu-item "Delete" tone=bad on=set:confirm:true
 *
 * The list is the engine's popup (ComponentDef.popup): placed below or above
 * the button in what's in sight, drawn on top, closed by Escape, Tab or a
 * press outside, focus going back to the button. Choosing an item closes the
 * list and runs that item's own on=, as written on its line (inside each it
 * sees its item). Without text, the button is three dots, read as "More
 * actions" (or label=).
 */
import type { ComponentDef, PopupContext, PropReader } from "../component";
import { drawIcon, isIconName, type IconName } from "../icons";
import type { PartSemantics } from "../a11y/semantics";
import type { PopupState } from "../popup";
import type { Box, SayShapeNode } from "../types";
import { MOTION } from "../design";
import { fitText } from "./input";
import { fillTint, iconProblems, iconProp, textWidth } from "./util";

export const MAX_MENU_ITEMS = 20;
const ROW_H = 40;
const PAD = 6;
const ROW_PAD = 12;
const ICON = 18;
const TONES = ["default", "bad"] as const;

interface Item {
  node: SayShapeNode;
  label: string;
  icon: IconName | undefined;
  bad: boolean;
  disabled: boolean;
}

interface MenuData {
  items: Item[];
  /** More menu-items than it shows. */
  more: number;
}

const dataOf = (b: Box): MenuData => (b.data as unknown as MenuData | undefined) ?? { items: [], more: 0 };
const usable = (it: Item | undefined): it is Item => !!it && !it.disabled;

function readItems(node: SayShapeNode, kids: SayShapeNode[], props: (n: SayShapeNode) => PropReader): MenuData {
  const all = kids.filter((k) => k.type === "menu-item");
  const items = all.slice(0, MAX_MENU_ITEMS).map((k): Item => {
    const p = props(k);
    const icon = p.str("icon", "");
    return {
      node: k,
      label: p.text() || "Untitled",
      icon: icon && isIconName(icon) ? icon : undefined,
      bad: p.oneOf("tone", TONES, "default") === "bad",
      disabled: p.cond("disabled") || !p.raw("on"),
    };
  });
  void node;
  return { items, more: Math.max(0, all.length - MAX_MENU_ITEMS) };
}

/**
 * The highlighted item's position now. The highlight is kept as the item's
 * element id, not its position, so it stays on the same item when the list
 * changes while open (an item shown by if=, items from each); an item that's
 * gone, or can't be chosen any more, leaves nothing highlighted.
 */
function hiOf(items: Item[], state: PopupState | Readonly<PopupState> | null): number {
  const id = state?.highlight;
  const i = typeof id === "string" ? items.findIndex((it) => it.node.id === id) : -1;
  return usable(items[i]) ? i : -1;
}

const keyOf = (it: Item) => `item:${it.node.id}`;
const idOfDetail = (d: unknown) => (typeof d === "string" && d.startsWith("item:") ? d.slice(5) : null);

/** The next usable item from i in direction dir, wrapping round. */
function next(items: Item[], i: number, dir: 1 | -1): number {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const j = (((i + dir * k) % n) + n) % n;
    if (usable(items[j])) return j;
  }
  return -1;
}

const first = (items: Item[]) => next(items, -1, 1);
const last = (items: Item[]) => next(items, items.length, -1);
const idAt = (items: Item[], i: number) => items[i]?.node.id ?? null;
/** Where the menu sits in its room: the ⋯ at the end, a menu with words at the start like a button, unless align= says. */
const alignOf = (p: PropReader) => p.oneOf("align", ["start", "end"], p.text() ? "start" : "end");

/** Close the list, then run the item's on= as written on its own line. */
function choose(ctx: PopupContext, item: Item): void {
  const on = ctx.props(item.node).raw("on");
  ctx.close(true);
  if (on) ctx.runAs?.(item.node, on);
}

const name = (p: PropReader) => p.text() || p.str("label", "") || "More actions";

export const menu: ComponentDef = {
  type: "menu",
  category: "input",
  description: "A button that opens a short list of actions, for what can be done to one item (edit, duplicate, delete) without a row of buttons. Each menu-item runs its own on=.",
  text: { description: "The button's words, e.g. Actions. Leave it out for a small ⋯ button." },
  props: {
    label: { type: "string", description: "What a screen reader calls a ⋯ button with no text, e.g. label=\"Order actions\". Default: More actions." },
    variant: { type: "enum", values: ["secondary", "primary"], default: "secondary", description: "secondary (outlined) or primary (filled)." },
    disabled: { type: "condition", description: "When true, it can't be opened." },
    align: { type: "enum", values: ["start", "end"], description: "Where it sits in its room: start, or end (the right). Default: end for a ⋯ menu, start for one with words." },
  },
  children: ["menu-item"],
  picks: [{ for: "several actions on one item without a row of buttons", write: "menu holding menu-item" }],
  example: `menu "Actions"
  menu-item "Edit" icon=file on=emit:edit
  menu-item "Duplicate" icon=copy on=emit:duplicate
  menu-item "Delete" icon=x-circle tone=bad on=emit:delete`,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const data = readItems(box.node, ctx.visibleChildren(box.node), (n) => ctx.props(n));
    if (data.more) ctx.warn?.(`menu on line ${box.node.line}: it shows the first ${MAX_MENU_ITEMS} of ${data.items.length + data.more} items. Keep a menu short, or use a select or a list`);
    box.data = data as unknown as Box["data"];
    box.h = ctx.theme.control.height;
    const text = p.text();
    const want = text ? Math.ceil(textWidth(ctx, text, 600, 14)) + 2 * 14 + 18 : ctx.theme.control.height;
    // A ⋯ sits at the end of the room it's given (the trailing ⋯ of a row); one with words at
    // the start, like a button, unless align= says.
    const w = Math.min(box.w, want);
    if (alignOf(p) === "end") box.x += box.w - w;
    box.w = w;
  },
  minWidth(node, ctx) {
    const text = ctx.props(node).text();
    return text ? Math.min(160, Math.ceil(textWidth(ctx, text, 600, 14)) + 2 * 14 + 18) : ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const disabled = p.cond("disabled") || !dataOf(box).items.some(usable);
    const primary = p.oneOf("variant", ["secondary", "primary"], "secondary") === "primary" && !disabled;
    const open = ctx.isPopupOpen(box.node);
    const hover = ctx.tween(box.node, "menu:hover", !disabled && ctx.isHovered(box.node) ? 1 : 0, MOTION.hover);
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    g.fillStyle = primary ? c.accent : c.raised;
    g.fill();
    if (!primary) {
      g.strokeStyle = c.control;
      g.lineWidth = 1;
      g.stroke();
    }
    if (hover > 0 || open) {
      ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
      fillTint(g, primary ? c.onAccent : c.ink, 0.06 * Math.max(hover, open ? 1 : 0));
    }
    const ink = disabled ? c.muted : primary ? c.onAccent : c.ink;
    const text = p.text();
    if (text) {
      g.font = ctx.font(600, 14);
      g.fillStyle = ink;
      g.textAlign = "left";
      g.textBaseline = "middle";
      const room = box.w - 2 * 14 - 18;
      g.fillText(fitText(g, text, room), box.x + 14, box.y + box.h / 2 + 1);
      // A small chevron says it opens a list.
      const cx = box.x + box.w - 14 - 5, cy = box.y + box.h / 2;
      g.beginPath();
      g.moveTo(cx - 4, cy - (open ? -2 : 2));
      g.lineTo(cx, cy + (open ? -2 : 2));
      g.lineTo(cx + 4, cy - (open ? -2 : 2));
      g.strokeStyle = ink;
      g.lineWidth = 1.75;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    } else {
      // Three dots.
      g.fillStyle = ink;
      for (const dx of [-6, 0, 6]) {
        g.beginPath();
        g.arc(box.x + box.w / 2 + dx, box.y + box.h / 2, 1.9, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (ctx.isFocused(box.node)) {
      ctx.roundRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4, theme.radius.md + 2);
      g.strokeStyle = c.focus;
      g.lineWidth = 2;
      g.stroke();
    }
    if (!disabled) ctx.addHit(box);
  },
  cursor: () => "pointer",
  press(ctx) {
    if (ctx.popupOpen) return;
    // From the pointer nothing is highlighted yet; the keys highlight as they move.
    ctx.openPopup({ highlight: null });
  },
  key(ctx, key) {
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Enter" && key !== " ") return false;
    const items = dataOf(ctx.target.box).items;
    // A menu opened from the keyboard highlights its first item (ArrowUp: its last).
    ctx.openPopup({ highlight: idAt(items, key === "ArrowUp" ? last(items) : first(items)) });
    return true;
  },
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const { items } = dataOf(box);
    const open = ctx.popupOpen;
    const hi = items[hiOf(items, ctx.popup)];
    const disabled = p.cond("disabled") || !items.some(usable) || undefined;
    // Closed, a menu button. Open, the same node (it keeps focus) is the menu itself, pointing at
    // the highlighted item: aria-activedescendant works on a menu, not on a button.
    if (!open) return { role: "button", name: name(p), expanded: false, hasPopup: "menu", disabled };
    const parts: PartSemantics[] = items.map((it) => ({ detail: keyOf(it), role: "menuitem", name: it.label, disabled: it.disabled || undefined }));
    return { role: "menu", name: name(p), parts, ...(hi ? { active: keyOf(hi) } : {}) };
  },
  popup: {
    measure(owner, ctx) {
      const { items } = dataOf(owner);
      if (!items.length || ctx.props(owner.node).cond("disabled")) return null;
      const widest = Math.max(...items.map((it) => textWidth(ctx, it.label, 500, 14) + (it.icon ? ICON + 10 : 0)));
      const w = Math.min(320, Math.max(180, Math.ceil(widest) + 2 * ROW_PAD + 2 * PAD));
      const h = items.length * ROW_H + 2 * PAD;
      // Its list lines up with the button's right edge when the button is on the right.
      return { w, h, minH: Math.min(h, 3 * ROW_H + 2 * PAD), ownWidth: true, alignEnd: owner.x + owner.w / 2 > ctx.screenWidth() / 2 };
    },
    paint(owner, area, ctx, state) {
      const { items } = dataOf(owner);
      const { g, theme } = ctx;
      const c = theme.colors;
      const hi = hiOf(items, state);
      g.textAlign = "left";
      g.textBaseline = "middle";
      items.forEach((it, i) => {
        const y = area.y + PAD + i * ROW_H;
        if (y + ROW_H > area.y + area.h) return;
        const row: Box = { node: owner.node, x: area.x + PAD, y, w: area.w - 2 * PAD, h: ROW_H, children: [], data: owner.data };
        const detail = keyOf(it);
        if (!it.disabled) ctx.addHit(row, { detail, focusable: false });
        const hover = !it.disabled && ctx.isHovered(owner.node, detail);
        if (i === hi || hover) {
          ctx.roundRect(row.x, row.y + 1, row.w, row.h - 2, theme.radius.sm);
          fillTint(g, it.bad ? c.bad : i === hi ? c.accent : c.ink, i === hi ? 0.12 : 0.05);
        }
        const ink = it.disabled ? c.muted : it.bad ? c.bad : c.ink;
        let x = row.x + ROW_PAD;
        if (it.icon) {
          drawIcon(g, it.icon, x, y + (ROW_H - ICON) / 2, ICON, it.disabled ? c.muted : it.bad ? c.bad : c.muted);
          x += ICON + 10;
        }
        g.font = ctx.font(500, 14);
        g.fillStyle = ink;
        g.fillText(fitText(g, it.label, row.x + row.w - ROW_PAD - x), x, y + ROW_H / 2 + 1);
      });
    },
    point(ctx, detail) {
      const id = idOfDetail(detail);
      if (id && dataOf(ctx.target.box).items.some((x) => x.node.id === id && usable(x))) ctx.popup.highlight = id;
    },
    press(ctx) {
      const id = idOfDetail(ctx.target.detail);
      const it = dataOf(ctx.target.box).items.find((x) => x.node.id === id);
      if (usable(it)) choose(ctx, it);
    },
    key(ctx, key) {
      const items = dataOf(ctx.target.box).items;
      const hi = hiOf(items, ctx.popup);
      const go = (i: number) => { ctx.popup.highlight = idAt(items, i); return true; };
      switch (key) {
        case "ArrowDown": return go(next(items, hi, 1));
        case "ArrowUp": return go(next(items, hi < 0 ? items.length : hi, -1));
        case "Home": return go(first(items));
        case "End": return go(last(items));
        case "Enter":
        case " ": {
          const it = items[hi];
          if (usable(it)) choose(ctx, it);
          return true;
        }
        default: {
          // A letter moves to the next item starting with it.
          if (key.length !== 1 || !/\S/.test(key)) return false;
          const n = items.length;
          for (let k = 1; k <= n; k++) {
            const j = (((hi + k) % n) + n) % n;
            const it = items[j];
            if (usable(it) && it.label.toLowerCase().startsWith(key.toLowerCase())) return go(j);
          }
          return true;
        }
      }
    },
  },
};

export const menuItem: ComponentDef = {
  drawnByParent: true,
  type: "menu-item",
  category: "input",
  description: "One action in a menu's list.",
  text: { description: "What it does, e.g. Duplicate.", required: true },
  props: {
    on: { type: "action", required: true, description: "What happens when it's chosen, e.g. emit:duplicate or set:confirm:true. Separate several with ;" },
    icon: iconProp,
    tone: { type: "enum", values: TONES, default: "default", description: "bad for an action that removes or can't be undone, drawn in the bad color." },
    disabled: { type: "condition", description: "When true, it's shown but can't be chosen." },
  },
  parents: ["menu"],
  example: `menu-item "Duplicate" icon=copy on=emit:duplicate`,
  check(props) {
    return iconProblems(props.icon, "icon");
  },
  // Drawn by its menu: no box of its own.
  layout(box) {
    box.h = 0;
  },
  semantics: () => null,
};
