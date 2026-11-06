import { toNumber } from "../data";
import type { ComponentDef, LayoutContext, PropReader } from "../component";
import type { Box, SayShapeNode } from "../types";
import { INPUT_KINDS } from "../editor";
import { isDarkTheme, mixColors, type Theme } from "../theme";
import { MOTION } from "../design";
import { fillTint, labelLines, onProp, partBox, runOn, textWidth, themeFont } from "./util";

const VARIANTS = ["primary", "secondary", "danger"] as const;

/** Wider than this, a button takes its label's width instead of all the space it's given. */
export const BUTTON_FULL_UNDER = 360;

/** A button's own width: its label with room either side. */
function buttonWidth(node: SayShapeNode, ctx: LayoutContext): number {
  return Math.max(96, Math.ceil(textWidth(ctx, ctx.props(node).text(), 600, 14) + 44));
}

export const button: ComponentDef = {
  type: "button",
  category: "input",
  description: "A pressable button that runs actions. Use emit: to tell the app what the user chose.",
  text: { description: "The button label.", required: true },
  props: {
    on: { type: "action", description: "What happens when pressed, e.g. inc:count, set:done:true, emit:book. Separate several with ;" },
    variant: { type: "enum", values: VARIANTS, default: "primary", description: "primary (filled), secondary (outlined) or danger." },
    disabled: { type: "condition", description: "Expression; when true the button is greyed out and can't be pressed." },
  },
  example: `button "Book now" on=emit:book
button "Back" variant=secondary on=dec:step`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    return { role: "button", name: p.text(), disabled: p.cond("disabled") || undefined };
  },
  layout(box, ctx) {
    box.h = ctx.theme.control.height;
    // On a phone a button takes the full width, which is easy to tap. Anywhere wider it takes the
    // width of its label, like buttons in apps and on the web, instead of a long slab.
    if (box.w > BUTTON_FULL_UNDER) box.w = Math.min(box.w, buttonWidth(box.node, ctx));
  },
  minWidth(node, ctx) {
    const w = textWidth(ctx, ctx.props(node).text(), 600, 14) + 24;
    return Math.max(64, Math.min(160, w));
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const variant = p.oneOf("variant", VARIANTS, "primary");
    const disabled = p.cond("disabled");
    const hot = !disabled && ctx.isHovered(box.node);
    const down = !disabled && ctx.isPressed(box.node);
    const hoverProgress = ctx.tween(box.node, "button:hover", hot ? 1 : 0, MOTION.hover);
    const pressProgress = ctx.tween(box.node, "button:press", down ? 1 : 0, MOTION.press);
    const color = variant === "danger" ? c.bad : c.accent;
    const secondary = variant === "secondary";
    if (disabled) g.globalAlpha *= 0.45;
    // Micro-scale the painted button only, never its layout or hit region.
    g.save();
    const scale = 1 - pressProgress * 0.018;
    g.translate(box.x + box.w / 2, box.y + box.h / 2);
    g.scale(scale, scale);
    g.translate(-box.x - box.w / 2, -box.y - box.h / 2);
    ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, theme.radius.md);
    // A close, crisp shadow lifts the button a hair off the surface; it goes while held down.
    g.save();
    if (!disabled) {
      g.shadowColor = c.shadow;
      g.shadowBlur = (2 + 4 * hoverProgress) * (1 - pressProgress);
      g.shadowOffsetY = (1 + hoverProgress) * (1 - pressProgress);
    }
    if (secondary) {
      g.fillStyle = c.raised;
    } else if (variant === "primary" && c.accent2 !== c.accent) {
      // A theme with an accent gradient runs it across its primary buttons.
      const finish = g.createLinearGradient(box.x, 0, box.x + box.w, 0);
      finish.addColorStop(0, c.accent);
      finish.addColorStop(1, c.accent2);
      g.fillStyle = finish;
    } else {
      const finish = g.createLinearGradient(0, box.y, 0, box.y + box.h);
      finish.addColorStop(0, color);
      finish.addColorStop(1, mixColors(color, c.raised, 0.19) ?? color);
      g.fillStyle = finish;
    }
    g.fill();
    g.restore();
    if (!secondary && box.w > 30) {
      // A restrained top-edge reflection, independent from content and hit geometry.
      g.save();
      g.beginPath();
      g.moveTo(box.x + 14, box.y + 2);
      g.lineTo(box.x + box.w - 14, box.y + 2);
      g.strokeStyle = c.onAccent;
      g.lineWidth = 1;
      g.globalAlpha *= 0.17 * (1 - pressProgress);
      g.stroke();
      g.restore();
    }
    // Hover and press move toward the ink: a filled button deepens on a light theme and
    // brightens on a dark one, so it always gains contrast instead of washing out.
    if (secondary) {
      if (hoverProgress || pressProgress) fillTint(g, c.ink, 0.04 * hoverProgress + 0.04 * pressProgress);
      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.stroke();
      if (hoverProgress) { g.save(); g.globalAlpha *= 0.22 * hoverProgress; g.strokeStyle = c.ink; g.stroke(); g.restore(); }
    } else if (hoverProgress || pressProgress) fillTint(g, c.ink, 0.12 * hoverProgress + 0.08 * pressProgress);
    g.font = ctx.font(600, 14);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = secondary ? c.ink : c.onAccent;
    g.fillText(fitText(g, p.text(), box.w - 16), box.x + box.w / 2, box.y + box.h / 2 + 1);
    g.restore();
    if (!disabled) ctx.addHit(box);
  },
};

