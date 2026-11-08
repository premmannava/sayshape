/**
 * chart kind=sankey: how amounts flow from where they start to where they
 * end up, as bands between columns of nodes, each band as thick as its
 * amount: budget to departments to projects, visitors from channels to
 * pages to sign-ups, energy from sources to uses.
 *
 *   chart "Where the money went" kind=sankey items=flows from=source to=target y=amount format=money
 *
 * Data rules, like every chart, never invent numbers:
 * - Each item is one flow: from= names where it starts, to= where it goes,
 *   y= how much. Nodes are the names, in the order they first appear. Flows
 *   without a number above 0, or without both ends, aren't drawn, with a
 *   warning.
 * - Columns come from the flows: a node goes one column after the furthest
 *   node flowing into it, and nodes nothing flows out of go in the last
 *   column. A node is as tall as the larger of what flows in and what flows
 *   out.
 * - Flows that go round in a circle (A to B and back to A) have no left and
 *   right, so the chart says so instead of drawing them.
 * - At most MAX_SANKEY_NODES nodes and MAX_SANKEY_LINKS flows.
 */
import { easeOut, staggered } from "../../ghost";
import { ellipsize } from "../../text";
import type { Value } from "../../types";
import { fieldOf, isList, isRecord } from "../../data";
import { seriesColors } from "../../theme";
import { fillTint } from "../util";
import { header, labelOf, numberAt, plotHeight, preciseText, shareText, valueText, MAX_CHART_ITEMS, type ChartGeometry, type ChartSlot, type PaintCtx, type Rect } from "../chart-kit";
import type { ChartKindDef } from "./types";

export const MAX_SANKEY_NODES = 40;
export const MAX_SANKEY_LINKS = 120;
/** Space between nodes in a column, and the shortest a node is drawn. */
const NODE_GAP = 10, MIN_NODE = 2;

export interface SankeyNode {
  name: string;
  col: number;
  value: number;
  inflow: number;
  outflow: number;
  rect: Rect;
  color: number;
  /** The name as drawn beside the node, and on which side. */
  label: string;
  labelX: number;
  align: "left" | "right";
}

