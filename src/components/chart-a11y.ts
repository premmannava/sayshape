/**
 * What a chart is to a screen reader: a figure named by its title, a
 * one-sentence summary of what it shows (the range, the highest and lowest,
 * the largest share), and the numbers it draws as a table, so someone who
 * can't see the plot gets the same answer as someone who can.
 */
import type { ElementSemantics, PartSemantics, SemanticsContext } from "../a11y/semantics";
import { fieldOf, isList, isRecord } from "../data";
import type { Box } from "../types";
import { chartSeries, FORMATS, KINDS, labelOf, MAX_CHART_ITEMS, numberAt, preciseText, shareText, type ChartGeometry, type Format, type Kind } from "./chart-kit";

const KIND_NAMES: Record<Kind, string> = {
  bar: "Bar chart", hbar: "Bar chart", line: "Line chart", area: "Area chart", stacked: "Stacked bar chart",
  pie: "Pie chart", donut: "Donut chart", funnel: "Funnel chart", waterfall: "Waterfall chart", bullet: "Bullet chart", heatmap: "Heatmap",
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

  const target = kind === "bullet" ? p.str("target") : "";
  const fields = target ? [ys[0] ?? "", target] : kind === "pie" || kind === "donut" || kind === "funnel" || kind === "waterfall" ? ys.slice(0, 1) : ys;
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
    if (kind === "pie" || kind === "donut") {
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
  return figure(summary, tableParts(name, [x, ...seriesNames], d.slots.map((s) => [s.label, ...s.values.map(v)])));
}