export const check: ComponentDef = {
  type: "check",
  category: "input",
  description: "A checkbox that toggles a true/false state value.",
  text: { description: "The label next to the box.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The state name this checkbox reads and writes." },
  },
  example: `state agreed=false
check "I agree to the terms" bind=agreed`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    return { role: "checkbox", name: p.text(), checked: !!p.bound() };
  },
  layout(box, ctx) {
    const l = labelLines(ctx, ctx.props(box.node).text(), box.w - 30, 3);
    box.data = l;
    box.h = Math.max(26, l.lines.length * l.lh + 6);
  },
  minWidth: (node, ctx) => 30 + Math.min(100, textWidth(ctx, ctx.props(node).text(), 400, ctx.theme.text.body)),
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const on = !!p.bound();
    const hot = ctx.isHovered(box.node);
    const selected = ctx.tween(box.node, "check:marked", on ? 1 : 0, MOTION.selection);
    const hover = ctx.tween(box.node, "check:hover", hot ? 1 : 0, MOTION.hover);
    ctx.roundRect(box.x + 0.5, box.y + 4.5, 18, 18, Math.min(5, theme.radius.sm));
    g.fillStyle = c.surface;
    g.fill();
    if (selected > 0) {
      g.save();
      g.globalAlpha *= selected;
      g.fillStyle = c.accent;
      g.fill();
      g.strokeStyle = c.onAccent;
      g.lineWidth = 2.2;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(box.x + 5, box.y + 13.5);
      g.lineTo(box.x + 8.5, box.y + 17);
      g.lineTo(box.x + 14.5, box.y + 10);
      g.stroke();
      g.restore();
    }
    ctx.roundRect(box.x + 0.5, box.y + 4.5, 18, 18, Math.min(5, theme.radius.sm));
    g.save();
    g.globalAlpha *= 1 - selected;
    g.strokeStyle = hot ? c.accent : c.control;
    g.lineWidth = 1.25;
    g.stroke();
    g.restore();
    g.font = ctx.font(400, theme.text.body);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = c.ink;
    const l = box.data as { lines: string[]; lh: number };
    l.lines.forEach((line, i) => g.fillText(line, box.x + 30, box.y + 14 + i * l.lh));
    ctx.addHit(box);
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (key) ctx.set(key, !ctx.props(ctx.target.node).bound());
  },
};

