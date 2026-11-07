/**
 * Interactive scene requests: realistic asks for a diagram people use, and
 * the checks that say whether a model's answer actually works. Run with
 * `npm run scene-eval` (scripts/scene-eval.ts), which sends each request to a
 * model with the scene elements turned on and scores the result here.
 *
 * Parsing isn't the bar. Each answer is rendered with the real engine and
 * used: its shapes are pressed, its controls are moved, and what changes is
 * looked at. The drawing check's warnings are counted too.
 */
import { parse, type DerivedDef } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes, sceneRegions } from "../src/components/scene";
import { render, type Rendered } from "../src/testing";
import type { Box, SayShapeNode, Value } from "../src/types";

export const SCENE_COMPONENTS = [...coreComponents, ...sceneComponents];

export interface SceneTask {
  id: string;
  request: string;
  /** The fewest things in the picture a person should be able to press. */
  pressable: number;
  /** The request asks for motion (a moving vehicle, flowing traffic). */
  moves: boolean;
  /** The request asks for a control outside the picture that changes it. */
  control: boolean;
}

export const sceneTasks: SceneTask[] = [
  {
    id: "factory",
    request: "Show production line 2 as a live diagram: a cutter, a press, a welder and a packer on one conveyor, with each machine's health (cutter 95%, press 70%, welder 40%, packer 88%) and parts moving along the belt. Let me press a machine to see its temperature and output in a panel, and add a switch that stops the line.",
    pressable: 4, moves: true, control: true,
  },
  {
    id: "network",
    request: "Draw our network: a firewall, a load balancer, three app servers (app-1 healthy, app-2 slow at 900 ms, app-3 down) and a database. Make the unhealthy servers stand out, let me press any server to see its CPU, memory and status, and let me hide the healthy ones with a toggle.",
    pressable: 3, moves: false, control: true,
  },
  {
    id: "shipment",
    request: "Track shipment SH-2231 from Rotterdam to Chicago through New York: show the route, the truck or ship moving along it, and the three stops. Pressing a stop shows when it arrived or is expected. Add a slider to replay the trip day by day (12 days).",
    // The vehicle may move with time or with the replay slider; the slider is checked as the control.
    pressable: 3, moves: false, control: true,
  },
  {
    id: "floorplan",
    request: "Show the 3rd floor plan of our office: four meeting rooms (Aspen seats 4, Birch seats 8, Cedar seats 12, Dune seats 6) and the open desk area. Color rooms by whether they're free right now (Aspen and Cedar are busy), and let me press a room to see its capacity and next booking, then book it.",
    pressable: 4, moves: false, control: true,
  },
  {
    id: "warehouse",
    request: "Lay out warehouse zone B: six shelving racks in two rows, each with a stock level (A1 90%, A2 15%, A3 60%, B1 5%, B2 75%, B3 40%). Highlight racks under 20%, let me press a rack to see its top items, and filter to only low racks with a switch.",
    pressable: 6, moves: false, control: true,
  },
  {
    id: "process",
    request: "Show our bottling process as a flow: wash, fill, cap, label and pack, with the units per hour at each step (1200, 1150, 1180, 900, 1100). Make the bottleneck obvious, animate bottles moving through, and let me press a step to see its operator and downtime this week.",
    pressable: 5, moves: true, control: false,
  },
  {
    id: "incident",
    request: "Incident INC-4410: draw the dependency diagram for checkout. The payments service is failing, which affects checkout and orders; search and catalog are fine; auth is degraded. Let me press a service to see its status, owner and error rate, and switch between showing all services and only affected ones.",
    pressable: 5, moves: false, control: true,
  },
  {
    id: "diagnostics",
    request: "An interactive diagram of air compressor C-7 for a technician: motor, pump, tank, pressure valve and filter, each with a sensor reading (motor 78 °C, pump 6.2 bar, tank 8.1 bar, valve open, filter 85% clogged). Flag the parts out of range, press a part to see its normal range and what to check, and add a slider to simulate tank pressure.",
    pressable: 5, moves: false, control: true,
  },
];

export interface SceneScore {
  errors: string[];
  warnings: string[];
  drawing: string[];
  hasScene: boolean;
  /** Pressable things found in the picture. */
  pressable: number;
  /** How many of them changed something a person sees (the panel, the picture) when pressed. */
  pressesWork: number;
  /** A press shows which one is selected (an outline from selected=, or the picture changing). */
  showsSelection: boolean;
  /** Pressable things a keyboard reaches with Tab. */
  keyboard: number;
  /** A control outside the scene changed state that the scene reads. */
  controlChangesScene: boolean | null;
  /** The scene moves (duration > 0 and something reads t). */
  moves: boolean;
  engineWarnings: string[];
  /** Everything the task asked for that this answer does. */
  passes: boolean;
  failures: string[];
}

const CONTROLS = ["switch", "slider", "segmented", "select", "check", "button", "stepper", "radio", "tabs"];

