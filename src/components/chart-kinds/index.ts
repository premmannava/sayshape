/**
 * Chart kinds that live in their own modules. chart.ts looks a kind up here
 * first; bar, hbar, line, pie and donut are still drawn by chart.ts itself.
 * To add a kind: write a ChartKindDef from chart-kit.ts parts, add its name
 * to KINDS in chart-kit.ts, register it here, and describe it in chart's
 * kind= prop so the model guide tells models about it.
 */
import { funnel } from "./funnel";
import type { ChartKindDef } from "./types";
import { waterfall } from "./waterfall";

export const CHART_KINDS: Readonly<Record<string, ChartKindDef>> = Object.freeze({ funnel, waterfall });

export type { ChartKindDef, KindInput } from "./types";
export { MAX_FUNNEL_STAGES, type FunnelGeometry, type FunnelStage } from "./funnel";
export { barText, changeText, type WaterfallBar, type WaterfallGeometry } from "./waterfall";
