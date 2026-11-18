/**
 * Line style for scene outlines: cap= and join= on line, path and polygon,
 * and round= on path and polygon, which rounds the corners between straight
 * segments (a metro map drawn with plain L segments, a soft-cornered badge).
 *
 * A rounded corner is cut back along both of its legs by the radius, clamped
 * to half of each leg so neighbouring corners never overlap, and the cut is
 * bridged by a quadratic curve with its control point at the corner (the way
 * a rect's rx= rounds). Curves and arcs are drawn as written; a corner next
 * to one stays sharp.
 */
import { tracePath, type Bounds, type PathSink } from "./path";

export const CAPS = ["butt", "round", "square"] as const;
export const JOINS = ["miter", "round", "bevel"] as const;

/** The elements that take cap= and join=. Every other outline keeps round ends and corners. */
export const STYLED: ReadonlySet<string> = new Set(["line", "path", "polygon"]);

/** A cap= value, or round (the default, as before cap= existed). */
export function capOf(v: unknown): CanvasLineCap {
  return typeof v === "string" && (CAPS as readonly string[]).includes(v) ? (v as CanvasLineCap) : "round";
}

/** A join= value, or round. */
export function joinOf(v: unknown): CanvasLineJoin {
  return typeof v === "string" && (JOINS as readonly string[]).includes(v) ? (v as CanvasLineJoin) : "round";
}

/** How far a corner of radius r is cut back along legs this long: at most half of either. */
export function cornerCut(r: number, lenIn: number, lenOut: number): number {
  if (!(r > 0) || !(lenIn > 0) || !(lenOut > 0)) return 0;
  return Math.min(r, lenIn / 2, lenOut / 2);
}

export type PathCommand =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "Q"; cx: number; cy: number; x: number; y: number }
  | { op: "Z" };

type Pt = readonly [number, number];

/** Consecutive repeats dropped (and, for a closed shape, a last point back on the first). */
function distinct(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0]!, z = out[out.length - 1]!;
    if (a[0] === z[0] && a[1] === z[1]) out.pop();
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The corner at b, between a and c: where the cut starts and ends, or null to keep it sharp. */
function corner(a: Pt, b: Pt, c: Pt, r: number): { from: Pt; to: Pt } | null {
  const lenIn = dist(a, b), lenOut = dist(b, c);
  const k = cornerCut(r, lenIn, lenOut);
  if (k <= 0) return null;
  return {
    from: [b[0] + ((a[0] - b[0]) * k) / lenIn, b[1] + ((a[1] - b[1]) * k) / lenIn],
    to: [b[0] + ((c[0] - b[0]) * k) / lenOut, b[1] + ((c[1] - b[1]) * k) / lenOut],
  };
}

/**
 * Drawing commands for straight segments through pts with every corner rounded
 * by r. A closed shape rounds every corner, the one where it closes too.
 * Fewer than three points, or r of 0, stays straight.
 */
export function roundPolyline(input: readonly Pt[], closed: boolean, r: number): PathCommand[] {
  const pts = distinct(input, closed);
  const n = pts.length;
  if (!n) return [];
  const out: PathCommand[] = [];
  const at = (i: number) => pts[((i % n) + n) % n]!;
  if (n < 3 || !(r > 0)) {
    out.push({ op: "M", x: pts[0]![0], y: pts[0]![1] });
    for (const p of pts.slice(1)) out.push({ op: "L", x: p[0], y: p[1] });
    if (closed) out.push({ op: "Z" });
    return out;
  }
  const turn = (i: number) => {
    const c = corner(at(i - 1), at(i), at(i + 1), r);
    if (!c) { out.push({ op: "L", x: at(i)[0], y: at(i)[1] }); return; }
    out.push({ op: "L", x: c.from[0], y: c.from[1] });
    out.push({ op: "Q", cx: at(i)[0], cy: at(i)[1], x: c.to[0], y: c.to[1] });
  };
  if (!closed) {
    out.push({ op: "M", x: pts[0]![0], y: pts[0]![1] });
    for (let i = 1; i < n - 1; i++) turn(i);
    out.push({ op: "L", x: pts[n - 1]![0], y: pts[n - 1]![1] });
    return out;
  }
  // Closed: start just past the first corner and come back round to it.
  const first = corner(at(-1), at(0), at(1), r);
  const start = first ? first.to : at(0);
  out.push({ op: "M", x: start[0], y: start[1] });
  for (let i = 1; i < n; i++) turn(i);
  if (first) {
    out.push({ op: "L", x: first.from[0], y: first.from[1] });
    out.push({ op: "Q", cx: at(0)[0], cy: at(0)[1], x: first.to[0], y: first.to[1] });
  }
  out.push({ op: "Z" });
  return out;
}

