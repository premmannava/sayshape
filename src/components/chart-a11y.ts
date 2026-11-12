/**
 * What a chart is to a screen reader: a figure named by its title, a
 * one-sentence summary of what it shows (the range, the highest and lowest,
 * the largest share), and the numbers it draws as a table, so someone who
 * can't see the plot gets the same answer as someone who can.
 */
import { layersSummary } from "./chart-layers";
import type { ElementSemantics, PartSemantics, SemanticsContext } from "../a11y/semantics";
import { fieldOf, isList, isRecord } from "../data";
import type { Box } from "../types";
import { chartSeries, FORMATS, KINDS, labelOf, MAX_CHART_ITEMS, numberAt, preciseText, shareText, type ChartGeometry, type Format, type Kind } from "./chart-kit";

const KIND_NAMES: Record<Kind, string> = {
  bar: "Bar chart", hbar: "Bar chart", line: "Line chart", area: "Area chart", stacked: "Stacked bar chart",
  pie: "Pie chart", donut: "Donut chart", funnel: "Funnel chart", waterfall: "Waterfall chart", bullet: "Bullet chart", heatmap: "Heatmap", scatter: "Scatter chart", treemap: "Treemap", sankey: "Sankey diagram",
};

/** A table of rows of text, as parts inside a figure: a header row, then a row per item. */
function tableParts(name: string, header: string[], rows: string[][]): PartSemantics[] {
  const parts: PartSemantics[] = [{ detail: "table", role: "table", name }];
  parts.push({ detail: "head", within: "table", role: "row" });
  header.forEach((h, j) => parts.push({ detail: `head:${j}`, within: "head", role: "columnheader", name: h }));
  rows.forEach((r, i) => {
    parts.push({ detail: `row:${i}`, within: "table", role: "row" });
    r.forEach((c, j) => parts.push({ detail: `cell:${i}:${j}`, within: `row:${i}`, role: j === 0 ? "rowheader" : "cell", name: c }));
  });
  return parts;
}

const extremes = (pairs: Array<{ label: string; value: number }>) => {
  let hi = pairs[0]!, lo = pairs[0]!;
  for (const p of pairs) {
    if (p.value > hi.value) hi = p;
    if (p.value < lo.value) lo = p;
  }
  return { hi, lo };
};

/**
 * How two numbers go together, in words, from their correlation: the
 * sentence a person would say looking at the dots. Nothing is claimed when
 * there are too few dots or no clear pattern.
 */
export function relation(dots: ReadonlyArray<{ x: number; y: number }>, xName: string, yName: string): string {
  const n = dots.length;
  // Too few dots to call a pattern.
  if (n < 5) return "";
  const mx = dots.reduce((a, d) => a + d.x, 0) / n, my = dots.reduce((a, d) => a + d.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const d of dots) { sxy += (d.x - mx) * (d.y - my); sxx += (d.x - mx) ** 2; syy += (d.y - my) ** 2; }
  if (!(sxx > 0 && syy > 0)) return "";
  const r = sxy / Math.sqrt(sxx * syy);
  if (!Number.isFinite(r)) return "";
  if (Math.abs(r) < 0.4) return `No clear pattern between ${xName} and ${yName}.`;
  return `${yName} ${Math.abs(r) >= 0.7 ? "mostly" : "tends to"} ${r > 0 ? "rise" : "fall"}${Math.abs(r) >= 0.7 ? "s" : ""} as ${xName} rises.`;
}