export interface SankeyLink {
  from: number;
  to: number;
  value: number;
  /** Where the band leaves its source and reaches its target (centre lines), and how thick it is. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

export interface SankeyGeometry {
  nodes: SankeyNode[];
  links: SankeyLink[];
  labelFont: string;
  cols: number;
}

/** A band's centre line at t (0 to 1): a cubic with its handles halfway across. */
function at(l: SankeyLink, t: number): { x: number; y: number } {
  const u = 1 - t, xm = (l.x0 + l.x1) / 2;
  const x = l.x0 * u * u * u + 3 * xm * u * u * t + 3 * xm * u * t * t + l.x1 * t * t * t;
  const y = l.y0 * (u * u * u + 3 * u * u * t) + l.y1 * (3 * u * t * t + t * t * t);
  return { x, y };
}

/** Which flow's band is under (x, y), relative to the box, or -1. */
export function sankeyLinkAt(g: SankeyGeometry, x: number, y: number): number {
  let best = -1, bestD = Infinity;
  g.links.forEach((l, i) => {
    if (x < l.x0 || x > l.x1) return;
    // The band's x grows with t: find t by halving.
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (at(l, mid).x < x) lo = mid; else hi = mid; }
    const d = Math.abs(at(l, (lo + hi) / 2).y - y);
    if (d <= Math.max(l.width / 2, 3) && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/** Trace a band's outline: along the top edge, back along the bottom. */
export function traceLink(g: CanvasRenderingContext2D, l: SankeyLink, ox: number, oy: number): void {
  const h = Math.max(l.width, 1) / 2, xm = (l.x0 + l.x1) / 2;
  g.beginPath();
  g.moveTo(ox + l.x0, oy + l.y0 - h);
  g.bezierCurveTo(ox + xm, oy + l.y0 - h, ox + xm, oy + l.y1 - h, ox + l.x1, oy + l.y1 - h);
  g.lineTo(ox + l.x1, oy + l.y1 + h);
  g.bezierCurveTo(ox + xm, oy + l.y1 + h, ox + xm, oy + l.y0 + h, ox + l.x0, oy + l.y0 + h);
  g.closePath();
}

/** A loop in the flows, as names ("A, B, A"), or null when there's none. */
function findLoop(n: number, out: number[][], names: string[]): string | null {
  const state = new Array<0 | 1 | 2>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (state[s]) continue;
    // Iterative depth-first walk, so a long chain can't overflow the stack.
    const stack: Array<{ v: number; i: number }> = [{ v: s, i: 0 }];
    state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const w = out[top.v]![top.i++];
      if (w === undefined) { state[top.v] = 2; stack.pop(); continue; }
      if (state[w] === 1) {
        const path = [w];
        for (let v = top.v; v !== w && v >= 0; v = parent[v]!) path.push(v);
        path.push(w);
        return path.reverse().map((k) => names[k]!).join(" to ");
      }
      if (!state[w]) { state[w] = 1; parent[w] = top.v; stack.push({ v: w, i: 0 }); }
    }
  }
  return null;
}

export const sankey: ChartKindDef = {
  loadingAs: "hbar",
  layout(box, input, ctx) {
    const t = ctx.theme, m = ctx.measure;
    const { base, say, top } = header(box, "sankey", input.title, ctx);
    const done = (g: ChartGeometry) => ({ g, h: g.plot.y + g.plot.h });
    const where = `chart on line ${input.line}`;
    const fromF = input.extra.from ?? "", toF = input.extra.to ?? "";
    if (!fromF || !toF) return done(say("A sankey needs from= and to="));

    const items: Value | undefined = input.items;
    if (!isList(items) || !items.length) return done(say("No data to chart"));
    if (items.length > MAX_CHART_ITEMS) return done(say(`Too many items to chart: at most ${MAX_CHART_ITEMS}`));
    const index = new Map<string, number>();
    const names: string[] = [];
    const nodeOf = (name: string) => {
      let i = index.get(name);
      if (i === undefined) { i = names.length; index.set(name, i); names.push(name); }
      return i;
    };
    const raw: Array<{ from: number; to: number; value: number }> = [];
    let skipped = 0;
    for (const item of items) {
      const a = isRecord(item) ? fieldOf(item, fromF) : undefined, b = isRecord(item) ? fieldOf(item, toF) : undefined;
      const value = numberAt(item, input.y);
      // A name is text, a number or true/false; anything else (a list, a record) isn't one.
      const nameOf = (v: Value | undefined) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? labelOf(v) : "");
      const fromName = nameOf(a), toName = nameOf(b);
      if (!fromName.trim() || !toName.trim() || value === null || !(value > 0)) { skipped++; continue; }
      const from = nodeOf(fromName), to = nodeOf(toName);
      // Several items for the same two places are one flow, added up.
      const same = raw.find((l) => l.from === from && l.to === to);
      if (same) same.value += value;
      else raw.push({ from, to, value });
    }
    if (skipped) ctx.warn?.(`${where}: ${skipped} of ${items.length} flows have no ${fromF}, no ${toF} or no number above 0 in ${input.y}, so they aren't drawn`);
    if (!raw.length) return done(say("No flows to chart"));
    if (names.length > MAX_SANKEY_NODES) {
      ctx.warn?.(`${where}: the flows name ${names.length} places; a sankey draws at most ${MAX_SANKEY_NODES}. Keep the biggest places, and name the rest "Other" in the data`);
      return done(say(`Too many nodes to chart: at most ${MAX_SANKEY_NODES}`));
    }
    if (raw.length > MAX_SANKEY_LINKS) {
      ctx.warn?.(`${where}: ${raw.length} flows between different places is more than the ${MAX_SANKEY_LINKS} a sankey draws. Show fewer places, naming the smaller ones "Other" in the data`);
      return done(say(`Too many flows to chart: at most ${MAX_SANKEY_LINKS}`));
    }
    const n = names.length;
    const out: number[][] = Array.from({ length: n }, () => []);
    for (const l of raw) out[l.from]!.push(l.to);
    const loop = findLoop(n, out, names);
    if (loop) {
      ctx.warn?.(`${where}: the flows go round in a circle (${loop}), so they have no start and end to draw. Remove a flow that goes back`);
      return done(say(`These flows go round in a circle (${loop}), so they can't be drawn as a sankey`));
    }

    // Columns: one after the furthest node flowing in (longest path), sinks in the last.
    const indeg = new Array<number>(n).fill(0);
    for (const l of raw) indeg[l.to]!++;
    const sources = new Set(names.map((_, i) => i).filter((i) => indeg[i] === 0));
    const inDeg0 = (i: number) => sources.has(i);
    const col = new Array<number>(n).fill(0);
    const queue = names.map((_, i) => i).filter((i) => indeg[i] === 0);
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]!;
      for (const w of out[v]!) {
        col[w] = Math.max(col[w]!, col[v]! + 1);
        if (--indeg[w]! === 0) queue.push(w);
      }
    }
    const cols = Math.max(...col) + 1;
    for (let i = 0; i < n; i++) if (!out[i]!.length) col[i] = cols - 1;
    // A place nothing flows into sits just before the nearest place it feeds, not always in the
    // first column, so its bands don't run behind the columns between.
    for (let i = 0; i < n; i++) {
      if (inDeg0(i) && out[i]!.length) col[i] = Math.max(0, Math.min(...out[i]!.map((w) => col[w]!)) - 1);
    }
    const inflow = new Array<number>(n).fill(0), outflow = new Array<number>(n).fill(0);
    for (const l of raw) { outflow[l.from]! += l.value; inflow[l.to]! += l.value; }
    const value = names.map((_, i) => Math.max(inflow[i]!, outflow[i]!));

