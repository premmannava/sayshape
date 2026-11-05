/** Compact, view-fixed Canvas legends. Nothing here is a separate DOM overlay. */
import type { Box } from "../../types";
import type { Theme } from "../../theme";
import { bubbleRadius, formatMapValue, mixedColor } from "./analytics";

function shell(g: CanvasRenderingContext2D, box: Box, theme: Theme, height: number): { x: number; y: number; w: number } | null {
  if (box.w < 180 || box.h < height + 16) return null;
  const w = Math.min(216, box.w - 16);
  const x = box.x + 8, y = box.y + box.h - height - 8;
  g.beginPath();
  g.roundRect?.(x, y, w, height, 8);
  g.fillStyle = theme.colors.raised;
  g.fill();
  g.strokeStyle = theme.colors.line;
  g.lineWidth = 1;
  g.stroke();
  return { x, y, w };
}
const compactTitle = (label: string) => label.length > 26 ? label.slice(0, 25) + "…" : label;

export function drawChoroplethLegend(
  g: CanvasRenderingContext2D, box: Box, theme: Theme, title: string, min: number, max: number,
): void {
  g.save();
  const panel = shell(g, box, theme, 73);
  if (!panel) { g.restore(); return; }
  const { x, y, w } = panel;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = "600 12px " + theme.font.family;
  g.fillStyle = theme.colors.ink;
  g.fillText(compactTitle(title), x + 10, y + 14, w - 20);
  const grd = g.createLinearGradient(x + 10, y + 26, x + w - 10, y + 26);
  grd.addColorStop(0, mixedColor(theme.colors.land, theme.colors.accent, 0.15));
  grd.addColorStop(1, theme.colors.accent);
  g.fillStyle = grd;
  g.fillRect(x + 10, y + 27, w - 20, 12);
  g.font = "400 11px " + theme.font.family;
  g.fillStyle = theme.colors.muted;
  g.fillText(formatMapValue(min), x + 10, y + 57);
  g.textAlign = "right";
  g.fillText(formatMapValue(max), x + w - 10, y + 57);
  g.restore();
}

export function drawBubbleLegend(
  g: CanvasRenderingContext2D, box: Box, theme: Theme, title: string, min: number, max: number,
): void {
  g.save();
  const panel = shell(g, box, theme, 92);
  if (!panel) { g.restore(); return; }
  const { x, y, w } = panel;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillStyle = theme.colors.ink;
  g.font = "600 12px " + theme.font.family;
  g.fillText(compactTitle(title), x + 10, y + 14, w - 20);
  const values = [min, (min + max) / 2, max];
  // Fixed CSS-pixel radii match the bubbles drawn on the geographic map.
  const places = [x + 38, x + w / 2, x + w - 38];
  for (let i = 0; i < values.length; i++) {
    const radius = bubbleRadius(values[i]!, min, max);
    const px = places[i]!;
    const py = y + 54 - radius / 2;
    g.beginPath();
    g.arc(px, py, radius, 0, Math.PI * 2);
    g.fillStyle = mixedColor(theme.colors.raised, theme.colors.accent, 0.8);
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
    g.lineWidth = 1.5;
    g.strokeStyle = theme.colors.surface;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "400 10px " + theme.font.family;
    g.fillStyle = theme.colors.ink;
    g.fillText(formatMapValue(values[i]!), px, y + 80);
  }
  g.restore();
}