/** Render a spec and use it. Never throws. */
export function scoreScene(task: SceneTask, spec: string, width = 900): SceneScore {
  const registry = new Registry(SCENE_COMPONENTS);
  const parsed = parse(spec, registry);
  const errors = parsed.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.line}: ${d.message}`);
  const warnings = parsed.diagnostics.filter((d) => d.severity === "warning").map((d) => `${d.line}: ${d.message}`);
  const drawing = reviewScenes(parsed).map((d) => `${d.line}: ${d.message}`);
  const out: SceneScore = {
    errors, warnings, drawing, hasScene: false, pressable: 0, pressesWork: 0, showsSelection: false, keyboard: 0,
    controlChangesScene: null, moves: false, engineWarnings: [], passes: false, failures: [],
  };
  let ui: Rendered | null = null;
  try {
    ui = render(spec, { components: SCENE_COMPONENTS, width });
    const scenes = ui.findAll({ type: "scene" }).filter((f) => f.box);
    out.hasScene = scenes.length > 0;
    const scene = scenes[0];
    if (scene) {
      out.moves = Number(scene.node.props.duration ?? 0) > 0 && /\bt\b/.test(subtreeText(scene.node));
      const regions = () => ui!.hits.filter((h) => h.box.node.id === scene.node.id);
      out.pressable = regions().length;
      const keys = regions().map((h) => h.detail);
      // Press each one where it is now. It works if it changed state, or if it's the
      // one marked selected afterwards (pressing what's already chosen changes nothing).
      // Not "what's shown changed": a click also shows the tip, which an action that
      // failed would still pass.
      for (const key of keys) {
        const h = regions().find((r) => r.detail === key);
        if (!h) continue;
        const at = pointIn(ui, scene.node, String(key), h.box);
        const before = JSON.stringify(ui.state);
        ui.click(at[0], at[1]);
        const r = sceneRegions(scene.node)?.regions.get(String(key));
        if (JSON.stringify(ui.state) !== before || r?.selected) out.pressesWork++;
        if (r?.selected) out.showsSelection = true;
      }
      // Keyboard: Tab through everything and count the scene's parts reached.
      const reached = new Set<string>();
      for (let i = 0; i < ui.hits.length + 2; i++) {
        ui.tab();
        const f = ui.sayshape.focus;
        if (f && f.node.id === scene.node.id) reached.add(String(f.detail));
      }
      out.keyboard = reached.size;
      out.controlChangesScene = task.control ? controlChangesScene(ui, scene.node, parsed.derived) : null;
    }
    out.engineWarnings = [...ui.warnings];
  } catch (e) {
    out.engineWarnings.push(`threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ui?.destroy();
  }
  const fail = (ok: boolean, why: string) => { if (!ok) out.failures.push(why); };
  fail(!errors.length, "parser errors");
  fail(out.hasScene, "answered without a scene");
  fail(out.pressable >= task.pressable, `${out.pressable} pressable, wanted ${task.pressable}`);
  fail(out.pressesWork >= task.pressable, `${out.pressesWork} presses worked, wanted ${task.pressable}`);
  fail(out.keyboard >= Math.min(task.pressable, out.pressable), "not every pressable part is reachable by Tab");
  if (task.moves) fail(out.moves, "doesn't move");
  if (task.control) fail(out.controlChangesScene === true, "no control outside the picture changes it");
  fail(!out.engineWarnings.length, "engine warnings");
  out.passes = !out.failures.length;
  return out;
}

/** Everything shown: text drawn on the canvas and the state, so a picture-only change counts too. */
function subtreeText(node: SayShapeNode): string {
  return [JSON.stringify(node.props), node.text ?? "", ...node.children.map(subtreeText)].join(" ");
}

/** A point on the region's shapes (not just inside its box), found by sampling its box. */
function pointIn(ui: Rendered, scene: SayShapeNode, key: string, box: Box): [number, number] {
  for (let gy = 1; gy < 8; gy++) {
    for (let gx = 1; gx < 8; gx++) {
      const x = box.x + (box.w * gx) / 8, y = box.y + (box.h * gy) / 8;
      const t = ui.sayshape.targetAt(x, y);
      if (t && t.node.id === scene.id && String(t.detail) === key) return [x, y];
    }
  }
  return [box.x + box.w / 2, box.y + box.h / 2];
}

/**
 * Use each control outside the scene: every pressable part of it (each
 * option of a segmented, both ends of a slider). True when one changes state
 * the scene's lines read, directly or through derive.
 */
function controlChangesScene(ui: Rendered, scene: SayShapeNode, derived: readonly DerivedDef[]): boolean {
  const read = subtreeText(scene);
  const reads = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    return new RegExp(`\\b${name}\\b`).test(read) || derived.some((d) => d.reads.includes(name) && reads(d.name, seen));
  };
  for (const type of CONTROLS) {
    for (const f of ui.findAll({ type }).filter((x) => x.box && !isInside(x.node, scene))) {
      const tries: Array<() => void> = type === "slider"
        ? [0.1, 0.9].map((u) => () => ui.drag({ id: f.node.id }, f.box!.x + f.box!.w * u))
        : ui.hits.filter((h) => h.box.node.id === f.node.id).map((h) => () => ui.click(h.box.x + h.box.w / 2, h.box.y + h.box.h / 2));
      for (const go of tries) {
        const before = ui.state;
        try { go(); } catch { continue; }
        const after = ui.state;
        const changed = Object.keys(after).filter((k) => JSON.stringify(after[k] as Value) !== JSON.stringify(before[k] as Value));
        if (changed.some((k) => reads(k))) return true;
      }
    }
  }
  return false;
}

function isInside(node: SayShapeNode, scene: SayShapeNode): boolean {
  const walk = (n: SayShapeNode): boolean => n.id === node.id || n.children.some(walk);
  return walk(scene);
}
