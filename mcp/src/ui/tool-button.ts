/**
 * tool-button: a square icon button for the view's own toolbar (Save image).
 * It is registered only in the toolbar's engine, never in the model's, so it
 * isn't in the model guide and a spec can't use it. It looks like a secondary
 * button and sits at the right end of its slot, so a row can give it room
 * without stretching it.
 */
import type { ComponentDef } from "../../../src/component";
import { drawIcon, isIconName } from "../../../src/icons";
import { fillTint, onProp, partBox } from "../../../src/components/util";

/** The icon's size inside the button, in pixels. */
const ICON = 20;

export const toolButton: ComponentDef = {
  type: "tool-button",
  category: "input",
  description: "A square icon button for the view's own controls, such as Save image. Not offered to models.",
  text: { description: "What the button does, read out for people using a screen reader.", required: true },
  props: {
    icon: { type: "string", required: true, description: "An icon from icon's list, e.g. icon=download." },
    on: onProp("when pressed"),
  },
  example: `tool-button "Save image" icon=download on=emit:save_image`,
  minWidth: (_node, ctx) => ctx.theme.control.height,
  layout(box, ctx) {
    box.h = ctx.theme.control.height;
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const p = ctx.props(box.node);
    const size = theme.control.height;
    const x = box.x + Math.max(0, box.w - size);
    const hover = ctx.tween(box.node, "tool:hover", ctx.isHovered(box.node) ? 1 : 0, 120);
    const pressed = ctx.isPressed(box.node);
    ctx.roundRect(x + 0.5, box.y + 0.5, size - 1, size - 1, theme.radius.md);
    g.fillStyle = c.raised;
    g.fill();
    if (hover || pressed) fillTint(g, c.ink, 0.05 * hover + (pressed ? 0.05 : 0));
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    const icon = p.str("icon");
    if (isIconName(icon)) drawIcon(g, icon, x + (size - ICON) / 2, box.y + (size - ICON) / 2, ICON, c.ink);
    ctx.addHit(partBox(box, x, box.y, size, size));
  },
};
