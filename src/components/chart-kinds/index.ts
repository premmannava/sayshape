/**
 * Chart kinds that live in their own modules. chart.ts looks a kind up here
 * first; bar, hbar, line, pie and donut are still drawn by chart.ts itself.
 * To add a kind: write a ChartKindDef from chart-kit.ts parts, add its name
 * to KINDS in chart-kit.ts, register it here, and describe it in chart's
 * kind= prop so the model guide tells models about it.
 */
import { area } from "./area";
import { bullet } from "./bullet";
import { funnel } from "./funnel";
import { heatmap } from "./heatmap";
import { scatter } from "./scatter";
import { treemap } from "./treemap";
import { sankey } from "./sankey";
import { stacked } from "./stacked";
import type { ChartKindDef } from "./types";
import { waterfall } from "./waterfall";

export const CHART_KINDS: Readonly<Record<string, ChartKindDef>> = Object.freeze({ funnel, waterfall, stacked, area, bullet, heatmap, scatter, treemap, sankey });

export type { ChartKindDef, KindInput } from "./types";
export type { StackedGeometry, StackSegment } from "./stacked";
export type { AreaGeometry } from "./area";
export { bulletTone, pairText, MAX_BULLET_ROWS, WARN_SHARE, type BulletGeometry, type BulletRow, type BulletTone } from "./bullet";
export { heatShade, MIN_HEATMAP_CELL, type HeatCell, type HeatmapGeometry } from "./heatmap";
export { MAX_SCATTER_GROUPS, type ScatterDot, type ScatterGeometry } from "./scatter";
export { MAX_TREEMAP_ITEMS, squarify, type TreemapCell, type TreemapGeometry } from "./treemap";
export { MAX_SANKEY_LINKS, MAX_SANKEY_NODES, paintSankeyHover, sankeyLinkAt, type SankeyGeometry, type SankeyLink, type SankeyNode } from "./sankey";
export { MAX_FUNNEL_STAGES, type FunnelGeometry, type FunnelStage } from "./funnel";
export { barText } from "../chart-kit";
export { changeText, type WaterfallBar, type WaterfallGeometry } from "./waterfall";