    // Sizes: the busiest column sets the scale, so every column fits the height.
    const columns: number[][] = Array.from({ length: cols }, () => []);
    names.forEach((_, i) => columns[col[i]!]!.push(i));
    const most = Math.max(...columns.map((c) => c.length));
    let plotH = Math.max(Math.round(plotHeight(box.w) * 1.2), most * (NODE_GAP + 14));
    const ky = Math.min(...columns.filter((c) => c.length).map((c) => (plotH - NODE_GAP * (c.length - 1)) / c.reduce((a, i) => a + value[i]!, 0)));
    const nodeW = Math.max(8, Math.min(14, box.w / 60));
    const step = cols > 1 ? (box.w - nodeW) / (cols - 1) : 0;
    // Columns need room for their bands to bend: past that, say so rather than draw a knot.
    const minStep = nodeW + 40;
    if (cols > 1 && step < minStep) {
      const fit = Math.max(2, Math.floor((box.w - nodeW) / minStep) + 1);
      ctx.warn?.(`${where}: the flows go through ${cols} columns from start to end, and ${Math.round(box.w)} pixels fit ${fit}. Leave out steps in between, or show it wider`);
      return done(say(`Too many steps from start to end for this width: ${cols} columns, ${fit} fit`));
    }
    if (!Number.isFinite(ky) || !(ky > 0)) {
      ctx.warn?.(`${where}: the amounts add up to more than a number can hold. Use smaller units, like thousands`);
      return done(say("Amounts too large to chart"));
    }
    const h = (i: number) => Math.max(MIN_NODE, value[i]! * ky);
    // Tiny nodes drawn at the shortest size can make a column a little taller than the plot: grow it.
    plotH = Math.max(plotH, ...columns.map((c) => c.reduce((a, i) => a + h(i), 0) + NODE_GAP * (c.length - 1)));

