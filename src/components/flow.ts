/**
 * flow: boxes joined by arrows, laid out automatically. Approval processes,
 * customer journeys, decision trees, how-it-works diagrams.
 *
 *   flow "Claim approval" items=steps label=label next=next kind=kind edges=edges
 *
 * The model lists steps and where each leads; it never places anything. The
 * layout is a small layered one written here: arrows that go back (loops)
 * are found with a depth-first walk and left out of the layering; each step
 * goes one layer after the furthest step leading to it; a few sweeps order
 * each layer by its neighbours' average position to cut crossings; boxes are
 * sized from their words; arrows are straight or elbows, back arrows run
 * round the side. Too wide for its space, it scrolls sideways.
 */
import type { ComponentDef, LayoutContext, PaintContext, PressContext } from "../component";
import type { PartSemantics } from "../a11y/semantics";
import { fieldOf, isList, isRecord } from "../data";
import { ellipsize, fitLines } from "../text";
import type { Box, Value } from "../types";
import { fillTint, onProp, partBox, runOn, themeFont } from "./util";

/** The most steps one flow draws; more shows a message. */
export const MAX_FLOW_NODES = 40;
const DIRECTIONS = ["down", "right"] as const;
const KINDS = ["step", "decision", "start", "end"] as const;
type Kind = (typeof KINDS)[number];
const SCROLL_AREA = "scroll:area";
const DRAG_SLOP = 4;
const ARROW_STEP = 60;
/** One arrow's key: ids are any text, so they're kept apart in a way no id can copy. */
const pairKey = (from: string, to: string) => JSON.stringify([from, to]);

interface FNode {
  index: number;
  id: string;
  key: string | number;
  label: string;
  kind: Kind;
  next: string[];
  layer: number;
  order: number;
  lines: string[];
  /** A placeholder where a long arrow crosses a layer: it takes part in ordering and placement, and is never drawn. */
  dummy?: boolean;
  /** Relative to the box; x within the scrolled content. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FEdge {
  from: FNode;
  to: FNode;
  label: string;
  back: boolean;
  points: Array<{ x: number; y: number }>;
  /** Where its label sits, if it has one. */
  labelAt?: { x: number; y: number };
  /** On a straight arrow the label sits beside the line (above a level one, right of an upright one), so it never covers a box. */
  labelBeside?: "above" | "right";
}

export interface FlowGeometry {
  title: string[];
  titleLH: number;
  top: number;
  message?: string;
  direction: "down" | "right";
  nodes: FNode[];
  edges: FEdge[];
  contentW: number;
  viewW: number;
  bodyH: number;
  bar: number;
  pressable: boolean;
  scrolled?: number;
  fonts: { label: string; small: string; title: string };
  lineH: number;
}

