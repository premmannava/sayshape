/**
 * Canvas-only geographic data visualization. No tiles, external services,
 * mapping libraries or geographic navigation/routing dependencies.
 * The Natural Earth 1:110m country outlines are embedded in this opt-in entry.
 */
import type { ComponentDef, PressContext } from "../../component";
import type { Box, SayShapeNode } from "../../types";
import world from "./world.json";
import { clusterPoints, type Cluster } from "./clustering";
import { bubbleRadius, bubbleValues, formatMapValue, fraction, mixedColor, regionValues, type BubbleValues, type RegionValues } from "./analytics";
import { drawBubbleLegend, drawChoroplethLegend } from "./legend";
import { overlappingGroups, spiderfy, type SpiderPoint } from "./overlap";
import { layoutBubbleLabels, type LabelCircle } from "./labels";
import { stateBoundaryPaths } from "./states";
import { isList } from "../../data";
import { constrain, fitPins, panBy, worldView, zoomAt, type Viewport } from "./viewport";

interface WorldData { w: number; h: number; k: number; t: [number, number]; c: Array<[string, string]> }
const WORLD = world as unknown as WorldData;

let paths: Array<{ name: string; path: Path2D }> | null = null;
function countryPaths() {
  if (!paths) paths = WORLD.c.map(([name, d]) => ({ name, path: new Path2D(d) }));
  return paths;
}

/** Country names available for matching data values. */
export const COUNTRY_NAMES: readonly string[] = WORLD.c.map((c) => c[0]);

/** Natural Earth I projection, shared with the pre-projected country outlines. */
export function project(lon: number, lat: number): [number, number] {
  const l = (lon * Math.PI) / 180, f = (lat * Math.PI) / 180, f2 = f * f, f4 = f2 * f2;
  const x = l * (0.8707 - 0.131979 * f2 + f4 * (-0.013791 + f4 * (0.003971 * f2 - 0.001529 * f4)));
  const y = f * (1.007226 + f2 * (0.015085 + f4 * (-0.044475 + 0.028874 * f2 - 0.005916 * f4)));
  return [WORLD.t[0] + WORLD.k * x, WORLD.t[1] - WORLD.k * y];
}

