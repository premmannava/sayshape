/** Floating legends, drawn exclusively with the active SayShape theme. */
import type { Box } from "../../types";
import type { Theme } from "../../theme";
import { bubbleRadius, formatMapValue } from "./analytics";
import { choroplethStops } from "./visual";

function panel(g: CanvasRenderingContext2D, box: Box, theme: Theme, height: number):
  { x: number; y: number; w: number } | null {
  if (box.w < 180 || box.h < height + 16) return null;
  const w = Math.min(202, box.w - 16);
  const x = box.x + 8, y = box.y + box.h - height - 8;
  const c = theme.colors;
  g.save();
  g.shadowColor = c.shadow;
  g.shadowBlur = 12;
  g.shadowOffsetY = 2;
  g.beginPath();
  g.roundRect(x, y, w, height, 9);
  g.fillStyle = c.raised;
  g.fill();
  g.restore();
  g.beginPath();
  g.roundRect(x, y, w, height, 9);
  g.strokeStyle = c.line;
  g.lineWidth = 0.8;
  g.globalAlpha = 0.7;
  g.stroke();
  g.globalAlpha = 1;
  return { x, y, w };
}

const short = (label: string) => label.length > 26 ? label.slice(0, 25) + "…" : label;

export function drawChoroplethLegend(
  g: CanvasRenderingContext2D, box: Box, theme: Theme, title: string, min: number, max: number,
): void {
  g.save();
  const p = panel(g, box, theme, 74);
  if (!p) { g.restore(); return; }
  const { x, y, w } = p, c = theme.colors;
  g.fillStyle = c.ink;
  g.font = "600 12px " + theme.font.family;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(short(title), x + 12, y + 17, w - 24);

  const [low, middle, high] = choroplethStops(theme);
  const grad = g.createLinearGradient(x + 12, y + 34, x + w - 12, y + 34);
  grad.addColorStop(0, low);
  grad.addColorStop(0.5, middle);
  grad.addColorStop(1, high);
  g.beginPath();
  g.roundRect(x + 12, y + 32, w - 24, 10, 4);
  g.fillStyle = grad;
  g.fill();
  g.font = "500 11px " + theme.font.family;
  g.fillStyle = c.muted;
  g.textBaseline = "middle";
  g.fillText(formatMapValue(min), x + 12, y + 59);
  g.textAlign = "right";
  g.fillText(formatMapValue(max), x + w - 12, y + 59);
  g.restore();
}

export function drawBubbleLegend(
  g: CanvasRenderingContext2D, box: Box, theme: Theme, title: string, min: number, max: number,
): void {
  g.save();
  const p = panel(g, box, theme, 94);
  if (!p) { g.restore(); return; }
  const { x, y, w } = p, c = theme.colors;
  g.fillStyle = c.ink;
  g.font = "600 12px " + theme.font.family;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(short(title), x + 12, y + 16, w - 24);
  const values = [min, (min + max) / 2, max];
  const positions = [x + 36, x + w / 2, x + w - 36];
  for (let i = 0; i < values.length; i++) {
    const px = positions[i]!, radius = bubbleRadius(values[i]!, min, max);
    const py = y + 53 - radius / 2;
    g.beginPath();
    g.arc(px, py, radius, 0, Math.PI * 2);
    g.globalAlpha = 0.76;
    g.fillStyle = c.accent;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = c.raised;
    g.lineWidth = 1.7;
    g.stroke();
    g.font = "500 10px " + theme.font.family;
    g.fillStyle = c.ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(formatMapValue(values[i]!), px, y + 82);
  }
  g.restore();
}