const textOf = (v: Value | undefined): string =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** Where a step leads: one id, a list of ids, or ids separated by commas. */
function nextIds(v: Value | undefined): string[] {
  if (isList(v)) return v.map(textOf).map((s) => s.trim()).filter(Boolean);
  return textOf(v).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Layers for a directed graph. Back arrows (to a step already on the walk, so
 * loops) are marked and left out; each other step goes one layer after the
 * furthest step leading to it (longest path, in topological order).
 */
export function layerSteps(nodes: FNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const back = new Set<string>();
  const state = new Map<FNode, 1 | 2>();
  // Iterative depth-first walk, so a long chain of steps can't overflow the stack.
  const visit = (start: FNode) => {
    const stack: Array<{ n: FNode; i: number }> = [{ n: start, i: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const id = top.n.next[top.i++];
      if (id === undefined) { state.set(top.n, 2); stack.pop(); continue; }
      const m = byId.get(id);
      if (!m) continue;
      const s = state.get(m);
      if (s === 1) back.add(pairKey(top.n.id, m.id));
      else if (!s) { state.set(m, 1); stack.push({ n: m, i: 0 }); }
    }
  };
  const incoming = new Set(nodes.flatMap((n) => n.next));
  for (const n of nodes) if (!incoming.has(n.id) && !state.has(n)) visit(n);
  for (const n of nodes) if (!state.has(n)) visit(n);
  const forward = (n: FNode) => n.next.filter((id) => byId.has(id) && !back.has(pairKey(n.id, id))).map((id) => byId.get(id)!);
  const indeg = new Map(nodes.map((n) => [n, 0]));
  for (const n of nodes) for (const m of forward(n)) indeg.set(m, indeg.get(m)! + 1);
  const queue = nodes.filter((n) => indeg.get(n) === 0);
  nodes.forEach((n) => { n.layer = 0; });
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]!;
    for (const m of forward(n)) {
      m.layer = Math.max(m.layer, n.layer + 1);
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  return back;
}

/**
 * Order each layer to cut crossings: start in list order, then sweep down and
 * up a few times, placing each step at the average position of its neighbours
 * in the layer before (down) or after (up).
 */
export function orderLayers(layers: FNode[][], succ: Map<FNode, FNode[]>): void {
  const pred = new Map<FNode, FNode[]>();
  for (const l of layers) for (const n of l) pred.set(n, []);
  for (const [n, outs] of succ) for (const m of outs) pred.get(m)?.push(n);
  layers.forEach((l) => l.forEach((n, i) => { n.order = i; }));
  const bary = (list: FNode[], fallback: number) => (list.length ? list.reduce((s, x) => s + x.order, 0) / list.length : fallback);
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const range = layers.map((_, i) => i);
    for (const li of down ? range.slice(1) : range.reverse().slice(1)) {
      const layer = layers[li]!;
      const keyed = layer.map((n) => ({ n, b: bary(down ? pred.get(n) ?? [] : succ.get(n) ?? [], n.order) }));
      keyed.sort((x, y) => x.b - y.b || x.n.order - y.n.order);
      keyed.forEach((k, i) => { k.n.order = i; });
      layer.sort((x, y) => x.order - y.order);
    }
  }
}

// ---------------------------------------------------------------- layout

type LayoutCtx = Pick<LayoutContext, "theme" | "measure" | "warn" | "props" | "isLoading">;

export function flowLayout(box: Box, ctx: LayoutCtx): FlowGeometry {
  const p = ctx.props(box.node);
  const t = ctx.theme, m = ctx.measure;
  const warn = (msg: string) => ctx.warn?.(`flow on line ${box.node.line}: ${msg}`);
  const fonts = { title: themeFont(t, 600, t.text.body), label: themeFont(t, 600, t.text.caption + 1), small: themeFont(t, 600, t.text.caption) };
  const lineH = Math.round((t.text.caption + 1) * 1.35);
  const titleLH = Math.round(t.text.body * 1.4);
  const title = p.text() ? fitLines(p.text(), box.w, fonts.title, m, 3) : [];
  const top = title.length ? title.length * titleLH + t.space.sm : 0;
  const pressable = p.has("bind") || p.has("on");
  let direction = p.oneOf("direction", DIRECTIONS, "down");
  const base: FlowGeometry = { title, titleLH, top, direction, nodes: [], edges: [], contentW: box.w, viewW: box.w, bodyH: 0, bar: 0, pressable, fonts, lineH };
  const say = (message: string): FlowGeometry => ({ ...base, message, bodyH: Math.max(t.control.height * 2, 72) });

  const loading = !!ctx.isLoading?.(box.node);
  const raw = loading ? undefined : p.expr("items");
  if (!loading && p.has("items") && !isList(raw)) warn("items is not a list. Use a list of steps, each naming where it leads, like items=steps");
  const items: readonly Value[] = isList(raw) ? raw : [];
  if (items.length > MAX_FLOW_NODES) {
    warn(`${items.length} steps is more than the ${MAX_FLOW_NODES} a flow draws. Split it into smaller flows`);
    return say(`Too many steps to draw: ${items.length}, at most ${MAX_FLOW_NODES}`);
  }
  const field = (name: string, def: string) => p.str(name, def) || def;
  const idF = field("id", "id"), labelF = field("label", "label"), nextF = field("next", "next"), kindF = field("kind", "kind");
  const nodes: FNode[] = [];
  const seen = new Set<string>();
  const notRecords: number[] = [], twice: string[] = [], oddKinds: string[] = [];
  items.forEach((it, index) => {
    if (!isRecord(it)) { notRecords.push(index + 1); return; }
    const raw = fieldOf(it, idF);
    const id = textOf(raw);
    if (!id) return;
    if (seen.has(id)) { twice.push(id); return; }
    seen.add(id);
    const kindV = textOf(fieldOf(it, kindF));
    const known = (KINDS as readonly string[]).includes(kindV);
    if (kindV && !known) oddKinds.push(kindV);
    nodes.push({
      index, id, key: typeof raw === "number" ? raw : id, label: textOf(fieldOf(it, labelF)) || id,
      kind: known ? (kindV as Kind) : "step",
      next: nextIds(fieldOf(it, nextF)), layer: 0, order: 0, lines: [], x: 0, y: 0, w: 0, h: 0,
    });
  });
  if (!nodes.length) {
    if (!loading && items.length) warn(`No step has an ${idF}. Set id= to the field that identifies each step`);
    return loading ? { ...base, bodyH: t.control.height * 3 } : say("Nothing to show yet");
  }
  if (!loading) {
    const few = (list: Array<string | number>) => [...new Set(list)].slice(0, 3).join(", ");
    if (notRecords.length) warn(`item ${few(notRecords)} isn't a record, so it isn't drawn. Write each step as {id: "a", label: "…", next: "b"}`);
    if (twice.length) warn(`more than one step has the ${idF} ${few(twice)}; only the first is drawn. Give each step its own ${idF}`);
    if (oddKinds.length) warn(`kind ${few(oddKinds.map((k) => `"${k}"`))} isn't known, so it's drawn as a step. Use step, decision, start or end`);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const missing = [...new Set(nodes.flatMap((n) => n.next).filter((id) => !byId.has(id)))];
  if (missing.length && !loading) warn(`next names ${missing.length === 1 ? "a step" : "steps"} that ${missing.length === 1 ? "isn't" : "aren't"} in the list (${missing.slice(0, 3).join(", ")}), so ${missing.length === 1 ? "that arrow isn't" : "those arrows aren't"} drawn. Use each step's ${idF}`);
  const back = layerSteps(nodes);

  // Edge labels from edges=: [{from, to, label}].
  const labels = new Map<string, string>();
  const edgesRaw = p.has("edges") ? p.expr("edges") : undefined;
  if (!loading && p.has("edges") && !isList(edgesRaw)) warn("edges is not a list. Use a list of {from, to, label}, like edges=[{from: \"check\", to: \"auto\", label: \"Yes\"}]");
  const unknownEdges: string[] = [];
  if (isList(edgesRaw)) for (const e of edgesRaw) {
    if (!isRecord(e)) continue;
    const from = textOf(fieldOf(e, "from")), to = textOf(fieldOf(e, "to"));
    if (!byId.get(from)?.next.includes(to)) unknownEdges.push(`${from} to ${to}`);
    labels.set(pairKey(from, to), textOf(fieldOf(e, "label")));
  }
  if (unknownEdges.length && !loading) warn(`edges labels an arrow that isn't drawn (${unknownEdges.slice(0, 3).join(", ")}). Each {from, to} needs a step whose next names that step`);

  // Box sizes from their words.
  // Labels wrap sooner on a narrow screen, so two boxes side by side still fit.
  const maxText = Math.max(80, Math.min(200, box.w * 0.33));
  const padX = t.space.md, padY = t.space.sm + 2;
  for (const n of nodes) {
    // Two lines, or three where narrow wrapping needs them.
    n.lines = fitLines(n.label, maxText, fonts.label, m, maxText < 140 ? 3 : 2);
    const textW = Math.max(...n.lines.map((l) => m.width(l, fonts.label)));
    const textH = n.lines.length * lineH;
    if (n.kind === "decision") {
      // A diamond holds its words in its middle half: about twice the size of the words' box.
      n.w = Math.max(112, textW * 1.5 + 2 * padX);
      n.h = Math.max(64, textH * 2 + 2 * padY);
    } else {
      n.w = Math.max(96, textW + 2 * padX);
      n.h = Math.max(t.control.height, textH + 2 * padY);
    }
  }

  // Forward arrows as chains through placeholders in every layer they cross.
  type Arrow = { from: FNode; to: FNode; chain: FNode[]; label: string };
  const arrows: Arrow[] = [];
  const backArrows: Array<{ from: FNode; to: FNode; label: string }> = [];
  const succ = new Map<FNode, FNode[]>(nodes.map((n) => [n, []]));
  const all = [...nodes];
  for (const n of nodes) for (const id of n.next) {
    const to = byId.get(id);
    if (!to) continue;
    const label = labels.get(pairKey(n.id, id)) ?? "";
    if (back.has(pairKey(n.id, id))) { backArrows.push({ from: n, to, label }); continue; }
    const chain: FNode[] = [n];
    for (let l = n.layer + 1; l < to.layer; l++) {
      const dmy: FNode = { index: -1, id: `~${pairKey(n.id, id)}@${l}`, key: "", label: "", kind: "step", next: [], layer: l, order: 0, lines: [], dummy: true, x: 0, y: 0, w: t.space.sm, h: 0 };
      all.push(dmy);
      succ.set(dmy, []);
      chain.push(dmy);
    }
    chain.push(to);
    for (let i = 0; i + 1 < chain.length; i++) succ.get(chain[i]!)!.push(chain[i + 1]!);
    arrows.push({ from: n, to, chain, label });
  }
  const layersCount = Math.max(...nodes.map((n) => n.layer)) + 1;
  const layers: FNode[][] = Array.from({ length: layersCount }, () => []);
  for (const n of all) layers[n.layer]!.push(n);
  orderLayers(layers, succ);

  // Placement along the main axis (layers) and the cross axis (order), for either direction.
  const gapMain = t.space.xl + t.space.md, gapCross = t.space.lg;
  const place = (dir: "down" | "right") => {
    const mainSize = (n: FNode) => (dir === "down" ? n.h : n.w), crossSize = (n: FNode) => (dir === "down" ? n.w : n.h);
    const layerMain = layers.map((l) => Math.max(0, ...l.map(mainSize)));
    const layerCross = layers.map((l) => l.reduce((s2, n, i) => s2 + crossSize(n) + (i ? gapCross : 0), 0));
    const cross = Math.max(...layerCross);
    let main = 0;
    const starts: number[] = [];
    layers.forEach((l, li) => {
      starts.push(main);
      let c = (cross - layerCross[li]!) / 2;
      for (const n of l) {
        const mm = main + (layerMain[li]! - mainSize(n)) / 2;
        if (dir === "down") { n.x = c; n.y = mm; } else { n.x = mm; n.y = c; }
        c += crossSize(n) + gapCross;
      }
      main += layerMain[li]! + gapMain;
    });
    return { width: dir === "down" ? cross : main - gapMain, height: dir === "down" ? main - gapMain : cross, layerMain, starts };
  };
  let laid = place(direction);
  // A flow that runs right but doesn't fit its space runs down instead, when that's narrower.
  if (direction === "right" && laid.width > box.w) {
    const downward = place("down");
    if (downward.width < laid.width) { direction = "down"; laid = downward; } else laid = place("right");
  }
  const down = direction === "down";
  const laneGap = t.space.sm + 2;
  const sideRoom = backArrows.length ? t.space.md + backArrows.length * laneGap : 0;
  // Back arrows into the first layer need room before it, so they never run over the title.
  const intoFirst = backArrows.filter((a) => a.to.layer === 0).length;
  const lead = intoFirst ? 8 + intoFirst * 5 : 0;
  const contentW = Math.max(box.w, laid.width + (down ? sideRoom : lead));
  const offX = down ? (contentW - laid.width - sideRoom) / 2 : lead + (contentW - laid.width - lead) / 2, offY = top + (down ? lead : 0);
  for (const n of all) { n.x += offX; n.y += offY; }

  // Points are worked out on (main, cross) axes and turned into (x, y) at the end.
  const P = (mainV: number, crossV: number) => (down ? { x: crossV, y: mainV } : { x: mainV, y: crossV });
  const mainOf = (n: FNode) => (down ? n.y : n.x), mainEnd = (n: FNode) => (down ? n.y + n.h : n.x + n.w);
  const mainMid = (n: FNode) => (down ? n.y + n.h / 2 : n.x + n.w / 2);
  const crossMid = (n: FNode) => (down ? n.x + n.w / 2 : n.y + n.h / 2), crossEnd = (n: FNode) => (down ? n.x + n.w : n.y + n.h);
  const offMain = down ? offY : offX;
  const layerStart = (l: number) => offMain + laid.starts[l]!;
  const layerEnd = (l: number) => layerStart(l) + laid.layerMain[l]!;
  // Each step with arrows out turns them on its own line across the gap after its layer,
  // so arrows from different steps never share a line.
  const track = new Map<FNode, number>();
  layers.forEach((layer, l) => {
    const from = layer.filter((n) => succ.get(n)!.length);
    from.forEach((n, j) => track.set(n, layerEnd(l) + gapMain * (from.length < 2 ? 0.5 : 0.35 + (0.3 * j) / (from.length - 1))));
  });
  const edges: FEdge[] = [];
  for (const n of nodes) {
    // Arrows out of a step leave in the order their targets sit, so they don't cross each other.
    const outs = arrows.filter((x) => x.from === n).sort((x, y) => crossMid(x.chain[1]!) - crossMid(y.chain[1]!));
    const k = outs.length;
    outs.forEach((a, i) => {
      const size = down ? n.w : n.h;
      const spread = n.kind === "decision" ? 0 : Math.min(down ? 14 : 10, size / (k + 1));
      let c = crossMid(n) + (i - (k - 1) / 2) * spread;
      const pts = [P(mainEnd(n), c)];
      for (let j = 1; j < a.chain.length; j++) {
        const prev = a.chain[j - 1]!, w = a.chain[j]!;
        const wc = crossMid(w);
        if (Math.abs(wc - c) >= 1) { const mid = track.get(prev)!; pts.push(P(mid, c), P(mid, wc)); c = wc; }
        // Through a placeholder's whole layer; into a real step's near side.
        pts.push(P(w.dummy ? layerEnd(w.layer) : mainOf(w), c));
      }
      const straight = pts.length === 2;
      // A straight arrow's label sits beside its middle; a turning one's on its first turn.
      const [la, lb] = straight ? [pts[0]!, pts[1]!] : [pts[1]!, pts[2]!];
      edges.push({
        from: a.from, to: a.to, label: a.label, back: false, points: pts,
        labelAt: a.label ? { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 } : undefined,
        labelBeside: a.label && straight ? (down ? "right" : "above") : undefined,
      });
    });
  }
  // Back arrows leave from the far side, run along the gap after the source's layer to a lane
  // beyond the flow, back along it, and come in from the gap before the target's layer on the
  // far side too, so they never share a line with the arrows going forward.
  const farCross = Math.max(...all.map(crossEnd));
  const leaving = new Map<number, number>(), coming = new Map<number, number>();
  const nth = (m: Map<number, number>, l: number) => { const k = m.get(l) ?? 0; m.set(l, k + 1); return k; };
  backArrows.forEach((a, bi) => {
    const laneC = farCross + t.space.md + bi * laneGap;
    const after = layerEnd(a.from.layer) + 7 + Math.min(nth(leaving, a.from.layer), 3) * 4;
    const before = layerStart(a.to.layer) - 7 - Math.min(nth(coming, a.to.layer), 3) * 4;
    const jog = (n: FNode) => crossEnd(n) + gapCross / 2;
    const side = (n: FNode) => crossEnd(n) - Math.min(12, (down ? n.w : n.h) / 4);
    // The outermost step of its layer goes straight out of its far side to the lane.
    const outermost = (n: FNode) => !layers[n.layer]!.some((o) => o !== n && crossMid(o) > crossMid(n));
    const fromOut = outermost(a.from), toOut = outermost(a.to);
    const leave = fromOut ? mainMid(a.from) : after, arrive = toOut ? mainMid(a.to) : before;
    const out = fromOut
      ? [P(leave, crossEnd(a.from))]
      : a.from.kind === "decision"
        ? [P(mainMid(a.from), crossEnd(a.from)), P(mainMid(a.from), jog(a.from)), P(after, jog(a.from))]
        : [P(mainEnd(a.from), side(a.from)), P(after, side(a.from))];
    const into = toOut
      ? [P(arrive, crossEnd(a.to))]
      : a.to.kind === "decision"
        ? [P(before, jog(a.to)), P(mainMid(a.to), jog(a.to)), P(mainMid(a.to), crossEnd(a.to))]
        : [P(before, side(a.to)), P(mainOf(a.to), side(a.to))];
    const pts = [...out, P(leave, laneC), P(arrive, laneC), ...into];
    const la = pts[out.length]!, lb = pts[out.length + 1]!;
    edges.push({ from: a.from, to: a.to, label: a.label, back: true, points: pts, labelAt: a.label ? { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 } : undefined });
  });
  const maxBottom = Math.max(...nodes.map((n) => n.y + n.h), ...edges.flatMap((e) => e.points.map((pt) => pt.y)));
  const bodyH = maxBottom - top + 2;
  const scrolls = overflow(contentW, box.w) > 0;
  // Reading order for the keyboard and screen readers: layer by layer, then along each layer.
  nodes.sort((a, b) => a.layer - b.layer || a.order - b.order);
  return { ...base, direction, nodes, edges, contentW, viewW: box.w, bodyH, bar: scrolls ? t.space.md : 0 };
}

// ---------------------------------------------------------------- scrolling and parts

/** How far content past its space scrolls; under half a pixel over doesn't count. Layout and paint both use it. */
const overflow = (contentW: number, viewW: number) => (contentW - viewW > 0.5 ? contentW - viewW : 0);
const maxScroll = (d: FlowGeometry) => overflow(d.contentW, d.viewW);
function scrollTo(v: Record<string, number>, d: FlowGeometry, x: number): boolean {
  const before = v.x ?? 0;
  v.x = Math.max(0, Math.min(maxScroll(d), x));
  return Math.abs(v.x - before) > 0.01;
}
interface FlowPart { geo: FlowGeometry; x: number; y: number; hidden?: boolean }
function geoOf(b: Box): FlowPart | null {
  const d = b.data as unknown as FlowPart | undefined;
  return d && "geo" in d ? d : null;
}
function part(box: Box, x: number, y: number, w: number, h: number, hidden = false): Box {
  return { ...partBox(box, x, y, w, h), data: { geo: box.data as unknown as FlowGeometry, x: box.x, y: box.y, hidden } as unknown as Box["data"] };
}
const stepDetail = (n: FNode) => `step:${n.id}`;

// ---------------------------------------------------------------- paint

function shapePath(ctx: PaintContext, n: FNode, x: number, y: number): void {
  const g = ctx.g;
  if (n.kind === "decision") {
    g.beginPath();
    g.moveTo(x + n.w / 2, y);
    g.lineTo(x + n.w, y + n.h / 2);
    g.lineTo(x + n.w / 2, y + n.h);
    g.lineTo(x, y + n.h / 2);
    g.closePath();
  } else ctx.roundRect(x, y, n.w, n.h, n.kind === "step" ? ctx.theme.radius.md : n.h / 2);
}

function paintFlow(box: Box, ctx: PaintContext): void {
  const d = box.data as unknown as FlowGeometry | undefined;
  if (!d) return;
  const { g, theme } = ctx;
  const c = theme.colors;
  const ox = box.x, oy = box.y;
  const measure = { width: (s: string, f: string) => { g.font = f; return g.measureText(s).width; } };
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = d.fonts.title;
  g.fillStyle = c.ink;
  d.title.forEach((l, i) => g.fillText(l, ox, oy + i * d.titleLH + d.titleLH / 2));
  if (d.message !== undefined) {
    g.font = d.fonts.label;
    g.fillStyle = c.muted;
    g.fillText(ellipsize(d.message, box.w, d.fonts.label, measure), ox, oy + d.top + d.bodyH / 2);
    return;
  }
  const v = ctx.view(box.node);
  // A flow wider than its space opens on its first step: at the start running right,
  // centred on it running down.
  const first = d.nodes[0];
  const opening = d.direction === "right" || !first ? 0 : first.x + first.w / 2 - d.viewW / 2;
  let sx = Math.max(0, Math.min(maxScroll(d), v.x ?? opening));
  const focused = d.nodes.findIndex((n) => ctx.isFocused(box.node, stepDetail(n)));
  if (focused >= 0 && v.focusedStep !== focused) {
    const n = d.nodes[focused]!;
    if (n.x < sx) sx = n.x - theme.space.sm;
    else if (n.x + n.w > sx + d.viewW) sx = n.x + n.w - d.viewW + theme.space.sm;
    scrollTo(v, d, sx);
    sx = v.x ?? 0;
  }
  if (focused >= 0) v.focusedStep = focused; else delete v.focusedStep;
  v.x = sx;
  d.scrolled = sx;
  const left = ox, right = ox + box.w;
  const cx = (x: number) => ox + x - sx;
  const scrolls = maxScroll(d) > 0;
  if (scrolls) ctx.addHit(part(box, ox, oy + d.top, box.w, d.bodyH + d.bar), { detail: SCROLL_AREA, focusable: !d.pressable });

  g.save();
  g.beginPath();
  g.rect(left, oy + d.top - 4, box.w, d.bodyH + 8);
  g.clip();
  // Arrows under the boxes.
  for (const e of d.edges) {
    g.beginPath();
    e.points.forEach((pt, i) => (i ? g.lineTo(cx(pt.x), oy + pt.y) : g.moveTo(cx(pt.x), oy + pt.y)));
    g.strokeStyle = e.back ? c.muted : c.control;
    g.lineWidth = 1.5;
    g.lineJoin = "round";
    if (e.back) g.setLineDash([5, 4]);
    g.stroke();
    g.setLineDash([]);
    const a = e.points[e.points.length - 2]!, b = e.points[e.points.length - 1]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x), size = 7;
    g.beginPath();
    g.moveTo(cx(b.x), oy + b.y);
    g.lineTo(cx(b.x) - size * Math.cos(ang - 0.45), oy + b.y - size * Math.sin(ang - 0.45));
    g.lineTo(cx(b.x) - size * Math.cos(ang + 0.45), oy + b.y - size * Math.sin(ang + 0.45));
    g.closePath();
    g.fillStyle = e.back ? c.muted : c.control;
    g.fill();
  }
  // Boxes.
  const selected = ctx.props(box.node).bound();
  for (const n of d.nodes) {
    const x = cx(n.x), y = oy + n.y;
    if (x + n.w < left - 1 || x > right + 1) continue;
    const sel = d.pressable && selected !== undefined && selected !== null && (selected === n.key || String(selected) === n.id);
    const hover = d.pressable && ctx.isHovered(box.node, stepDetail(n));
    if (hover) { shapePath(ctx, n, x, y + 2); g.fillStyle = c.shadow; g.fill(); }
    shapePath(ctx, n, x + 0.5, y + 0.5);
    g.fillStyle = c.raised;
    g.fill();
    const tint = n.kind === "start" || n.kind === "end" ? c.accent : n.kind === "decision" ? c.warn : null;
    if (tint) fillTint(g, tint, n.kind === "decision" ? 0.1 : 0.1);
    if (sel) fillTint(g, c.accent, 0.14);
    g.strokeStyle = sel ? c.accent : n.kind === "decision" ? c.warn : n.kind === "step" ? c.line : c.accent;
    g.lineWidth = sel ? 2 : 1.25;
    g.stroke();
    // Words on the part of the box in sight, so they never run past the edges.
    const vl = Math.max(x, left), vr = Math.min(x + n.w, right);
    const inner = Math.min(n.kind === "decision" ? n.w * 0.62 : n.w - 2 * theme.space.sm, vr - vl - 2 * theme.space.sm);
    if (inner >= 40) {
      g.font = d.fonts.label;
      g.fillStyle = c.ink;
      g.textAlign = "center";
      const ty0 = y + n.h / 2 - ((n.lines.length - 1) * d.lineH) / 2;
      const mid = vr - vl < n.w - 0.5 ? (vl + vr) / 2 : x + n.w / 2;
      n.lines.forEach((l, i) => g.fillText(ellipsize(l, inner, d.fonts.label, measure), mid, ty0 + i * d.lineH));
    }
    if (ctx.isFocused(box.node, stepDetail(n))) {
      ctx.roundRect(x - 3, y - 3, n.w + 6, n.h + 6, theme.radius.md + 2);
      g.strokeStyle = c.focus;
      g.lineWidth = 2;
      g.stroke();
    }
  }
  // Arrow labels on top, each on a small chip so lines don't run through them.
  for (const e of d.edges) {
    if (!e.label || !e.labelAt) continue;
    const w = measure.width(e.label, d.fonts.small) + 10, h = Math.round(theme.text.caption * 1.6);
    const x0 = cx(e.labelAt.x) - (e.labelBeside === "right" ? -4 : w / 2), y = oy + e.labelAt.y - (e.labelBeside === "above" ? h + 3 : h / 2);
    if (w > box.w - 4) continue;
    // Moved into sight rather than cut off at an edge.
    const x = Math.max(left + 2, Math.min(right - w - 2, x0));
    ctx.roundRect(x, y, w, h, h / 2);
    g.fillStyle = c.raised;
    g.fill();
    g.strokeStyle = c.line;
    g.lineWidth = 1;
    g.stroke();
    g.font = d.fonts.small;
    g.fillStyle = c.muted;
    g.textAlign = "center";
    g.fillText(e.label, x + w / 2, y + h / 2);
  }
  g.restore();
  if (d.pressable) {
    for (const n of d.nodes) {
      const x = cx(n.x);
      const l = Math.max(x, left), r = Math.min(x + n.w, right);
      const hidden = r - l <= 1;
      ctx.addHit(part(box, hidden ? (x + n.w <= left ? left : right - 1) : l, oy + n.y, hidden ? 1 : r - l, n.h, hidden), { detail: stepDetail(n) });
    }
  }
  if (scrolls && !d.pressable && ctx.isFocused(box.node, SCROLL_AREA)) {
    ctx.roundRect(ox - 2, oy + d.top - 2, box.w + 4, d.bodyH + 4, theme.radius.md + 2);
    g.strokeStyle = c.focus;
    g.lineWidth = 2;
    g.stroke();
  }
  if (scrolls) {
    const inset = theme.space.sm;
    const trackW = Math.max(0, box.w - 2 * inset);
    const w = Math.min(trackW, Math.max(28, (trackW * d.viewW) / Math.max(1, d.contentW)));
    const tx = ox + inset + (trackW - w) * (sx / Math.max(1, maxScroll(d)));
    const yb = oy + d.top + d.bodyH + d.bar / 2 + 2;
    ctx.roundRect(ox + inset, yb - 2, trackW, 4, 2);
    fillTint(g, c.ink, 0.06);
    ctx.roundRect(tx, yb - 2, w, 4, 2);
    g.fillStyle = c.control;
    g.fill();
  }
}

// ---------------------------------------------------------------- press

function pressFlow(ctx: PressContext): void {
  const geo = geoOf(ctx.target.box)?.geo;
  const detail = ctx.target.detail;
  if (!geo || typeof detail !== "string" || !detail.startsWith("step:")) return;
  const n = geo.nodes.find((x) => stepDetail(x) === detail);
  if (!n) return;
  const bind = ctx.props(ctx.target.node).raw("bind");
  if (bind) ctx.set(bind, n.key);
  runOn(ctx);
}

/** What a step says to a screen reader and in Copy text: its label and where it leads, in words (an arrow sign is read out as "right arrow"). */
function stepName(d: FlowGeometry, n: FNode): string {
  const outs = d.edges.filter((e) => e.from === n).map((e) => (e.label ? `${e.to.label} (${e.label})` : e.to.label));
  return outs.length ? `${n.label} leads to ${outs.join(", ")}` : n.label;
}

// ---------------------------------------------------------------- definition

export const flow: ComponentDef = {
  type: "flow",
  category: "data",
  description: "Boxes joined by arrows, laid out automatically from a list of steps and where each leads: an approval process, a customer journey, a decision tree. Never give positions.",
  text: { description: "The title above the flow, e.g. Claim approval." },
  props: {
    items: { type: "expression", required: true, description: `The list of steps, e.g. items=steps. At most ${MAX_FLOW_NODES}.` },
    id: { type: "name", default: "id", description: "The field that identifies each step." },
    label: { type: "name", default: "label", description: "The field with what each box says." },
    next: { type: "name", default: "next", description: "The field with where a step leads: one id, a list of ids, or ids separated by commas. Leave it empty on the last step." },
    kind: { type: "name", default: "kind", description: "The field with each step's shape: step (a box), decision (a diamond), start or end (a pill)." },
    edges: { type: "expression", description: "Labels for arrows, as a list of {from, to, label}, e.g. the Yes and No out of a decision." },
    direction: { type: "enum", values: DIRECTIONS, default: "down", description: "Which way it runs: down or right. When right doesn't fit its space, it runs down instead." },
    bind: { type: "state", description: "State that holds the selected step's id. Pressing a step sets it." },
    on: onProp("after a step is selected, with bind= already set"),
  },
  picks: [
    { for: "a process, journey or decision tree", write: "flow items=steps next=next kind=kind" },
  ],
  example: `state picked="" steps=[{id: "in", label: "Claim filed", kind: "start", next: "check"}, {id: "check", label: "Under $5,000?", kind: "decision", next: "auto,review"}, {id: "auto", label: "Approve automatically", next: "pay"}, {id: "review", label: "Adjuster review", next: "pay"}, {id: "pay", label: "Pay out", kind: "end"}]
state edges=[{from: "check", to: "auto", label: "Yes"}, {from: "check", to: "review", label: "No"}]
flow "Claim approval" items=steps edges=edges bind=picked`,
  minWidth: () => 200,
  layout(box, ctx) {
    const d = flowLayout(box, ctx);
    box.data = d as unknown as Box["data"];
    box.h = d.top + d.bodyH + d.bar;
  },
  fullWidth(box) {
    const d = box.data as unknown as FlowGeometry | undefined;
    return d && d.message === undefined ? d.contentW + 1 : box.w;
  },
  paint: paintFlow,
  hitTest(box, x, _y, detail) {
    const d = box.data as unknown as FlowPart | undefined;
    if (!d?.geo || detail === SCROLL_AREA) return { detail };
    if (d.hidden) return null;
    return x >= d.x && x <= d.x + d.geo.viewW ? { detail } : null;
  },
  press: pressFlow,
  drag(ctx) {
    const v = ctx.view(ctx.target.node);
    const geo = geoOf(ctx.target.box)?.geo;
    if (ctx.phase === "start") { v.dragX = ctx.x; v.dragFrom = v.x ?? 0; v.dragMoved = 0; return false; }
    const dx = ctx.x - (v.dragX ?? ctx.x);
    if (ctx.phase === "move") {
      if (!geo || !maxScroll(geo) || (!v.dragMoved && Math.abs(dx) < DRAG_SLOP)) return false;
      v.dragMoved = 1;
      scrollTo(v, geo, (v.dragFrom ?? 0) - dx);
      return false;
    }
    const moved = !!v.dragMoved;
    delete v.dragX; delete v.dragFrom; delete v.dragMoved;
    if (!moved) pressFlow(ctx);
    return false;
  },
  wheel(ctx) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const dx = ctx.deltaX || (ctx.shiftKey ? ctx.deltaY : 0);
    if (!dx) return false;
    const v = ctx.view(ctx.target.node);
    return scrollTo(v, geo, (v.x ?? 0) + dx);
  },
  key(ctx, key) {
    const geo = geoOf(ctx.target.box)?.geo;
    if (!geo || !maxScroll(geo)) return false;
    const v = ctx.view(ctx.target.node);
    const x = v.x ?? 0;
    const to = key === "ArrowRight" ? x + ARROW_STEP : key === "ArrowLeft" ? x - ARROW_STEP : key === "Home" ? 0 : key === "End" ? maxScroll(geo) : null;
    return to !== null && scrollTo(v, geo, to);
  },
  cursor: (target) => (target.detail === SCROLL_AREA ? "default" : "pointer"),
  semantics(box, ctx) {
    const d = box.data as unknown as FlowGeometry | undefined;
    const name = ctx.props(box.node).text() || ctx.textBefore() || undefined;
    if (!d) return null;
    if (d.message !== undefined) return d.message ? { role: "text", name: name ? `${name}: ${d.message}` : d.message } : null;
    const selected = ctx.props(box.node).bound();
    const sx = d.scrolled ?? 0;
    const parts: PartSemantics[] = [];
    if (name) parts.push({ detail: "title", role: "heading", level: 3, name, rect: { x: box.x, y: box.y, w: box.w, h: Math.max(1, d.top) } });
    parts.push({ detail: "steps", role: "list", name: name ?? "Steps", rect: { x: box.x, y: box.y + d.top, w: box.w, h: d.bodyH } });
    for (const n of d.nodes) {
      const x = box.x + n.x - sx;
      const l = Math.max(x, box.x), r = Math.min(x + n.w, box.x + box.w);
      parts.push({
        detail: d.pressable ? stepDetail(n) : `item:${n.id}`, within: "steps", role: "listitem", name: stepName(d, n),
        // aria-selected isn't allowed on a list item; the chosen step is the current one.
        current: d.pressable && (selected === n.key || String(selected) === n.id) ? true : undefined,
        rect: r > l ? { x: l, y: box.y + n.y, w: r - l, h: n.h } : { x: x + n.w <= box.x ? box.x : box.x + box.w - 1, y: box.y + n.y, w: 1, h: n.h },
      });
    }
    const focusable = maxScroll(d) > 0 && !d.pressable;
    // A group, so its heading and list of steps are read and copied; it's called a flowchart.
    return { role: "group", name: name ?? "Flow", roleDescription: "flowchart", ...(focusable ? { detail: SCROLL_AREA } : {}), parts };
  },
};
