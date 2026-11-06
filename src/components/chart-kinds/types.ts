/**
 * The contract for a chart kind that lives in its own module. chart.ts keeps
 * what every kind shares (props, loading, the title, messages, hover and the
 * tooltip) and hands the rest to the kind: working out its geometry in
 * layout, and drawing it in paint. Kinds are built from chart-kit.ts.
 */
import type { Box, Value } from "../../types";
import type { ChartGeometry, Ctx, Format, PaintCtx } from "../chart-kit";

/** What chart.ts reads from the element's props before calling a kind. */
export interface KindInput {
  /** items=, evaluated: usually a list of records. */
  items: Value | undefined;
  /** x=: the field holding each item's label. */
  x: string;
  /** The first field of y=. These kinds show one number per item. */
  y: string;
  format: Format;
  title: string;
  /** The element's line in the spec, for warnings. */
  line: number;
  /** Props only some kinds read, as written (waterfall's total=). */
  extra: Readonly<Record<string, string>>;
}

export interface ChartKindDef {
  /** Which existing kind's placeholder to draw while the data loads. */
  loadingAs: "bar" | "hbar";
  /**
   * Work out the geometry, relative to the box, headless (ctx.measure only).
   * Put the kind's own parts on g.custom; fill g.slots with a bar per item
   * so hover and the tooltip work as they do for bars.
   */
  layout(box: { w: number }, input: KindInput, ctx: Ctx): { g: ChartGeometry; h: number };
  /** Draw it. chart.ts has already drawn the title and handled messages. */
  paint(box: Box, ctx: PaintCtx, d: ChartGeometry, reveal: number): void;
}