    // Order each column by where its neighbours sit (a few sweeps each way), then stack and centre it.
    const y = new Array<number>(n).fill(0);
    const place = () => {
      for (const c of columns) {
        const total = c.reduce((a, i) => a + h(i), 0) + NODE_GAP * (c.length - 1);
        let at = top + (plotH - total) / 2;
        for (const i of c) { y[i] = at; at += h(i) + NODE_GAP; }
      }
    };
    place();
    const centre = (i: number) => y[i]! + h(i) / 2;
    for (let sweep = 0; sweep < 6; sweep++) {
      const forward = sweep % 2 === 0;
      const order = forward ? columns.slice(1) : columns.slice(0, -1).reverse();
      for (const c of order) {
        const weight = (i: number) => {
          let sum = 0, wsum = 0;
          for (const l of raw) {
            const other = forward ? (l.to === i ? l.from : -1) : (l.from === i ? l.to : -1);
            if (other >= 0) { sum += centre(other) * l.value; wsum += l.value; }
          }
          return wsum ? sum / wsum : centre(i);
        };
        const keyed = c.map((i) => ({ i, k: weight(i) }));
        keyed.sort((a, b) => a.k - b.k);
        c.splice(0, c.length, ...keyed.map((k) => k.i));
      }
      place();
    }

    // Bands: each leaves its source in the order of its targets, and reaches its target in the order of its sources.
    const xOf = (i: number) => col[i]! * step;
    const outAt = new Array<number>(n).fill(0), inAt = new Array<number>(n).fill(0);
    const order = raw.map((_, k) => k);
    const byTarget = [...order].sort((a, b) => centre(raw[a]!.to) - centre(raw[b]!.to));
    const bySource = [...order].sort((a, b) => centre(raw[a]!.from) - centre(raw[b]!.from));
    const y0 = new Array<number>(raw.length), y1 = new Array<number>(raw.length);
    // A node shorter than MIN_NODE squeezes its bands to fit.
    const fit = (i: number, side: number[]) => (side[i]! > 0 ? Math.min(1, h(i) / (side[i]! * ky)) : 1);
    for (const k of byTarget) { const l = raw[k]!, w = l.value * ky * fit(l.from, outflow); y0[k] = y[l.from]! + outAt[l.from]! + w / 2; outAt[l.from]! += w; }
    for (const k of bySource) { const l = raw[k]!, w = l.value * ky * fit(l.to, inflow); y1[k] = y[l.to]! + inAt[l.to]! + w / 2; inAt[l.to]! += w; }
    const links: SankeyLink[] = raw.map((l, k) => ({
      from: l.from, to: l.to, value: l.value,
      x0: xOf(l.from) + nodeW, y0: y0[k]!, x1: xOf(l.to), y1: y1[k]!, width: l.value * ky * Math.min(fit(l.from, outflow), fit(l.to, inflow)),
    }));

    // Names beside their nodes: on the right, but on the left in the last column. With three or
    // more columns the last gap holds names from both sides, so each side gets half of it.
    const labelFont = base.labelFont;
    const lineH = Math.round(t.text.caption * 1.4);
    const gapRoom = cols > 1 ? step - nodeW : box.w - nodeW;
    // The last gap holds names from both its sides (two columns included), so each side gets half.
    const roomFor = (c: number) => Math.max(0, (cols >= 2 && c >= cols - 2 ? gapRoom / 2 : gapRoom) - t.space.sm * 1.5);
    const nodes: SankeyNode[] = names.map((name, i) => {
      const last = col[i] === cols - 1 && cols > 1;
      const room = roomFor(col[i]!);
      const full = `${name} ${valueText(value[i]!, input.format)}`;
      // The name and amount, or the name alone, or nothing: a stub of a name says nothing.
      let label = m.width(full, labelFont) <= room ? full : room >= 24 ? ellipsize(name, room, labelFont, m) : "";
      if (label.endsWith("…") && label.length - 1 < Math.min(4, name.length)) label = "";
      return {
        name, col: col[i]!, value: value[i]!, inflow: inflow[i]!, outflow: outflow[i]!,
        rect: { x: xOf(i), y: y[i]!, w: nodeW, h: h(i) }, color: i % 6,
        label, labelX: last ? xOf(i) - t.space.xs : xOf(i) + nodeW + t.space.xs, align: last ? "right" : "left",
      };
    });
    // Names that would sit on each other (small nodes close together) keep only the first.
    for (const c of columns) {
      let lastY = -Infinity;
      for (const i of [...c].sort((p, q) => y[p]! - y[q]!)) {
        const nd = nodes[i]!;
        if (!nd.label) continue;
        const cy = nd.rect.y + nd.rect.h / 2;
        if (cy - lastY < lineH) nd.label = "";
        else lastY = cy;
      }
    }

