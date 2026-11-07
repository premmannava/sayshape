/**
 * SVG path data (d="M10 10 L50 80 Q90 20 130 80 Z") drawn with plain canvas
 * calls, so it works on any 2D context, including the recording one in
 * sayshape/testing (Node has no Path2D). Supports every SVG path command:
 * M L H V C S Q T A Z, absolute and relative.
 *
 * Never throws: a malformed path draws as far as it makes sense and stops.
 */

/** The most commands one path draws, so a runaway formula can't stall a frame. */
export const MAX_PATH_COMMANDS = 2000;

/** The parts of a canvas context a path needs. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
  quadraticCurveTo(a: number, b: number, x: number, y: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw?: boolean): void;
  closePath(): void;
}

export interface Bounds { x: number; y: number; w: number; h: number }

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function tokens(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** Trace the path into sink. Returns the points it passes through and its control points' bounds. */
export function tracePath(d: string, sink: PathSink): Bounds | null {
  const tk = tokens(d);
  let i = 0, cmd = "", count = 0;
  let x = 0, y = 0, sx = 0, sy = 0;
  // The last control point, for S and T, which reflect it.
  let cx = 0, cy = 0, prev = "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (px: number, py: number) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); };

  while (i < tk.length && count < MAX_PATH_COMMANDS) {
    if (typeof tk[i] === "string") cmd = tk[i++] as string;
    else if (!cmd) break; // numbers before any command
    const lower = cmd.toLowerCase();
    const need = ARGS[lower] ?? 0;
    const a: number[] = [];
    for (let k = 0; k < need; k++) {
      const v = tk[i];
      if (typeof v !== "number" || !Number.isFinite(v)) return finish();
      a.push(v);
      i++;
    }
    const rel = cmd !== cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    count++;
    switch (lower) {
      case "m":
        x = ox + a[0]!; y = oy + a[1]!; sx = x; sy = y;
        sink.moveTo(x, y); see(x, y);
        // Pairs after a move are lines.
        cmd = rel ? "l" : "L";
        break;
      case "l": x = ox + a[0]!; y = oy + a[1]!; sink.lineTo(x, y); see(x, y); break;
      case "h": x = (rel ? x : 0) + a[0]!; sink.lineTo(x, y); see(x, y); break;
      case "v": y = (rel ? y : 0) + a[0]!; sink.lineTo(x, y); see(x, y); break;
      case "c": {
        const x1 = ox + a[0]!, y1 = oy + a[1]!, x2 = ox + a[2]!, y2 = oy + a[3]!;
        x = ox + a[4]!; y = oy + a[5]!;
        sink.bezierCurveTo(x1, y1, x2, y2, x, y); see(x1, y1); see(x2, y2); see(x, y);
        cx = x2; cy = y2;
        break;
      }
      case "s": {
        const smooth = prev === "c" || prev === "s";
        const x1 = smooth ? 2 * x - cx : x, y1 = smooth ? 2 * y - cy : y;
        const x2 = ox + a[0]!, y2 = oy + a[1]!;
        x = ox + a[2]!; y = oy + a[3]!;
        sink.bezierCurveTo(x1, y1, x2, y2, x, y); see(x1, y1); see(x2, y2); see(x, y);
        cx = x2; cy = y2;
        break;
      }
      case "q": {
        const x1 = ox + a[0]!, y1 = oy + a[1]!;
        x = ox + a[2]!; y = oy + a[3]!;
        sink.quadraticCurveTo(x1, y1, x, y); see(x1, y1); see(x, y);
        cx = x1; cy = y1;
        break;
      }
      case "t": {
        const smooth = prev === "q" || prev === "t";
        const x1 = smooth ? 2 * x - cx : x, y1 = smooth ? 2 * y - cy : y;
        x = ox + a[0]!; y = oy + a[1]!;
        sink.quadraticCurveTo(x1, y1, x, y); see(x1, y1); see(x, y);
        cx = x1; cy = y1;
        break;
      }
      case "a": {
        const ex = ox + a[5]!, ey = oy + a[6]!;
        arc(sink, x, y, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, ex, ey, see);
        x = ex; y = ey;
        break;
      }
      case "z": sink.closePath(); x = sx; y = sy; break;
    }
    prev = lower;
  }
  return finish();

  function finish(): Bounds | null {
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }
}

/** An SVG elliptical arc, from its endpoints to a canvas ellipse (SVG spec, appendix F.6). */
function arc(sink: PathSink, x1: number, y1: number, rxIn: number, ryIn: number, deg: number, large: boolean, sweep: boolean, x2: number, y2: number, see: (x: number, y: number) => void): void {
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) { sink.lineTo(x2, y2); see(x2, y2); return; }
  const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  sink.ellipse(cx, cy, rx, ry, phi, start, start + delta, !sweep);
  see(cx - rx, cy - ry); see(cx + rx, cy + ry);
}

/** "10,20 30,40" as numbers in pairs, at most MAX_PATH_COMMANDS points. */
export function points(text: string): Array<[number, number]> {
  const nums = (text.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length && out.length < MAX_PATH_COMMANDS; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}