export const switchToggle: ComponentDef = {
  type: "switch",
  category: "input",
  description: "An on/off switch with a label, for settings that take effect right away.",
  text: { description: "The label for the setting.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The true/false state name this switch reads and writes." },
    on: onProp("after it is switched"),
  },
  example: `state updates=true
switch "Email me order updates" bind=updates`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    return { role: "switch", name: p.text(), checked: !!p.bound() };
  },
  layout(box, ctx) {
    const l = labelLines(ctx, ctx.props(box.node).text(), box.w - 52, 3);
    box.data = l;
    box.h = Math.max(28, l.lines.length * l.lh + 8);
  },
  minWidth: (node, ctx) => 52 + Math.min(100, textWidth(ctx, ctx.props(node).text(), 400, ctx.theme.text.body)),
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const on = !!p.bound();
    const position = ctx.tween(box.node, "switch:position", on ? 1 : 0, MOTION.selection);
    // The toggle sits beside the first line of the label, however many lines it wraps to.
    const tw = 36, th = 20, tx = box.x + box.w - tw, ty = box.y + (28 - th) / 2;
    g.font = ctx.font(400, theme.text.body);
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const l = box.data as { lines: string[]; lh: number };
    l.lines.forEach((line, i) => g.fillText(line, box.x, box.y + 15 + i * l.lh));
    ctx.roundRect(tx, ty, tw, th, th / 2);
    // The track transitions with the knob instead of flipping abruptly.
    fillTint(g, c.ink, 0.16);
    if (position < 1) {
      // Off, its outline shows where it is (the tint alone is too faint to see).
      g.save();
      g.globalAlpha *= 1 - position;
      g.strokeStyle = c.control;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }
    if (position > 0) {
      g.save();
      g.globalAlpha *= position;
      g.fillStyle = c.accent;
      g.fill();
      g.restore();
    }
    if (ctx.isHovered(box.node)) fillTint(g, c.ink, 0.06);
    // The knob is the lightest color in the theme, with a hairline shadow.
    g.beginPath();
    g.arc(tx + th / 2 + (tw - th) * position, ty + th / 2, th / 2 - 2.5, 0, Math.PI * 2);
    g.save();
    g.shadowColor = c.shadow;
    g.shadowBlur = 2;
    g.shadowOffsetY = 1;
    g.fillStyle = isDarkTheme(theme) ? c.ink : c.surface;
    g.fill();
    g.restore();
    ctx.addHit(box);
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key) return;
    ctx.set(key, !ctx.props(ctx.target.node).bound());
    runOn(ctx);
  },
};

export const radio: ComponentDef = {
  type: "radio",
  category: "input",
  description: "One choice among several. Give each radio in a group the same bind= and its own value=.",
  text: { description: "The label for this choice.", required: true },
  props: {
    bind: { type: "state", required: true, description: "The state name the group shares; it holds the chosen value." },
    value: { type: "string", required: true, description: "What bind= is set to when this radio is chosen." },
    on: onProp("after it is chosen"),
  },
  example: `state size=m
radio "Small" bind=size value=s
radio "Medium" bind=size value=m
radio "Large" bind=size value=l`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    // Radios sharing a bind= are one group, named by the text just above the first.
    return { role: "radio", name: p.text(), checked: p.bound() === (p.value("value") ?? ""), group: { key: `radio:${p.raw("bind") ?? ""}`, role: "radiogroup" } };
  },
  layout(box, ctx) {
    const l = labelLines(ctx, ctx.props(box.node).text(), box.w - 30, 3);
    box.data = l;
    box.h = Math.max(26, l.lines.length * l.lh + 6);
  },
  minWidth: (node, ctx) => 30 + Math.min(100, textWidth(ctx, ctx.props(node).text(), 400, ctx.theme.text.body)),
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const chosen = p.bound() === (p.value("value") ?? "");
    const progress = ctx.tween(box.node, "radio:selected", chosen ? 1 : 0, MOTION.selection);
    const cx = box.x + 9.5, cy = box.y + 13;
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fillStyle = c.surface;
    g.fill();
    g.save();
    const strong = chosen || ctx.isHovered(box.node);
    g.strokeStyle = strong ? c.accent : c.control;
    g.lineWidth = chosen ? 1.75 : 1.25;
    g.stroke();
    g.restore();
    if (progress > 0.02) {
      g.beginPath();
      g.arc(cx, cy, 4 * progress, 0, Math.PI * 2);
      g.fillStyle = c.accent;
      g.fill();
    }
    g.font = ctx.font(400, theme.text.body);
    g.fillStyle = c.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const l = box.data as { lines: string[]; lh: number };
    l.lines.forEach((line, i) => g.fillText(line, box.x + 30, cy + 1 + i * l.lh));
    ctx.addHit(box);
  },
  press(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    ctx.set(key, p.value("value") ?? "");
    runOn(ctx);
  },
};

