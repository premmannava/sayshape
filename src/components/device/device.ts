/**
 * device: a phone or laptop frame with a screen, for app and page mockups.
 *
 * Like a slide, a device lays its children out at a fixed size of its own
 * (the device's logical screen, DEVICE_SIZES) and draws them scaled down to
 * fit its space (ComponentDef.childTransform), so a phone screen wraps text
 * and stacks elements as a real phone would, whatever the page's width. The
 * engine paints, hit-tests, focuses and reads the children through the
 * transform; the device itself adds no hits. Content taller than the screen
 * is cut at the screen's edge (clipChildren), with a warning: a device shows
 * one screen.
 */
import type { ChildTransform, ComponentDef, LayoutContext } from "../../component";
import type { Box, Rect } from "../../types";
import { paintFrame, paintStatus, STATUS_TIME } from "./frame";
import { DEVICE_KINDS, DEVICE_SIZES, MIN_DEVICE_SCALE, type DeviceSize } from "./sizes";

export interface DeviceData {
  [key: string]: unknown;
  size: DeviceSize;
  /** Screen pixels per device pixel. */
  scale: number;
  status: boolean;
  /** The screen, on the page. */
  screen: Rect;
  transform: ChildTransform;
  /** The children's height as laid out, and the room the screen had for them, in device pixels. */
  content: number;
  room: number;
  clipped: boolean;
}

export const deviceData = (b: Box): DeviceData | undefined => b.data as DeviceData | undefined;

/** The share of its real size a device is drawn at, at most: scale= kept to MIN_DEVICE_SCALE..1. */
export function deviceScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(1, Math.max(MIN_DEVICE_SCALE, scale)) : 1;
}

function layoutChildren(box: Box, ctx: LayoutContext, x: number, y: number, w: number, gap: number): number {
  let at = y;
  const kids = ctx.visibleChildren(box.node);
  kids.forEach((k, i) => {
    const kb = ctx.layout(k, x, at, w);
    box.children.push(kb);
    at += kb.h + (i < kids.length - 1 ? gap : 0);
  });
  return kids.length ? at - y : 0;
}

const isPhone = (b: Box) => deviceData(b)?.size.phone ?? b.node.props.kind !== "laptop";

export const device: ComponentDef = {
  type: "device",
  category: "layout",
  description: "EXPERIMENTAL: a plain phone or laptop frame with a screen, for showing what an app or page looks like on it. Write the screen's elements under it as usual; they're laid out at the device's real screen size and the whole frame is drawn scaled to fit, so keep it to one screen.",
  text: { description: "What the screen shows, read to screen readers, e.g. Weather app home screen. Not drawn." },
  props: {
    kind: { type: "enum", values: DEVICE_KINDS, default: "iphone", description: "The device the screen sits in: iphone (393 by 852), android (412 by 915) or laptop (1440 by 900). Its children are laid out at that size." },
    scale: { type: "number", default: 1, description: "The largest it's drawn, as a share of its real size, from 0.1 to 1 (scale=0.5 is half size). It never draws wider than its space." },
    status: { type: "boolean", default: false, description: "true draws a plain status bar across the top of the screen: a time, signal and battery." },
  },
  children: "any",
  picks: [
    { for: "a phone or app screen mockup", write: "device kind=iphone" },
    { for: "a desktop web page mockup", write: "device kind=laptop" },
  ],
  example: `device "Weather app home" kind=iphone status=true
  text "Today" style=title
  stat label="Phoenix" value="31°"
  button "See the week"`,
  check(props) {
    const n = props.scale === undefined || props.scale.startsWith("{") ? NaN : Number(props.scale);
    if (Number.isFinite(n) && (n < MIN_DEVICE_SCALE || n > 1)) return [`scale= goes from ${MIN_DEVICE_SCALE} to 1, so scale=${props.scale} is drawn at ${deviceScale(n)}. Write a share of the real size, like scale=0.5`];
    return [];
  },
  minWidth: () => 160,
  layout(box, ctx) {
    const p = ctx.props(box.node);
    const t = ctx.theme;
    const size = DEVICE_SIZES[p.oneOf("kind", DEVICE_KINDS, "iphone")];
    const status = p.bool("status", false);
    // As large as scale= lets it, never wider than its space; centred across that space.
    const s = Math.max(0, Math.min(box.w / size.frameW, deviceScale(p.num("scale", 1))));
    box.x += (box.w - size.frameW * s) / 2;
    box.w = size.frameW * s;
    box.h = size.frameH * s;
    // Laid out at device size from the device's own top left, like a slide's children.
    const screenX = box.x + size.lidX + size.bezel;
    const screenY = box.y + size.bezel;
    const pad = t.space.md;
    const top = (status ? size.statusH : size.top) + (status || size.top ? t.space.sm : pad);
    const room = Math.max(0, size.screenH - top - size.bottom - pad);
    box.children.length = 0;
    const content = layoutChildren(box, ctx, screenX + pad, screenY + top, size.screenW - pad * 2, pad);
    const clipped = content > room + 0.5;
    if (clipped) {
      const name = p.text().trim();
      ctx.warn?.(`device ${name ? `"${name}" ` : ""}on line ${box.node.line} has more than fits on one ${size.phone ? "phone" : "laptop"} screen, so its bottom is cut off. Keep a device to one screen: fewer or shorter elements`);
    }
    const transform: ChildTransform = { scale: s, dx: box.x * (1 - s), dy: box.y * (1 - s) };
    const data: DeviceData = {
      size, scale: s, status, transform, content, room, clipped,
      screen: { x: box.x + (size.lidX + size.bezel) * s, y: box.y + size.bezel * s, w: size.screenW * s, h: size.screenH * s },
    };
    box.data = data;
  },
  childTransform: (box) => deviceData(box)?.transform ?? null,
  // The screen is the window its content shows through.
  clipChildren: (box) => deviceData(box)?.screen ?? null,
  semantics(box, ctx) {
    const phone = isPhone(box);
    const name = ctx.text(box.node) || (phone ? "Phone screen" : "Laptop screen");
    return { role: "group", roleDescription: phone ? "phone mockup" : "laptop mockup", name };
  },
  paint(box, ctx) {
    const d = deviceData(box);
    if (!d || d.scale <= 0) return;
    const { g } = ctx;
    const s = d.scale;
    g.save();
    // Drawn at device size, scaled about the device's top left like its children.
    g.transform(s, 0, 0, s, box.x * (1 - s), box.y * (1 - s));
    paintFrame(ctx, d.size, box.x, box.y, s);
    if (d.status) paintStatus(ctx, d.size, box.x, box.y, STATUS_TIME);
    g.restore();
  },
};
