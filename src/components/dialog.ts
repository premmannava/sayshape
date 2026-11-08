/**
 * dialog: a panel over the screen that asks for attention: confirm a delete,
 * fill in a short form, read the details of one item. It's an overlay
 * (ComponentDef.overlay): it takes no room where it's written, opens when
 * its bind= state is true, floats centred in what's in sight over a dimmed
 * screen, and while open it's the only thing that can be pressed or reached
 * with Tab. Its × button, Escape and a press outside it set bind= to false.
 *
 *   state confirm=false
 *   button "Delete order" variant=danger on=set:confirm:true
 *   dialog "Delete order NW-2041?" bind=confirm
 *     text "This can't be undone."
 *     row
 *       button "Cancel" variant=secondary on=set:confirm:false
 *       button "Delete" variant=danger on="emit:delete;set:confirm:false"
 */
import type { ComponentDef, LayoutContext, PressContext } from "../component";
import { drawIcon } from "../icons";
import { wrapText } from "../text";
import type { Box, SayShapeNode } from "../types";
import { onProp, runOn, themeFont } from "./util";

const SIZES = ["sm", "md", "lg"] as const;
const CLOSE = "close";

interface DialogData {
  title: string[];
  titleLH: number;
  pad: number;
  closeSize: number;
}

/** How wide a dialog is: a share of the screen, at most a width that reads well, from the theme. */
function dialogWidth(node: SayShapeNode, screen: number, ctx: LayoutContext): number {
  const size = ctx.props(node).oneOf("size", SIZES, "md");
  const unit = ctx.theme.control.height;
  const want = unit * { sm: 9, md: 13, lg: 18 }[size];
  return Math.min(want, Math.max(0, screen - 2 * ctx.theme.space.md));
}

function close(ctx: PressContext): void {
  const bind = ctx.props(ctx.target.node).raw("bind");
  if (bind) ctx.set(bind, false);
  runOn(ctx);
}

export const dialog: ComponentDef = {
  type: "dialog",
  category: "feedback",
  description: "A panel over the screen for something that needs an answer or attention first: confirm a delete, a short form, one item's details. It opens when bind= is true, so start that state false and open it from a button, unless it should greet people as the screen opens; its × button, Escape and a press outside it close it.",
  text: { description: "The title at its top, e.g. Delete order?" },
  props: {
    bind: { type: "state", required: true, description: "A true/false state: true shows it, e.g. bind=confirm. Open it with on=set:confirm:true; close it from a button inside with on=set:confirm:false." },
    size: { type: "enum", values: SIZES, default: "md", description: "How wide it gets: sm (a question), md (a short form) or lg (details)." },
    on: onProp("when it's closed by its × button, Escape or a press outside it"),
  },
  children: "any",
  picks: [{ for: "checking before something that can't be undone", write: "dialog bind=confirm size=sm" }],
  example: `state confirm=true
button "Delete order" variant=danger on=set:confirm:true
dialog "Delete order NW-2041?" bind=confirm size=sm
  text "The order and its invoice are removed. This can't be undone." tone=muted
  row
    button "Cancel" variant=secondary on=set:confirm:false
    button "Delete" variant=danger on="emit:delete;set:confirm:false"`,
  overlay: {
    open: (node, ctx) => ctx.props(node).bound() === true,
    width: dialogWidth,
    close,
  },
  layout(box, ctx) {
    const t = ctx.theme;
    const pad = t.space.lg;
    // The × is a full control's height to press, so it's easy to hit on a phone.
    const closeSize = t.control.height;
    const font = themeFont(t, 600, t.text.title);
    const titleLH = Math.round(t.text.title * 1.3);
    const title = ctx.props(box.node).text() ? wrapText(ctx.props(box.node).text(), Math.max(0, box.w - 2 * pad - closeSize + Math.round(closeSize / 4) - t.space.sm), font, ctx.measure) : [];
    let y = box.y + pad + Math.max(title.length * titleLH, closeSize - Math.round(closeSize / 4)) + t.space.md;
    const kids = ctx.visibleChildren(box.node);
    kids.forEach((k, i) => {
      if (i) y += t.space.md;
      const kb = ctx.layout(k, box.x + pad, y, Math.max(0, box.w - 2 * pad));
      box.children.push(kb);
      y += kb.h;
    });
    box.h = y - box.y + pad;
    const data: DialogData = { title, titleLH, pad, closeSize };
    box.data = data as unknown as Box["data"];
  },
  paint(box, ctx) {
    const d = box.data as unknown as DialogData | undefined;
    if (!d) return;
    const { g, theme } = ctx;
    const c = theme.colors;
    // A raised panel with a wide soft shadow, like the popups.
    g.save();
    ctx.roundRect(box.x, box.y, box.w, box.h, theme.radius.lg);
    g.shadowColor = c.shadow;
    g.shadowBlur = 32;
    g.shadowOffsetY = 12;
    g.fillStyle = c.raised;
    g.fill();
    g.restore();
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.lg);
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    g.font = themeFont(theme, 600, theme.text.title);
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    d.title.forEach((line, i) => g.fillText(line, box.x + d.pad, box.y + d.pad + i * d.titleLH + d.titleLH / 2));
    // The × in the top corner.
    // Its pressable square overhangs the padding a little, so the × itself lines up with the text.
    const nudge = Math.round(d.closeSize / 4);
    const cx = box.x + box.w - d.pad - d.closeSize + nudge, cy = box.y + d.pad - nudge;
    const hover = ctx.isHovered(box.node, CLOSE);
    if (hover) { ctx.roundRect(cx, cy, d.closeSize, d.closeSize, theme.radius.md); g.fillStyle = c.line; g.fill(); }
    const icon = Math.round(d.closeSize * 0.45);
    drawIcon(g, "x", cx + (d.closeSize - icon) / 2, cy + (d.closeSize - icon) / 2, icon, c.muted);
    ctx.addHit({ node: box.node, x: cx, y: cy, w: d.closeSize, h: d.closeSize, children: [], data: box.data }, { detail: CLOSE });
  },
  hitTest: (_box, _x, _y, detail) => ({ detail }),
  press(ctx) {
    if (ctx.target.detail === CLOSE) close(ctx);
  },
  semantics(box, ctx) {
    const name = ctx.props(box.node).text() || "Dialog";
    // A modal dialog: while it's open, the engine shows screen readers only what's in it.
    return { role: "dialog", name, parts: [{ detail: CLOSE, role: "button", name: "Close" }] };
  },
};