const STEP_W = 42, VALUE_W = 52, STEPPER_W = STEP_W * 2 + VALUE_W;

/** A stepper's limits and current value, read the same way when painting and pressing. */
function stepperState(p: PropReader) {
  const min = p.num("min", 0);
  const max = p.has("max") ? p.num("max", Infinity) : Infinity;
  const step = Math.abs(p.num("step", 1)) || 1;
  const raw = toNumber(p.bound());
  const value = Number.isFinite(raw) ? raw : min;
  return { min, max, step, value };
}

export const stepper: ComponentDef = {
  type: "stepper",
  category: "input",
  description: "A number with minus and plus buttons, for small counts like a quantity.",
  text: { description: "An optional label on the left." },
  props: {
    bind: { type: "state", required: true, description: "The number state this stepper reads and writes." },
    min: { type: "number", default: 0, description: "Smallest value (default 0)." },
    max: { type: "number", description: "Largest value (no limit if left out)." },
    step: { type: "number", default: 1, description: "How much each press changes the value (default 1)." },
    on: onProp("after the value changes"),
  },
  example: `state qty=2
stepper "Quantity" bind=qty min=1 max=10`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const { min, max, value } = stepperState(p);
    const label = p.text() || ctx.textBefore() || "Amount";
    return {
      role: "group",
      name: label,
      parts: [
        { detail: "dec", role: "button", name: `Decrease ${label}`, disabled: !(value - 1e-9 > min) || undefined },
        // A status, so the new value is read after each press.
        { detail: "value", role: "status", name: String(Math.round(value * 1000) / 1000) },
        { detail: "inc", role: "button", name: `Increase ${label}`, disabled: !(value + 1e-9 < max) || undefined },
      ],
    };
  },
  layout(box, ctx) {
    const control = ctx.theme.control.height;
    const label = ctx.props(box.node).text();
    const beside = box.w - STEPPER_W - 12;
    // Too narrow for the label beside the buttons: put it above them instead of squeezing it.
    const stacked = !!label && beside < 56;
    const l = labelLines(ctx, label, stacked ? box.w : beside, 2);
    const labelH = l.lines.length * l.lh;
    const controlY = stacked ? labelH + 6 : Math.max(0, (labelH - control) / 2);
    box.data = { ...l, stacked, controlY };
    box.h = stacked ? controlY + control : Math.max(control, labelH);
  },
  minWidth(node, ctx) {
    const label = ctx.props(node).text();
    return STEPPER_W + (label ? 12 + Math.min(90, textWidth(ctx, label, 400, ctx.theme.text.body)) : 0);
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { min, max, value } = stepperState(p);
    const total = STEPPER_W;
    const d = box.data as { lines: string[]; lh: number; stacked: boolean; controlY: number };
    const h = theme.control.height;
    const top = box.y + d.controlY;
    const x0 = d.lines.length && !d.stacked ? box.x + Math.max(0, box.w - total) : box.x;
    if (d.lines.length) {
      g.font = ctx.font(400, theme.text.body);
      g.fillStyle = c.ink;
      g.textAlign = "left";
      g.textBaseline = "middle";
      // Beside the buttons the label is centred on them; above them it starts at the top.
      const first = d.stacked ? box.y + d.lh / 2 + 1 : box.y + Math.max(d.lines.length * d.lh, h) / 2 - ((d.lines.length - 1) * d.lh) / 2 + 1;
      d.lines.forEach((line, i) => g.fillText(line, box.x, first + i * d.lh));
    }
    ctx.roundRect(x0 + 0.5, top + 0.5, total - 1, h - 1, theme.radius.md);
    g.fillStyle = c.surface;
    g.fill();
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    g.save();
    g.globalAlpha *= 0.7;
    g.fillStyle = c.line;
    g.fillRect(x0 + STEP_W, top + 10, 1, h - 20);
    g.fillRect(x0 + STEP_W + VALUE_W, top + 10, 1, h - 20);
    g.restore();
    const parts = [
      { name: "dec", x: x0, enabled: value - 1e-9 > min, sign: "−" },
      { name: "inc", x: x0 + STEP_W + VALUE_W, enabled: value + 1e-9 < max, sign: "+" },
    ];
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const part of parts) {
      const pb = partBox(box, part.x, top, STEP_W, h);
      if (part.enabled && ctx.isHovered(box.node, part.name)) {
        ctx.roundRect(pb.x + 4, pb.y + 4, pb.w - 8, pb.h - 8, theme.radius.sm);
        fillTint(g, c.ink, 0.06);
      }
      g.save();
      if (!part.enabled) g.globalAlpha *= 0.35;
      g.font = ctx.font(400, 18);
      g.fillStyle = c.ink;
      g.fillText(part.sign, pb.x + STEP_W / 2, top + h / 2 + 1);
      g.restore();
      if (part.enabled) ctx.addHit(pb, { detail: part.name });
    }
    g.font = ctx.font(600, theme.text.body);
    g.fillStyle = c.ink;
    g.fillText(fitText(g, String(Math.round(value * 1000) / 1000), VALUE_W - 6), x0 + STEP_W + VALUE_W / 2, top + h / 2 + 1);
  },
  press(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    const { min, max, step, value } = stepperState(p);
    const next = ctx.target.detail === "inc" ? value + step : value - step;
    ctx.set(key, Math.round(Math.min(max, Math.max(min, next)) * 1e6) / 1e6);
    runOn(ctx);
  },
};

