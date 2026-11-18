/**
 * Drawing a device's frame and status bar. Both are plain shapes in theme
 * colors only: a rounded body, the screen inset in surface, a camera, and for
 * a laptop a base under the lid. Nothing is copied from a real product (no
 * logos, buttons, notches or speaker grilles of a brand); they're generic
 * outlines anyone would recognise as a phone or a laptop.
 *
 * Everything here is drawn in device pixels, from the frame's top left, with
 * the canvas already scaled by the device (see device.ts).
 */
import type { PaintContext } from "../../component";
import { isDarkTheme } from "../../theme";
import type { DeviceSize } from "./sizes";

/** The time a status bar shows: a neutral one, the same every time, so pictures of it don't change. */
export const STATUS_TIME = "12:00";

/** The body's color: dark on a light page, a lighter grey on a dark one, so the frame stands out from the page either way. */
const bodyColor = (ctx: PaintContext) => (isDarkTheme(ctx.theme) ? ctx.theme.colors.line : ctx.theme.colors.ink);

/** The frame (body, screen, camera, a phone's home bar or a laptop's base), drawn before the screen's content. */
export function paintFrame(ctx: PaintContext, size: DeviceSize, x: number, y: number, s: number): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const body = bodyColor(ctx);
  const lid = { x: x + size.lidX, y, w: size.screenW + size.bezel * 2, h: size.screenH + size.bezel * 2 };
  const screen = { x: lid.x + size.bezel, y: lid.y + size.bezel, w: size.screenW, h: size.screenH };
  // The body, outlined so it reads against a page of nearly its own color.
  ctx.roundRect(lid.x, lid.y, lid.w, lid.h, size.phone ? theme.radius.lg * 4 : theme.radius.md);
  g.fillStyle = body;
  g.fill();
  g.lineWidth = 1 / s;
  g.strokeStyle = c.control;
  g.stroke();
  // The screen.
  ctx.roundRect(screen.x, screen.y, screen.w, screen.h, size.phone ? theme.radius.lg * 3 : 0);
  g.fillStyle = c.surface;
  g.fill();
  if (size.kind === "iphone") {
    // A pill at the top of the screen, in the body's color.
    const w = 120, h = 34;
    ctx.roundRect(screen.x + (screen.w - w) / 2, screen.y + 10, w, h, h / 2);
    g.fillStyle = body;
    g.fill();
  } else if (size.kind === "android") {
    // A round camera at the top middle of the screen.
    dot(ctx, screen.x + screen.w / 2, screen.y + 18, 7, body);
  } else {
    // A camera in the lid's top bezel, and the base the lid stands on, with a notch to open it by.
    dot(ctx, lid.x + lid.w / 2, lid.y + size.bezel / 2, 4, c.control);
    const base = { x, y: lid.y + lid.h, w: size.frameW, h: size.baseH };
    ctx.roundRect(base.x, base.y, base.w, base.h, theme.radius.sm);
    g.fillStyle = c.line;
    g.fill();
    g.strokeStyle = c.control;
    g.stroke();
    const notch = lid.w / 6;
    ctx.roundRect(base.x + (base.w - notch) / 2, base.y, notch, size.baseH / 3, theme.radius.sm);
    g.fillStyle = c.control;
    g.fill();
  }
  if (size.phone) {
    // The bar a person swipes up on, at the bottom of the screen.
    const w = 134, h = 5;
    ctx.roundRect(screen.x + (screen.w - w) / 2, screen.y + screen.h - size.bottom / 2 - h / 2, w, h, h / 2);
    g.fillStyle = c.muted;
    g.fill();
  }
}

/** A plain status bar across the top of the screen: the time on the left, signal and battery on the right. */
export function paintStatus(ctx: PaintContext, size: DeviceSize, x: number, y: number, time: string): void {
  const { g, theme } = ctx;
  const c = theme.colors;
  const top = y + size.bezel;
  const mid = top + size.statusH / 2;
  const left = x + size.lidX + size.bezel + size.statusPad;
  const right = x + size.lidX + size.bezel + size.screenW - size.statusPad;
  g.fillStyle = c.ink;
  g.font = ctx.font(600, theme.text.caption);
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(time, left, mid);
  // Battery: an outline, its nub, and a fill most of the way.
  const bw = 22, bh = 11;
  const bx = right - bw - 2;
  ctx.roundRect(bx, mid - bh / 2, bw, bh, 3);
  g.lineWidth = 1;
  g.strokeStyle = c.ink;
  g.stroke();
  g.fillStyle = c.ink;
  g.fillRect(bx + bw, mid - 2, 2, 4);
  g.fillRect(bx + 2, mid - bh / 2 + 2, (bw - 4) * 0.7, bh - 4);
  // Signal: four bars, rising.
  const barW = 3, gap = 2;
  const sx = bx - theme.space.sm - (barW * 4 + gap * 3);
  for (let i = 0; i < 4; i++) {
    const h = 4 + i * 2;
    g.fillRect(sx + i * (barW + gap), mid + 5 - h, barW, h);
  }
}

function dot(ctx: PaintContext, cx: number, cy: number, r: number, color: string): void {
  const { g } = ctx;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
}