export function chartSemantics(box: Box, ctx: SemanticsContext): ElementSemantics {
  const p = ctx.props(box.node);
  const kind = p.oneOf("kind", KINDS, "bar");
  const format: Format = p.oneOf("format", FORMATS, "number");
  const name = p.text() || ctx.textBefore() || KIND_NAMES[kind];
  const figure = (description: string | undefined, parts?: PartSemantics[]): ElementSemantics =>
    ({ role: "figure", roleDescription: KIND_NAMES[kind].toLowerCase(), name, description, parts });
  const geo = box.data as ChartGeometry | undefined;
  if (geo?.loading) return figure("Loading");
  if (geo?.message) return figure(geo.message);

  const items = p.expr("items");
  const x = p.str("x");
  const ys = p.str("y").split(",").map((s) => s.trim()).filter(Boolean);
  // Exact, as a tooltip shows it, without cents on whole amounts.
  const v = (n: number | null) => (n === null ? "—" : preciseText(n, format).replace(/\.00$/, ""));

  if (kind === "heatmap") {
    // One number across two dimensions: a row per item, with both of its labels.
    const rowsField = p.str("rows"), y = ys[0] ?? "";
    const list = isList(items) ? items.slice(0, MAX_CHART_ITEMS * 4) : [];
    const cells = list.filter(isRecord).map((it) => ({ row: labelOf(fieldOf(it, rowsField)), col: labelOf(fieldOf(it, x)), value: numberAt(it, y) }));
    const known = cells.filter((c) => c.value !== null) as Array<{ row: string; col: string; value: number }>;
    if (!known.length) return figure("No values to show");
    const { hi, lo } = extremes(known.map((c) => ({ label: `${c.row}, ${c.col}`, value: c.value })));
    const summary = `${new Set(cells.map((c) => c.row)).size} rows by ${new Set(cells.map((c) => c.col)).size} columns. Highest: ${hi.label}, ${v(hi.value)}. Lowest: ${lo.label}, ${v(lo.value)}.`;
    return figure(summary, tableParts(name, [rowsField, x, y], cells.map((c) => [c.row, c.col, v(c.value)])));
  }

  if (kind === "sankey") {
    // Flows: a row per flow, from, to and how much, as written.
    const fromF = p.str("from"), toF = p.str("to"), y = ys[0] ?? "";
    const list = isList(items) ? items.slice(0, MAX_CHART_ITEMS) : [];
    // A place's name is text, a number or true/false, as the chart reads it.
    const nameOf = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? labelOf(v) : "");
    const flows = list.filter(isRecord).map((it) => ({ from: nameOf(fieldOf(it, fromF)), to: nameOf(fieldOf(it, toF)), value: numberAt(it, y) }));
    const known = flows.filter((f) => f.value !== null && f.value > 0 && f.from.trim() && f.to.trim()) as Array<{ from: string; to: string; value: number }>;
    if (!known.length) return figure("No values to show");
    const nodes = new Set(known.flatMap((f) => [f.from, f.to]));
    const sources = [...nodes].filter((n) => !known.some((f) => f.to === n));
    const total = known.filter((f) => sources.includes(f.from)).reduce((a, f) => a + f.value, 0);
    const big = known.reduce((a, f) => (f.value > a.value ? f : a), known[0]!);
    const summary = `${known.length} ${known.length === 1 ? "flow" : "flows"} between ${nodes.size} places, ${v(total)} in all from ${sources.slice(0, 4).join(", ")}${sources.length > 4 ? " and more" : ""}. Largest: ${big.from} to ${big.to}, ${v(big.value)}.`;
    return figure(summary, tableParts(name, [fromF || "from", toF || "to", y], flows.map((f) => [f.from, f.to, v(f.value)])));
  }

  if (kind === "scatter") {
    // Two numbers per item: a row per dot, in x order, as the arrow keys go.
    const y = ys[0] ?? "", labelF = p.str("label"), sizeF = p.str("size"), groupF = p.str("group");
    const [xn, yn] = p.str("labels").split(",").map((s) => s.trim());
    const xName = xn || x, yName = yn || y;
    const list = isList(items) ? items.slice(0, MAX_CHART_ITEMS) : [];
    const dots = list.flatMap((it, i) => {
      const xv = numberAt(it, x), yv = numberAt(it, y);
      if (xv === null || yv === null) return [];
      return [{ label: labelF && isRecord(it) ? labelOf(fieldOf(it, labelF)) : `Item ${i + 1}`, x: xv, y: yv, size: sizeF ? numberAt(it, sizeF) : null, group: groupF && isRecord(it) ? labelOf(fieldOf(it, groupF)) : "" }];
    }).sort((a, b) => a.x - b.x || a.y - b.y);
    if (!dots.length) return figure("No values to show");
    const num = (n: number) => preciseText(n, "number");
    const span = (name_: string, vals: number[], f: (n: number) => string) => {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return lo === hi ? `${name_} is ${f(lo)}` : `${name_} from ${f(lo)} to ${f(hi)}`;
    };
    const summary = [`${dots.length} ${dots.length === 1 ? "dot" : "dots"}.`, `${span(xName, dots.map((d) => d.x), num)}; ${span(yName, dots.map((d) => d.y), v)}.`, relation(dots, xName, yName)].filter(Boolean).join(" ");
    const head = [labelF || "Item", xName, yName, ...(sizeF ? [sizeF] : []), ...(groupF ? [groupF] : [])];
    const rows = dots.map((d) => [d.label, num(d.x), v(d.y), ...(sizeF ? [d.size === null ? "—" : num(d.size)] : []), ...(groupF ? [d.group] : [])]);
    // The dots as a list of options, the keyboard's way through them (one Tab stop, the arrow
    // keys between dots); copying skips it, since the table holds the same numbers.
    const custom = geo?.custom as { dots?: Array<{ name: string; x: number; y: number; r: number }>; active?: number } | undefined;
    const shown = custom?.dots ?? [];
    const at = custom?.active ?? 0;
    const options: PartSemantics[] = shown.length ? [
      { detail: "dots", role: "listbox", name: `${name}: dots`, description: "Arrow keys move between dots" },
      ...shown.map((dot, i): PartSemantics => ({ detail: `dot:${i}`, within: "dots", role: "option", name: dot.name, selected: i === at, rect: { x: box.x + dot.x - dot.r, y: box.y + dot.y - dot.r, w: 2 * dot.r, h: 2 * dot.r } })),
    ] : [];
    return figure(summary, [...options, ...tableParts(name, head, rows)]);
  }

  const target = kind === "bullet" ? p.str("target") : "";
  const fields = target ? [ys[0] ?? "", target] : kind === "pie" || kind === "donut" || kind === "funnel" || kind === "waterfall" || kind === "treemap" ? ys.slice(0, 1) : ys;
  const labels = p.str("labels").split(",").map((s) => s.trim());
  const seriesNames = fields.map((f, k) => (f === target ? "Target" : labels[k] || f));
  const d = chartSeries(items, x, fields);
  if (d.problem) return figure("No values to show");

  const first = d.slots.map((s) => ({ label: s.label, value: s.values[0] ?? null }));
  const known = first.filter((s) => s.value !== null) as Array<{ label: string; value: number }>;
  const n = d.slots.length;
  const items_ = `${n} ${n === 1 ? "item" : "items"}`;
  let summary = items_ + ".";
  if (known.length) {
    const { hi, lo } = extremes(known);
    if (kind === "treemap") {
      // Largest first, as drawn, with each one's share.
      const positive = known.filter((s) => s.value > 0);
      const total = positive.reduce((a, s) => a + s.value, 0);
      const top = [...positive].sort((a, b) => b.value - a.value).slice(0, 3);
      const folded = (geo?.custom as { folded?: number } | undefined)?.folded ?? 0;
      summary = `${positive.length} ${positive.length === 1 ? "part" : "parts"}, total ${v(total)}. Largest: ${top.map((s) => `${s.label}, ${v(s.value)} (${shareText(total ? s.value / total : 0)})`).join("; ")}.${folded ? ` The smallest ${folded} are drawn together as one.` : ""}`;
    } else if (kind === "pie" || kind === "donut") {
      const total = known.reduce((a, s) => a + Math.max(0, s.value), 0);
      summary = `${items_}, total ${v(total)}. Largest: ${hi.label}, ${v(hi.value)} (${shareText(total ? hi.value / total : 0)}).`;
    } else if (kind === "funnel") {
      const a = known[0]!, b = known[known.length - 1]!;
      summary = `${n} stages, from ${a.label} (${v(a.value)}) to ${b.label} (${v(b.value)}), ${shareText(a.value ? b.value / a.value : 0)} of the first.`;
    } else if (kind === "waterfall") {
      const total = known.reduce((a, s) => a + s.value, 0);
      summary = `${n} changes adding up to ${v(total)}. Largest rise: ${hi.label}, ${v(hi.value)}. Largest fall: ${lo.label}, ${v(lo.value)}.`;
    } else if (kind === "bullet") {
      const good = p.str("good") === "down";
      const met = d.slots.filter((s) => s.values[0] != null && s.values[1] != null && (good ? s.values[0]! <= s.values[1]! : s.values[0]! >= s.values[1]!)).length;
      summary = `${items_} against their targets: ${met} on target.`;
    } else {
      const series = fields.length > 1 ? ` ${fields.length} series: ${seriesNames.join(", ")}.` : "";
      const trend = kind === "line" || kind === "area" ? ` From ${known[0]!.label}, ${v(known[0]!.value)}, to ${known[known.length - 1]!.label}, ${v(known[known.length - 1]!.value)}.` : "";
      const of = fields.length > 1 ? ` ${seriesNames[0]}` : "";
      summary = `${items_}.${series}${trend} Highest${of}: ${hi.label}, ${v(hi.value)}. Lowest${of}: ${lo.label}, ${v(lo.value)}.`;
    }
  }
  // Layers: levels and notes in the summary, line layers as more columns of the data.
  const L = geo?.layers;
  if (L) summary += layersSummary(L, v);
  const extra = L?.lines ?? [];
  return figure(summary, tableParts(name, [x, ...seriesNames, ...extra.map((ln) => ln.label)], d.slots.map((s, i) => [s.label, ...s.values.map(v), ...extra.map((ln) => v(ln.values[i] ?? null))])));
}