const STAR = 20, STAR_GAP = 4;

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

export const rating: ComponentDef = {
  type: "rating",
  category: "data",
  description: "A star rating. Shows value= as stars, or with bind= lets the user pick a rating.",
  props: {
    value: { type: "number", description: "The rating to show, e.g. 4.5. Ignored when bind= is set." },
    max: { type: "number", default: 5, description: "How many stars (default 5)." },
    bind: { type: "state", description: "A number state the user sets by pressing a star." },
    label: { type: "string", description: "What's being rated, read by screen readers, e.g. label=\"Your rating\". Default: the text just above it." },
    on: onProp("after the user picks a rating"),
  },
  example: `state stars=4
rating value=4.5
rating bind=stars`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const max = Math.max(1, Math.min(10, Math.round(p.num("max", 5))));
    const bind = p.raw("bind");
    const value = bind ? toNumber(p.bound()) || 0 : p.num("value", 0);
    const stars = (n: number) => `${n} ${n === 1 ? "star" : "stars"}`;
    const label = p.str("label");
    if (!bind) return { role: "img", name: `${label ? `${label}: ` : ""}${Math.round(value * 10) / 10} out of ${stars(max)}` };
    return {
      role: "radiogroup",
      name: label || ctx.textBefore() || "Rating",
      parts: Array.from({ length: max }, (_, i) => ({ detail: i + 1, role: "radio" as const, name: stars(i + 1), checked: value === i + 1 })),
    };
  },
  layout(box) {
    box.h = STAR + 4;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const max = Math.max(1, Math.min(10, Math.round(p.num("max", 5))));
    const bind = p.raw("bind");
    let value = bind ? toNumber(p.bound()) || 0 : p.num("value", 0);
    if (bind && ctx.hover && ctx.hover.node.id === box.node.id && typeof ctx.hover.detail === "number") value = ctx.hover.detail;
    for (let i = 0; i < max; i++) {
      const x = box.x + i * (STAR + STAR_GAP);
      const cy = box.y + box.h / 2;
      starPath(g, x + STAR / 2, cy, STAR / 2);
      // Muted rather than the line color, which almost vanishes on dark surfaces.
      fillTint(g, c.muted, 0.35);
      const fill = Math.max(0, Math.min(1, value - i));
      if (fill > 0) {
        g.save();
        g.beginPath();
        g.rect(x, box.y, STAR * fill, box.h);
        g.clip();
        starPath(g, x + STAR / 2, cy, STAR / 2);
        g.fillStyle = c.warn;
        g.fill();
        g.restore();
      }
      if (bind) ctx.addHit(partBox(box, x - STAR_GAP / 2, box.y, STAR + STAR_GAP, box.h), { detail: i + 1 });
    }
  },
  press(ctx) {
    const key = ctx.props(ctx.target.node).raw("bind");
    if (!key || typeof ctx.target.detail !== "number") return;
    ctx.set(key, ctx.target.detail);
    runOn(ctx);
  },
};