    // Slots for tips: each node, then each flow.
    const slots: ChartSlot[] = [
      ...nodes.map((nd): ChartSlot => ({
        label: nd.name, shownLabel: null, labelX: 0, cx: nd.rect.x + nd.rect.w / 2, value: nd.value, values: [nd.value], bars: [nd.rect],
        notes: [nd.inflow ? `In: ${preciseText(nd.inflow, input.format)}` : "", nd.outflow ? `Out: ${preciseText(nd.outflow, input.format)}` : ""].filter(Boolean),
      })),
      ...links.map((l): ChartSlot => ({
        label: `${names[l.from]} to ${names[l.to]}`, shownLabel: null, labelX: 0, cx: (l.x0 + l.x1) / 2, value: l.value, values: [l.value],
        notes: [`${preciseText(l.value, input.format)} · ${shareText(outflow[l.from]! ? l.value / outflow[l.from]! : 0)} of ${names[l.from]}`],
      })),
    ];
    const geometry: SankeyGeometry = { nodes, links, labelFont, cols };
    const plot: Rect = { x: 0, y: top, w: box.w, h: plotH };
    return { g: { ...base, plot, slots, labelY: top + plotH, min: 0, max: Math.max(...value), noHoverOutline: true, custom: geometry }, h: top + plotH };
  },

  paint(box, ctx, d, reveal) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const s = d.custom as SankeyGeometry;
    const ox = box.x, oy = box.y;
    const base = g.globalAlpha;
    const palette = seriesColors(theme);
    // Bands first, in their source's color, faint, so crossings read; then nodes over them.
    s.links.forEach((l, i) => {
      const grow = reveal < 1 ? staggered(reveal, i, s.links.length) : 1;
      if (grow <= 0) return;
      g.globalAlpha = base * grow;
      traceLink(g, l, ox, oy);
      fillTint(g, palette[s.nodes[l.from]!.color % palette.length]!, 0.32);
    });
    g.globalAlpha = base;
    for (const nd of s.nodes) {
      const r = nd.rect;
      ctx.roundRect(ox + r.x, oy + r.y, r.w, r.h, Math.min(2, r.w / 2, r.h / 2));
      g.fillStyle = palette[nd.color % palette.length]!;
      g.fill();
    }
    // Names last, with a soft edge in the surface color so they read over the bands.
    g.globalAlpha = base * easeOut(reveal * 2.5);
    g.font = s.labelFont;
    g.textBaseline = "middle";
    g.lineJoin = "round";
    for (const nd of s.nodes) {
      if (!nd.label) continue;
      g.textAlign = nd.align;
      const ly = oy + nd.rect.y + nd.rect.h / 2;
      g.strokeStyle = c.surface;
      g.lineWidth = 3;
      g.strokeText(nd.label, ox + nd.labelX, ly);
      g.fillStyle = c.ink;
      g.fillText(nd.label, ox + nd.labelX, ly);
    }
    g.globalAlpha = base;
  },
};

/** The hovered or focused flow drawn darker, for the tip (chart.ts calls this). */
export function paintSankeyHover(ctx: PaintCtx, d: ChartGeometry, slot: number, ox: number, oy: number): void {
  const s = d.custom as SankeyGeometry;
  const { g, theme } = ctx;
  const palette = seriesColors(theme);
  const li = slot - s.nodes.length;
  if (li >= 0) {
    const l = s.links[li];
    if (!l) return;
    traceLink(g, l, ox, oy);
    fillTint(g, palette[s.nodes[l.from]!.color % palette.length]!, 0.5);
  } else {
    // A node: its flows in and out stand out.
    s.links.forEach((l) => {
      if (l.from !== slot && l.to !== slot) return;
      traceLink(g, l, ox, oy);
      fillTint(g, palette[s.nodes[slot]!.color % palette.length]!, 0.3);
    });
  }
}
