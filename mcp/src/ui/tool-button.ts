/**
 * tool-button: a small square icon button for the view's own toolbar (Save
 * image). It is registered only in the toolbar's engine, never in the model's,
 * so it isn't in the model guide and a spec can't use it. It's a utility, so it
 * stays quiet: a muted icon with no border until the pointer is over it. It
 * sits at the right end of its slot, so a row can give it room without
 * stretching it.
 */
import type { ComponentDef } from "../../../src/component";
import { drawIcon, isIconName } from "../../../src/icons";
import { fillTint, onProp, partBox } from "../../../src/components/util";

/** The icon's size inside the button, in pixels. */
const ICON = 16;

/** The button's side: three quarters of a control, smaller than the interface's own buttons. */
export const toolSize = (controlHeight: number): number => Math.round(controlHeight * 0.75);

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
  minWidth: (_node, ctx) => toolSize(ctx.theme.control.height),
  // Only an icon is drawn, so its text is its name for screen readers.
  semantics(box, ctx) {
    return { role: "button", name: ctx.props(box.node).text() };
  },
  layout(box, ctx) {
    box.h = toolSize(ctx.theme.control.height);
  },
  paint(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const p = ctx.props(box.node);
    const size = toolSize(theme.control.height);
    const x = box.x + Math.max(0, box.w - size);
    const hover = ctx.tween(box.node, "tool:hover", ctx.isHovered(box.node) ? 1 : 0, 120);
    const pressed = ctx.isPressed(box.node);
    if (hover > 0 || pressed) {
      // Only under the pointer: a soft wash and a hairline, so it reads as pressable.
      ctx.roundRect(x + 0.5, box.y + 0.5, size - 1, size - 1, theme.radius.sm);
      fillTint(g, c.ink, 0.06 * hover + (pressed ? 0.06 : 0));
      g.save();
      g.globalAlpha *= hover;
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }
    const icon = p.str("icon");
    if (isIconName(icon)) drawIcon(g, icon, x + (size - ICON) / 2, box.y + (size - ICON) / 2, ICON, hover > 0.5 || pressed ? c.ink : c.muted);
    ctx.addHit(partBox(box, x, box.y, size, size));
  },
};