export const link: ComponentDef = {
  type: "link",
  category: "input",
  description: "Pressable text for a secondary action, lighter than a button.",
  text: { description: "The link text.", required: true },
  props: {
    on: { type: "action", required: true, description: "What happens when pressed, e.g. emit:size_guide." },
  },
  example: `link "Size guide" on=emit:size_guide`,
  semantics(box, ctx) {
    return { role: "link", name: ctx.props(box.node).text() };
  },
  layout(box, ctx) {
    box.h = Math.round(ctx.theme.text.body * 1.35);
  },
  minWidth: (node, ctx) => Math.min(120, textWidth(ctx, ctx.props(node).text(), 600, ctx.theme.text.body)),
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    g.font = ctx.font(600, theme.text.body);
    const label = fitText(g, p.text(), box.w);
    const w = Math.min(box.w, g.measureText(label).width);
    g.fillStyle = theme.colors.accent;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(label, box.x, box.y + box.h / 2 + 1);
    if (ctx.isHovered(box.node)) g.fillRect(box.x, box.y + box.h - 3, w, 1.5);
    ctx.addHit(partBox(box, box.x, box.y, w, box.h));
  },
};

const THUMB_R = 9, TRACK_H = 4, SLIDER_AREA = 32;

/** A slider's range and current value, read the same way when painting, dragging and on keys. */
function sliderState(p: PropReader) {
  const min = p.num("min", 0);
  const max = Math.max(min, p.num("max", 100));
  const step = Math.abs(p.num("step", 1)) || 1;
  const raw = toNumber(p.bound());
  const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min;
  return { min, max, step, value };
}

/** Snap to the nearest step from min, keep within range, and drop float noise. */
function snap(v: number, min: number, max: number, step: number): number {
  const stepped = min + Math.round((v - min) / step) * step;
  return Math.round(Math.min(max, Math.max(min, stepped)) * 1e6) / 1e6;
}

/** Where the thumb's centre may travel: inset by its radius so it never pokes out. */
function travel(box: Box) {
  return { left: box.x + THUMB_R, width: Math.max(1, box.w - THUMB_R * 2) };
}

export const slider: ComponentDef = {
  type: "slider",
  category: "input",
  description: "Picks a number in a range by dragging a handle, or with the arrow keys. Good for prices, distances and amounts.",
  text: { description: "An optional label above the slider. Show the value with an {expression}." },
  props: {
    bind: { type: "state", required: true, description: "The number state this slider reads and writes." },
    min: { type: "number", default: 0, description: "Smallest value (default 0)." },
    max: { type: "number", default: 100, description: "Largest value (default 100)." },
    step: { type: "number", default: 1, description: "The value moves in steps of this size (default 1)." },
    on: onProp("after the user lets go, or after each arrow key"),
  },
  example: `state maxPrice=120
slider "Up to \${maxPrice}" bind=maxPrice min=20 max=300 step=10`,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const { min, max, value } = sliderState(p);
    return { role: "slider", name: p.text() || ctx.textBefore(), value: { now: value, min, max }, detail: "track" };
  },
  layout(box, ctx) {
    const l = labelLines(ctx, ctx.props(box.node).text(), box.w, 2);
    box.data = l;
    box.h = (l.lines.length ? l.lines.length * l.lh + 4 : 0) + SLIDER_AREA;
  },
  minWidth: () => 120,
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const { min, max, value } = sliderState(p);
    const l = box.data as { lines: string[]; lh: number };
    let y = box.y;
    if (l.lines.length) {
      g.font = ctx.font(400, theme.text.body);
      g.fillStyle = c.ink;
      g.textAlign = "left";
      g.textBaseline = "middle";
      for (const line of l.lines) { g.fillText(line, box.x, y + l.lh / 2 + 1); y += l.lh; }
      y += 4;
    }
    const area = partBox(box, box.x, y, box.w, SLIDER_AREA);
    const { left, width } = travel(area);
    const frac = max > min ? (value - min) / (max - min) : 0;
    const cx = left + frac * width, cy = y + SLIDER_AREA / 2;
    ctx.roundRect(box.x, cy - TRACK_H / 2, box.w, TRACK_H, TRACK_H / 2);
    fillTint(g, c.ink, 0.12);
    ctx.roundRect(box.x, cy - TRACK_H / 2, Math.max(TRACK_H, cx - box.x), TRACK_H, TRACK_H / 2);
    g.fillStyle = c.accent;
    g.fill();
    const active = ctx.tween(box.node, "slider:active", ctx.isPressed(box.node) || ctx.isHovered(box.node) ? 1 : 0, MOTION.hover);
    if (active > 0) {
      g.beginPath();
      g.arc(cx, cy, THUMB_R + 5 * active, 0, Math.PI * 2);
      fillTint(g, c.accent, 0.16 * active);
    }
    // A light knob with a close shadow and an accent rim, like the switch's.
    g.beginPath();
    g.arc(cx, cy, THUMB_R, 0, Math.PI * 2);
    g.save();
    g.shadowColor = c.shadow;
    g.shadowBlur = 4;
    g.shadowOffsetY = 1;
    g.fillStyle = isDarkTheme(theme) ? c.ink : c.surface;
    g.fill();
    g.restore();
    g.strokeStyle = c.accent;
    g.lineWidth = 1.5;
    g.stroke();
    ctx.addHit(area, { detail: "track" });
  },
  cursor: () => "grab",
  drag(ctx) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return;
    const { min, max, step, value } = sliderState(p);
    const { left, width } = travel(ctx.target.box);
    const frac = Math.min(1, Math.max(0, (ctx.x - left) / width));
    const next = snap(min + frac * (max - min), min, max, step);
    if (next !== value) ctx.set(key, next);
    if (ctx.phase === "end") runOn(ctx);
  },
  key(ctx, k) {
    const p = ctx.props(ctx.target.node);
    const key = p.raw("bind");
    if (!key) return false;
    const { min, max, step, value } = sliderState(p);
    const big = Math.max(step, snap((max - min) / 10, 0, Infinity, step));
    const moves: Record<string, number> = {
      ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step,
      PageUp: value + big, PageDown: value - big, Home: min, End: max,
    };
    if (!(k in moves)) return false;
    ctx.set(key, snap(moves[k]!, min, max, step));
    runOn(ctx);
    return true;
  },
};