/** Send commands to a canvas or any other sink. */
export function drawCommands(cmds: readonly PathCommand[], sink: PathSink): void {
  for (const c of cmds) {
    if (c.op === "M") sink.moveTo(c.x, c.y);
    else if (c.op === "L") sink.lineTo(c.x, c.y);
    else if (c.op === "Q") sink.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    else sink.closePath();
  }
}

/**
 * A sink that rounds the corners of the straight runs drawn through it with
 * radius r and passes curves and arcs through as they are. Call end() after
 * the last command, to draw the run still being collected.
 */
export function roundingSink(sink: PathSink, r: number): PathSink & { end(): void } {
  // The straight run being collected. `joined`: it starts where a curve ended,
  // so the pen is already at its first point and its first corner stays sharp.
  let run: Pt[] = [];
  let joined = false;
  let started = false;
  let start: Pt = [0, 0];
  let pen: Pt = [0, 0];

  const flush = () => {
    if (run.length) {
      const cmds = roundPolyline(run, false, r);
      drawCommands(joined ? cmds.slice(1) : cmds, sink);
    }
    run = [];
  };
  const beforeCurve = () => {
    if (run.length) flush();
    else if (started) sink.moveTo(pen[0], pen[1]); // after a close, which may have ended off the corner
  };
  const afterCurve = (x: number, y: number) => { pen = [x, y]; run = [pen]; joined = true; started = true; };
  const moveTo = (x: number, y: number) => { flush(); pen = start = [x, y]; run = [pen]; joined = false; started = true; };

  return {
    moveTo,
    lineTo(x, y) {
      if (!started) { moveTo(x, y); return; } // as a canvas does with no current point
      if (!run.length) { run = [pen]; joined = false; }
      pen = [x, y];
      run.push(pen);
    },
    quadraticCurveTo(a, b, x, y) { beforeCurve(); sink.quadraticCurveTo(a, b, x, y); afterCurve(x, y); },
    bezierCurveTo(a, b, c, d, x, y) { beforeCurve(); sink.bezierCurveTo(a, b, c, d, x, y); afterCurve(x, y); },
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) {
      beforeCurve();
      sink.ellipse(cx, cy, rx, ry, rot, a0, a1, ccw);
      const ex = rx * Math.cos(a1), ey = ry * Math.sin(a1);
      afterCurve(cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot));
    },
    closePath() {
      if (run.length && !joined) drawCommands(roundPolyline(run, true, r), sink);
      else {
        // The closing line is straight too: round the corner where it leaves the run.
        if (run.length > 1) run.push(start);
        flush();
        sink.closePath();
      }
      // After a close the pen is back where the subpath started; the next run starts there.
      run = [];
      pen = start;
    },
    end: flush,
  };
}

/** Trace path data into sink with its straight corners rounded by r. Bounds are tracePath's. */
export function traceRounded(d: string, sink: PathSink, r: number): Bounds | null {
  const s = roundingSink(sink, r);
  const b = tracePath(d, s);
  s.end();
  return b;
}