let probe: CanvasRenderingContext2D | null = null;
function countryAt(mx: number, my: number): string | null {
  if (!probe && typeof document === "undefined") return null;
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  for (const c of countryPaths()) if (probe.isPointInPath(c.path, mx, my)) return c.name;
  return null;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const PIN_TONES = ["ink", "accent", "good", "warn", "bad", "muted"] as const;
type PinTone = (typeof PIN_TONES)[number];

interface MapPinPoint {
  id: number;
  node: SayShapeNode;
  label: string;
  detail: string;
  x: number;
  y: number;
  tone: PinTone;
  size: number;
  /** Raw data value when this is a proportional bubble rather than a regular pin. */
  value?: number;
}
type MapKind = "markers" | "choropleth" | "bubble";
interface MapDrag {
  startX: number;
  startY: number;
  base: Viewport;
  detail: unknown;
  moved: boolean;
}
interface MapRuntime {
  view: Viewport;
  fitMode: "world" | "pins";
  fitKey: string;
  drag: MapDrag | null;
  /** Expanded location indices are kept only until the dataset or camera changes. */
  spider: { indices: number[]; fingerprint: string } | null;
}
interface MapData {
  scale: number;
  pins: MapPinPoint[];
  groups: Cluster<MapPinPoint>[];
  view: Viewport;
  runtime: MapRuntime;
  fit: "world" | "pins";
  controls: boolean;
  kind: MapKind;
  regions?: RegionValues;
  bubbles?: BubbleValues;
  legend: boolean;
  legendTitle: string;
  fingerprint: string;
  overlaps: number[][];
  spiderPoints: SpiderPoint[];
}
const runtimes = new WeakMap<SayShapeNode, MapRuntime>();
const CONTROLS = ["@map:in", "@map:out", "@map:reset"] as const;
const controlRect = (b: Box, i: number) => ({ x: b.x + b.w - 34, y: b.y + 8 + 32 * i, w: 26, h: 26 });
const details = (b: Box) => b.data as unknown as MapData;
const isControl = (name: unknown): name is (typeof CONTROLS)[number] =>
  typeof name === "string" && (CONTROLS as readonly string[]).includes(name);

function resetView(data: MapData, box: Box): Viewport {
  return data.fit === "pins" ? fitPins(data.pins, box.w, box.h, WORLD.w) : worldView();
}

function activateMap(ctx: PressContext): boolean {
  const box = ctx.target.box;
  const data = details(box);
  const runtime = data.runtime;
  const detail = ctx.target.detail;
  const bind = ctx.props(ctx.target.node).raw("bind");
  const centerX = box.w / 2, centerY = box.h / 2;
  if (detail === "@map:in" || detail === "@map:out" || detail === "@map:reset") {
    runtime.spider = null;
    runtime.view = detail === "@map:reset" ? resetView(data, box) :
      zoomAt(runtime.view, detail === "@map:in" ? 1.7 : 1 / 1.7, centerX, centerY, box.w, box.h);
    return true;
  }
  if (typeof detail === "string" && detail.startsWith("@map:spider:")) {
    const pin = data.pins[Number(detail.slice("@map:spider:".length))];
    if (pin && bind) ctx.set(bind, pin.label);
    return false;
  }
  if (typeof detail === "string" && detail.startsWith("@map:bubble:")) {
    const id = Number(detail.slice("@map:bubble:".length));
    const pin = data.pins[id];
    if (!pin) return false;
    const collision = data.overlaps.find((indices) => indices.includes(id));
    if (collision) {
      runtime.spider = { indices: collision, fingerprint: data.fingerprint };
      return true;
    }
    const wasOpen = !!runtime.spider;
    runtime.spider = null;
    if (bind) ctx.set(bind, pin.label);
    return wasOpen;
  }
  if (typeof detail === "string" && detail.startsWith("@map:cluster:")) {
    const group = data.groups[Number(detail.slice("@map:cluster:".length))];
    if (group && group.items.length > 1) {
      const next = zoomAt(runtime.view, 2.5, group.x, group.y, box.w, box.h);
      if (data.kind === "bubble" && next.zoom === runtime.view.zoom) {
        runtime.spider = { indices: group.items.map((pin) => pin.id), fingerprint: data.fingerprint };
      } else {
        runtime.spider = null;
        runtime.view = next;
      }
      return true;
    }
  }
  // Click outside an expanded group to close it without changing the country selection.
  if (runtime.spider) { runtime.spider = null; return true; }
  if (bind && typeof detail === "string" && !detail.startsWith("@map:")) ctx.set(bind, detail);
  return false;
}

export const map: ComponentDef = {
  type: "map",
  category: "data",
  description: "Canvas map with pin markers, data-driven country choropleths and proportional bubble maps. For data maps, give items plus geographic and numeric field names; Canvas handles colors, sizing and legends.",
  props: {
    kind: { type: "enum", values: ["markers", "choropleth", "bubble"], default: "markers", description: "markers uses pin children; choropleth colors countries from dataset rows; bubble plots sized locations from dataset rows." },
    items: { type: "expression", description: "Data rows for kind=choropleth or kind=bubble, e.g. items=sales. Do not embed individual rows in map specs." },
    region: { type: "name", description: "Country-name column for choropleth, e.g. region=country." },
    value: { type: "name", description: "Numeric column used for country shading or proportional bubble area." },
    lat: { type: "name", description: "Latitude column for bubble maps." },
    lon: { type: "name", description: "Longitude column for bubble maps." },
    label: { type: "name", description: "Location-name column for bubble maps." },
    legend: { type: "boolean", description: "Show a Canvas legend; defaults on for choropleth and bubble, off for markers." },
    legendTitle: { type: "string", description: "Legend title, e.g. Revenue ($) or Project value." },
    highlight: { type: "string", description: "Comma-separated country names to tint, e.g. Japan,Brazil." },
    bind: { type: "state", description: "State name that receives the clicked country or marker label." },
    fit: { type: "enum", values: ["world", "pins"], default: "world", description: "Initial framing: whole world, or zoom to the current pin locations. Re-fits when the pins change." },
    cluster: { type: "boolean", default: false, description: "Group nearby pins into clickable counts. Zooming in separates them." },
    interactive: { type: "boolean", default: true, description: "Enable mouse-wheel zoom and drag pan." },
    controls: { type: "boolean", default: false, description: "Show Canvas zoom in, zoom out and reset controls. Opt in to preserve the original minimal map appearance." },
  },
  children: ["pin"],
  check(props) {
    if (props.kind === "choropleth") {
      return ["items", "region", "value"].filter((key) => !props[key]).map((key) => "choropleth map needs " + key + "=");
    }
    if (props.kind === "bubble") {
      return ["items", "lat", "lon", "label", "value"].filter((key) => !props[key]).map((key) => "bubble map needs " + key + "=");
    }
    return [];
  },
  example: `state selected=""
map bind=selected fit=pins cluster=true controls=true
  pin "Phoenix" lat=33.4484 lon=-112.074 detail="Status: delayed | Contract: 120000" tone=bad size=8`,
  minWidth: () => 200,
  layout(box, ctx) {
    const scale = box.w / WORLD.w;
    box.h = WORLD.h * scale;
    const pins: MapPinPoint[] = [];
    for (const node of ctx.visibleChildren(box.node)) {
      if (node.type !== "pin") continue;
      const p = ctx.props(node);
      const lat = p.num("lat", NaN), lon = p.num("lon", NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        ctx.warn?.("pin on line " + node.line + ": latitude must be -90..90 and longitude -180..180");
        continue;
      }
      const [x, y] = project(lon, lat);
      pins.push({
        id: pins.length, node, label: p.text(), detail: p.str("detail"), x, y,
        tone: p.oneOf("tone", PIN_TONES, "ink"),
        size: Math.max(2, Math.min(18, p.num("size", 5))),
      });
    }
    const p = ctx.props(box.node);
    const kind = p.oneOf("kind", ["markers", "choropleth", "bubble"] as const, "markers");
    const rows = kind !== "markers" ? p.expr("items") : undefined;
    if (kind !== "markers" && p.has("items") && !isList(rows)) {
      ctx.warn?.("map on line " + box.node.line + ": items is not a list; use a dataset such as items=sales");
    }
    let regions: RegionValues | undefined;
    let bubbles: BubbleValues | undefined;
    if (kind === "choropleth") {
      regions = regionValues(rows, p.str("region"), p.str("value"), COUNTRY_NAMES);
      if (regions.ignored) ctx.warn?.("map on line " + box.node.line + ": skipped " + regions.ignored + " invalid or unknown country rows" +
        (regions.unmatched.length ? " (" + regions.unmatched.join(", ") + ")" : ""));
    } else if (kind === "bubble") {
      bubbles = bubbleValues(rows, p.str("lat"), p.str("lon"), p.str("value"), p.str("label"));
      if (bubbles.ignored) ctx.warn?.("map on line " + box.node.line + ": skipped " + bubbles.ignored + " rows with invalid coordinates or negative/non-numeric values");
      for (const point of bubbles.points) {
        const [x, y] = project(point.lon, point.lat);
        const metric = p.str("legendTitle", "Value");
        pins.push({
          id: pins.length, node: box.node, label: point.label,
          detail: metric + ": " + formatMapValue(point.value), x, y,
          tone: "accent", size: bubbleRadius(point.value, bubbles.min, bubbles.max),
          value: point.value,
        });
      }
    }
    const fit = p.oneOf("fit", ["world", "pins"] as const, "world");
    const key = kind + ":" + box.w + ":" + pins.map((pin) => pin.x.toFixed(2) + "," + pin.y.toFixed(2) +
      "," + pin.size.toFixed(2) + "," + pin.label).join(";");
    let runtime = runtimes.get(box.node);
    if (!runtime) {
      runtime = { view: worldView(), fitMode: "world", fitKey: "", drag: null, spider: null };
      runtimes.set(box.node, runtime);
    }
    if (fit !== runtime.fitMode || (fit === "pins" && key !== runtime.fitKey)) {
      runtime.view = fit === "pins" ? fitPins(pins, box.w, box.h, WORLD.w) : worldView();
    }
    if (runtime.fitKey !== key) runtime.spider = null;
    runtime.fitMode = fit;
    runtime.fitKey = key;
    runtime.view = constrain(runtime.view, box.w, box.h);
    const view = runtime.view;
    const visible = pins.map((pin) => ({
      index: pin.id, item: pin, x: pin.x * scale * view.zoom + view.dx, y: pin.y * scale * view.zoom + view.dy,
    })).filter((point) => point.x >= -32 && point.x <= box.w + 32 && point.y >= -32 && point.y <= box.h + 32);
    const groups = p.bool("cluster", false)
      ? clusterPoints(visible)
      : visible.map(({ item, x, y }) => ({ items: [item], x, y }));
    // Collision tests use the *actual drawn radii*, not the fixed clustering distance.
    const overlaps = kind === "bubble" ? overlappingGroups(visible.map(
      ({ x, y, item }) => ({ x, y, radius: item.size }),
    )).map((group) => group.map((i) => visible[i]!.index)) : [];
    const allCircles = pins.map((pin) => ({
      x: pin.x * scale * view.zoom + view.dx,
      y: pin.y * scale * view.zoom + view.dy,
      radius: pin.size,
    }));
    const expanded = runtime.spider;
    const sameIndices = (indices: readonly number[]) =>
      expanded && indices.length === expanded.indices.length && indices.every((id) => expanded.indices.includes(id));
    const active = expanded?.fingerprint === key && (
      overlaps.some(sameIndices) || groups.some((group) =>
        group.items.length > 1 && sameIndices(group.items.map((item) => item.id))));
    if (expanded && !active) runtime.spider = null;
    const spiderPoints = active && expanded ? spiderfy(expanded.indices, allCircles, box.w, box.h) : [];
    box.data = {
      scale, pins, groups, view, runtime, fit, controls: p.bool("controls", false),
      kind, regions, bubbles, legend: p.bool("legend", kind !== "markers"),
      legendTitle: p.str("legendTitle", kind === "choropleth" ? "Country value" : "Location value"),
      fingerprint: key, overlaps, spiderPoints,
    } satisfies MapData;
  },
  paint(box, ctx) {
    const p = ctx.props(box.node);
    const { g, theme } = ctx;
    const c = theme.colors;
    const data = details(box);
    const { scale, view, regions } = data;
    const selected = p.raw("bind") ? p.bound() : null;
    const highlighted = new Set(list(p.str("highlight")));
    const hovered = ctx.hover?.node.id === box.node.id ? ctx.hover.detail : null;
    g.save();
    g.beginPath();
    g.rect(box.x, box.y, box.w, box.h);
    g.clip();
    g.translate(box.x + view.dx, box.y + view.dy);
    g.scale(scale * view.zoom, scale * view.zoom);
    g.lineWidth = 0.7 / (scale * view.zoom);
    g.lineJoin = "round";
    g.strokeStyle = c.surface;
    for (const { name, path } of countryPaths()) {
      const value = regions?.values.get(name);
      const shade = value === undefined
        ? (regions ? mixedColor(c.land, c.muted, 0.22) : c.land)
        : mixedColor(c.land, c.accent, 0.34 + 0.66 * Math.pow(fraction(value, regions!.min, regions!.max), 0.8));
      g.fillStyle = name === selected ? c.accent :
        name === hovered ? c.landHover :
        highlighted.has(name) ? c.landHighlight : shade;
      g.fill(path);
      g.stroke(path);
    }
    // World-level maps remain uncluttered. At regional zoom, local US
    // geography is visible without street tiles or changing map behavior.
    if (view.zoom >= 4) {
      g.globalAlpha = 0.56;
      g.strokeStyle = c.muted;
      g.lineWidth = 1 / (scale * view.zoom);
      for (const statePath of stateBoundaryPaths()) g.stroke(statePath);
      g.globalAlpha = 1;
    }
    g.restore();
    // The full map is hit-testable, including ocean, so drags start everywhere.
    ctx.addHit(box, { focusable: false });
  },
  paintOver(box, ctx) {
    const { g, theme } = ctx;
    const c = theme.colors;
    const data = details(box);
    const selected = ctx.props(box.node).raw("bind") ? ctx.props(box.node).bound() : null;
    const hover = ctx.hover?.node.id === box.node.id ? ctx.hover.detail : null;
    const hoverId = typeof hover === "string" && /^@map:(bubble|spider):\d+$/.test(hover)
      ? Number(hover.split(":")[2]) : -1;
    const expanded = new Set(data.spiderPoints.map((p) => p.index));

    // Only data-driven bubbles get automatic label deconfliction.
    // Traditional pin specs keep the labels they have always displayed.
    const bubbleLabels = new Map<number, { x: number; y: number; text: string }>();
    if (data.kind === "bubble") {
      const candidates: LabelCircle[] = [];
      const addCandidate = (pin: MapPinPoint, x: number, y: number, spider: boolean) => {
        candidates.push({
          id: pin.id, x, y, radius: pin.size, text: pin.label,
          priority: selected === pin.label ? 1000 : hoverId === pin.id ? 900 : spider ? 600 : pin.size,
        });
      };
      for (const group of data.groups) {
        if (group.items.length === 1) {
          const pin = group.items[0]!;
          if (!expanded.has(pin.id)) addCandidate(pin, group.x, group.y, false);
        }
      }
      for (const point of data.spiderPoints) {
        const pin = data.pins[point.index];
        if (pin) addCandidate(pin, point.x, point.y, true);
      }
      const avoid = [];
      if (data.controls) avoid.push({ x: box.w - 40, y: 4, w: 36, h: 105 });
      if (data.legend && data.bubbles?.points.length && box.w >= 180) {
        avoid.push({ x: 4, y: box.h - 105, w: Math.min(212, box.w - 12), h: 101 });
      }
      g.save();
      g.font = ctx.font(600, 12);
      const placements = layoutBubbleLabels(candidates, box.w, box.h, (text) => g.measureText(text).width, avoid);
      g.restore();
      for (const [id, placed] of placements) bubbleLabels.set(id, placed);
    }

    const drawPin = (pin: MapPinPoint, x: number, y: number) => {
      const active = selected === pin.label;
      const over = hoverId === pin.id;
      const alpha = ctx.appear(pin.node);
      if (active || over) {
        g.beginPath();
        g.arc(x, y, pin.size + 5, 0, Math.PI * 2);
        g.globalAlpha = 0.9 * alpha;
        g.lineWidth = active ? 2.5 : 2;
        g.strokeStyle = active ? c.focus : c.accent;
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, pin.size, 0, Math.PI * 2);
      g.globalAlpha = (data.kind === "bubble" ? 0.8 : 1) * alpha;
      g.fillStyle = c[pin.tone];
      g.fill();
      g.globalAlpha = alpha;
      g.lineWidth = data.kind === "bubble" ? 1.7 : 2;
      g.strokeStyle = c.surface;
      g.stroke();
      g.globalAlpha = 1;
      const position = data.kind === "bubble" ? bubbleLabels.get(pin.id) : undefined;
      if (data.kind === "bubble" && !position) return;
      const lx = data.kind === "bubble" ? box.x + position!.x : x + pin.size + 4;
      const ly = data.kind === "bubble" ? box.y + position!.y : y;
      const label = position?.text ?? pin.label;
      g.font = ctx.font(600, 12);
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.lineWidth = 3.5;
      g.strokeStyle = c.surface;
      g.strokeText(label, lx, ly);
      g.fillStyle = c.ink;
      g.fillText(label, lx, ly);
    };

    g.save();
    g.beginPath();
    g.rect(box.x, box.y, box.w, box.h);
    g.clip();
    for (const group of data.groups) {
      const x = box.x + group.x, y = box.y + group.y;
      if (group.items.length > 1) {
        const radius = 14 + Math.min(8, String(group.items.length).length * 2);
        g.beginPath();
        g.arc(x, y, radius, 0, Math.PI * 2);
        g.fillStyle = c.accent;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = c.surface;
        g.stroke();
        g.fillStyle = c.onAccent;
        g.font = ctx.font(700, 12);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(group.items.length), x, y);
        continue;
      }
      const pin = group.items[0]!;
      if (expanded.has(pin.id)) continue;
      drawPin(pin, x, y);
    }
    // Leaders show geographic origins; the exploded positions are only a view aid.
    if (data.spiderPoints.length) {
      g.save();
      g.strokeStyle = c.muted;
      g.globalAlpha = 0.65;
      g.lineWidth = 1.25;
      g.setLineDash([4, 3]);
      for (const point of data.spiderPoints) {
        g.beginPath();
        g.moveTo(box.x + point.sourceX, box.y + point.sourceY);
        g.lineTo(box.x + point.x, box.y + point.y);
        g.stroke();
      }
      g.restore();
      for (const point of data.spiderPoints) {
        const pin = data.pins[point.index];
        if (pin) drawPin(pin, box.x + point.x, box.y + point.y);
      }
    }
    if (data.controls) {
      for (let i = 0; i < CONTROLS.length; i++) {
        const rect = controlRect(box, i);
        g.beginPath();
        g.roundRect?.(rect.x, rect.y, rect.w, rect.h, 6);
        g.fillStyle = c.raised;
        g.fill();
        g.strokeStyle = c.line;
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = c.ink;
        g.font = ctx.font(700, 16);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(["+", "−", "⌂"][i]!, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
      }
    }
    g.restore();
    if (data.legend) {
      if (data.kind === "choropleth" && data.regions?.values.size) {
        drawChoroplethLegend(g, box, theme, data.legendTitle, data.regions.min, data.regions.max);
      } else if (data.kind === "bubble" && data.bubbles?.points.length) {
        drawBubbleLegend(g, box, theme, data.legendTitle, data.bubbles.min, data.bubbles.max);
      }
    }
    const pointer = ctx.pointer;
    if (typeof hover === "string" && pointer && !isControl(hover)) {
      let lines: string[];
      if (hover.startsWith("@map:cluster:")) {
        const group = data.groups[Number(hover.slice("@map:cluster:".length))];
        if (!group || group.items.length < 2) return;
        lines = [group.items.length + " locations",
          data.kind === "bubble" && data.view.zoom >= 128 ? "Click to separate" : "Click to zoom in"];
      } else {
        const pin = hoverId >= 0 ? data.pins[hoverId] : data.pins.find((item) => item.label === hover);
        const value = data.regions?.values.get(hover);
        lines = pin ? [pin.label, ...pin.detail.split("|").map((v) => v.trim()).filter(Boolean)] :
          value !== undefined ? [hover, data.legendTitle + ": " + formatMapValue(value)] : [hover];
        if (pin && data.kind === "bubble" && hover.startsWith("@map:bubble:")) {
          const overlapping = data.overlaps.find((group) => group.includes(pin.id));
          if (overlapping) lines.push("Click to separate " + overlapping.length + " bubbles");
        }
      }
      tooltip(g, lines.slice(0, 5), pointer.x, pointer.y, box, ctx.font(600, 12),
        ctx.font(400, 11), c.raised, c.ink, c.line);
    }
  },
  hitTest(box, x, y) {
    const data = details(box);
    if (data.controls) {
      for (let i = 0; i < CONTROLS.length; i++) {
        const r = controlRect(box, i);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { detail: CONTROLS[i] };
      }
    }
    // Expanded markers sit above the real locations and have independent hit targets.
    for (let i = data.spiderPoints.length - 1; i >= 0; i--) {
      const point = data.spiderPoints[i]!;
      const pin = data.pins[point.index]!;
      const dx = x - box.x - point.x, dy = y - box.y - point.y;
      if (dx * dx + dy * dy <= (pin.size + 4) ** 2) return { detail: "@map:spider:" + pin.id };
    }
    const expanded = new Set(data.spiderPoints.map((p) => p.index));
    for (let i = data.groups.length - 1; i >= 0; i--) {
      const group = data.groups[i]!;
      if (group.items.length === 1 && expanded.has(group.items[0]!.id)) continue;
      const dx = x - box.x - group.x, dy = y - box.y - group.y;
      const radius = group.items.length > 1 ? 20 : group.items[0]!.size + 4;
      if (dx * dx + dy * dy <= radius * radius) {
        return { detail: group.items.length > 1 ? "@map:cluster:" + i :
          data.kind === "bubble" ? "@map:bubble:" + group.items[0]!.id : group.items[0]!.label };
      }
    }
    const scale = data.scale * data.view.zoom;
    const country = countryAt((x - box.x - data.view.dx) / scale, (y - box.y - data.view.dy) / scale);
    return country ? { detail: country } : {};
  },
  press(ctx) {
    activateMap(ctx);
  },
  wheel(ctx) {
    if (!ctx.props(ctx.target.node).bool("interactive", true)) return false;
    const box = ctx.target.box;
    const data = details(box);
    const factor = Math.exp(-Math.max(-600, Math.min(600, ctx.deltaY)) * 0.0015);
    data.runtime.spider = null;
    data.runtime.view = zoomAt(data.runtime.view, factor, ctx.x - box.x, ctx.y - box.y, box.w, box.h);
    return true;
  },
  drag(ctx) {
    const box = ctx.target.box;
    const data = details(box);
    const runtime = data.runtime;
    const interactive = ctx.props(ctx.target.node).bool("interactive", true);
    if (ctx.phase === "start") {
      runtime.drag = { startX: ctx.x, startY: ctx.y, base: runtime.view, detail: ctx.target.detail, moved: false };
      return false;
    }
    const drag = runtime.drag;
    if (!drag) return false;
    if (ctx.phase === "move") {
      if (!interactive) return false;
      const dx = ctx.x - drag.startX, dy = ctx.y - drag.startY;
      if (!drag.moved && dx * dx + dy * dy <= 16) return false;
      drag.moved = true;
      runtime.spider = null;
      runtime.view = panBy(drag.base, dx, dy, box.w, box.h);
      return true;
    }
    runtime.drag = null;
    if (!drag.moved) {
      const changed = activateMap(ctx);
      return changed;
    }
    return true;
  },
  cursor: (target) => target.detail ? "pointer" : "grab",
};

export const pin: ComponentDef = {
  type: "pin",
  category: "data",
  description: "A labelled point on a Canvas map. The optional detail is shown in a multiline hover tooltip.",
  text: { description: "The place name shown next to the pin.", required: true },
  props: {
    lat: { type: "number", required: true, description: "Latitude in degrees (-90 to 90)." },
    lon: { type: "number", required: true, description: "Longitude in degrees (-180 to 180)." },
    detail: { type: "string", description: "Tooltip details; separate lines with |. Supports interpolated dataset expressions." },
    tone: { type: "enum", values: PIN_TONES, default: "ink", description: "Theme color: ink, accent, good, warn, bad or muted." },
    size: { type: "number", default: 5, description: "Marker radius in CSS pixels, clamped to 2..18. Supports expressions." },
  },
  parents: ["map"],
  example: `pin "Phoenix" lat=33.4484 lon=-112.074 tone=bad size=9 detail="Status: delayed | Value: 120000"`,
  layout(box) { box.h = 0; },
};

function tooltip(
  g: CanvasRenderingContext2D, lines: string[], px: number, py: number, box: Box,
  titleFont: string, bodyFont: string, background: string, foreground: string, border: string,
): void {
  g.save();
  const width = Math.min(box.w - 12, Math.max(100, ...lines.map((line, i) => {
    g.font = i === 0 ? titleFont : bodyFont;
    return g.measureText(line).width + 20;
  })));
  const height = 12 + lines.length * 18;
  const x = Math.max(box.x + 4, Math.min(px + 14, box.x + box.w - width - 4));
  const y = Math.max(box.y + 4, Math.min(py - height - 8, box.y + box.h - height - 4));
  g.beginPath();
  g.roundRect?.(x, y, width, height, 6);
  g.fillStyle = background;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = border;
  g.stroke();
  g.fillStyle = foreground;
  g.textAlign = "left";
  g.textBaseline = "middle";
  lines.forEach((line, i) => {
    g.font = i === 0 ? titleFont : bodyFont;
    g.fillText(line, x + 10, y + 15 + i * 18, width - 18);
  });
  g.restore();
}

export const mapComponents = [map, pin];