/** Field text size: at least 16 px, or phones zoom the page when the field is focused. */
/**
 * Fill and outline a field whose path is current: an inset surface with a hairline border that
 * firms up under the pointer, and an accent border with a soft halo while it's being typed in.
 * Shared by input, select and date-picker so every field looks the same.
 */
export function paintField(g: CanvasRenderingContext2D, c: Theme["colors"], active: boolean | number, hot: boolean | number): void {
  // Numeric progress lets input, select and date-picker share one soft focus
  // transition, while callers without animation keep boolean compatibility.
  const focus = Math.min(1, Math.max(0, Number(active)));
  const hover = Math.min(1, Math.max(0, Number(hot)));
  g.fillStyle = c.surface;
  g.fill();
  g.save();
  g.strokeStyle = c.control;
  g.lineWidth = 1;
  g.stroke();
  if (hover > 0) {
    g.save();
    g.globalAlpha *= hover * 0.26;
    g.strokeStyle = c.ink;
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }
  if (focus > 0) {
    g.save();
    g.globalAlpha *= 0.18 * focus;
    g.strokeStyle = c.accent;
    g.lineWidth = 6;
    g.stroke();
    g.restore();
    g.save();
    g.globalAlpha *= focus;
    g.strokeStyle = c.accent;
    g.lineWidth = 1.35;
    g.stroke();
    g.restore();
  }
  g.restore();
}

/** 16px keeps phones from zooming in when the typing field opens over it. */
export const FIELD_TEXT = 16;
export const FIELD_PAD = 12;
export const LABEL_SIZE = 13;
const LABEL_GAP = 6;

/** The field's box, under its label if it has one. */
export function fieldBox(box: Box, p: PropReader, controlHeight: number): Box {
  const top = p.text() ? LABEL_SIZE + 4 + LABEL_GAP : 0;
  return partBox(box, box.x, box.y + top, box.w, controlHeight);
}

/** The bound value as text for editing: numbers plainly, nothing for null. */
function fieldValue(p: PropReader): string {
  const v = p.bound();
  return v === undefined || v === null ? "" : typeof v === "object" ? "" : String(v);
}

/** Cut text to fit a width, ending with an ellipsis. */
export function fitText(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

export const input: ComponentDef = {
  type: "input",
  category: "input",
  description: "A text field people type into, such as a name, an email, a search or a new item. Each keystroke writes its bind= state.",
  text: { description: "The label above the field. Leave it out only when the screen makes the purpose obvious." },
  props: {
    bind: { type: "state", required: true, description: "The state name or path it reads and writes, like task or t.title." },
    placeholder: { type: "string", description: "A hint shown while the field is empty, like e.g. Sunscreen." },
    kind: { type: "enum", values: INPUT_KINDS, default: "text", description: "text, email, number, password or search. Picks the phone keyboard and autofill; number writes a number, or null while empty." },
    on: onProp("when Enter is pressed, after the value is written"),
    disabled: { type: "condition", description: "Expression; when true the field is greyed out and can't be typed in." },
    max: { type: "number", default: 500, description: "Longest value in characters (at most 10000)." },
  },
  example: `state task="" todos=[]
input "New item" bind=task placeholder="e.g. Sunscreen" on="add:todos:{task};set:task:''"
text "{plural(len(todos), 'item')}" tone=muted`,
  minWidth: () => 120,
  semantics(box, ctx) {
    const p = ctx.props(box.node);
    const kind = p.str("kind", "text");
    const placeholder = p.str("placeholder") || undefined;
    const typed = fieldValue(p);
    return {
      role: kind === "search" ? "searchbox" : "textbox",
      name: p.text() || ctx.textBefore() || placeholder,
      placeholder,
      // A password's characters are never read out.
      value: kind === "password" || !typed ? undefined : { text: typed },
      disabled: p.cond("disabled") || undefined,
    };
  },
  layout(box, ctx) {
    const p = ctx.props(box.node);
    box.h = fieldBox(box, p, ctx.theme.control.height).y - box.y + ctx.theme.control.height;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const disabled = p.cond("disabled");
    const field = fieldBox(box, p, theme.control.height);
    const editing = ctx.isEditing(box.node);
    const hot = !disabled && ctx.isHovered(box.node);
    g.save();
    if (disabled) g.globalAlpha *= 0.45;
    const label = p.text();
    if (label) {
      g.font = ctx.font(600, LABEL_SIZE);
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = c.ink;
      g.fillText(fitText(g, label, box.w), box.x, box.y);
    }
    ctx.roundRect(field.x + 0.5, field.y + 0.5, field.w - 1, field.h - 1, theme.radius.md);
    const focus = ctx.tween(box.node, "field:focus", !disabled && (editing || ctx.isFocused(box.node)) ? 1 : 0, MOTION.selection);
    const hover = ctx.tween(box.node, "field:hover", hot ? 1 : 0, MOTION.hover);
    paintField(g, c, focus, hover);
    if (!editing) {
      const value = fieldValue(p);
      const kind = p.oneOf("kind", INPUT_KINDS, "text");
      const shown = value ? (kind === "password" ? "•".repeat(value.length) : value) : p.str("placeholder");
      g.font = ctx.font(400, FIELD_TEXT);
      g.textBaseline = "middle";
      g.fillStyle = value ? c.ink : c.muted;
      if (!value) g.globalAlpha *= 0.8;
      g.fillText(fitText(g, shown, field.w - FIELD_PAD * 2), field.x + FIELD_PAD, field.y + field.h / 2 + 1);
    }
    g.restore();
    if (!disabled) ctx.addHit(field);
  },
  editor(box, p, theme) {
    const field = fieldBox(box, p, theme.control.height);
    const max = Math.min(10_000, Math.max(1, Math.round(p.num("max", 500))));
    return {
      rect: { x: field.x + FIELD_PAD, y: field.y + 1, w: Math.max(0, field.w - FIELD_PAD * 2), h: field.h - 2 },
      font: themeFont(theme, 400, FIELD_TEXT),
      color: theme.colors.ink,
      accent: theme.colors.accent,
      muted: theme.colors.muted,
      kind: p.oneOf("kind", INPUT_KINDS, "text"),
      value: fieldValue(p).slice(0, max),
      placeholder: p.str("placeholder"),
      label: p.text() || p.str("placeholder"),
      max,
    };
  },
  cursor: () => "text",
};
