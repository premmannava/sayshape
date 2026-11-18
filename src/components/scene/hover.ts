/**
 * Hover in scenes: on-hover= and on-leave= on anything pressable, with the
 * same actions as on= (on-hover=set:hov:{p.name}, on-leave="set:hov:''").
 *
 * The engine tells the scene (ComponentDef.hover) which region the mouse
 * moved from and to; never for a finger, so touch has no hover side effects.
 * Like the DOM's mouseenter and mouseleave, entering and leaving follow the
 * chain of pressable lines a region is drawn inside: moving from a group onto
 * a pressable shape in it doesn't leave the group. The chain entered is kept
 * per scene, so on-leave still runs when the region it was over is gone (its
 * if= turned false, the spec changed).
 *
 * A region with only hover actions can be pointed at but isn't a press
 * target: it isn't a Tab stop, a screen-reader button or a tap target, it gets
 * no hover outline (its tip still shows), and the pointer stays an arrow.
 */
import type { ElementView, PressContext, PropDef } from "../../component";
import type { HitTarget, SayShapeNode } from "../../types";
import { SCENE_FUNCTIONS } from "./functions";
import { liveOf, type SceneRegion } from "./interact";

/** Said in full once, on group (and in brief, unlisted, on shapes and use). */
export const HOVER: Record<string, PropDef> = {
  "on-hover": { type: "action", description: "Actions when a mouse moves onto it (never touch): on-hover=set:hov:{p.name}. Shapes too." },
  "on-leave": { type: "action", description: "When it moves off: on-leave=\"set:hov:''\"." },
};
export const HOVER_SHAPE: Record<string, PropDef> = {
  "on-hover": { type: "action", unlisted: true, description: "Like group's on-hover=." },
  "on-leave": { type: "action", unlisted: true, description: "Like group's on-leave=." },
};

/** A line's hover actions, for its region; null when it has none. */
export function hoverActions(node: SayShapeNode): { onHover?: string; onLeave?: string } | null {
  const onHover = node.props["on-hover"]?.trim(), onLeave = node.props["on-leave"]?.trim();
  if (!onHover && !onLeave) return null;
  return { ...(onHover ? { onHover } : {}), ...(onLeave ? { onLeave } : {}) };
}

/** Whether a region is only there for hover: nothing to press or drag. */
export const hoverOnly = (r: SceneRegion): boolean => !r.on && !r.drag;

/** The pressable lines a region is inside, innermost first. */
function chainOf(r: SceneRegion | undefined): SceneRegion[] {
  const out: SceneRegion[] = [];
  for (let at = r; at && out.length < 64; at = at.parent) out.push(at);
  return out;
}

/** What each scene's mouse is inside, innermost first (by the scene's engine-held view, which outlives a re-parse). */
const entered = new WeakMap<ElementView, SceneRegion[]>();

/** ComponentDef.hover for scene: leave what the mouse is no longer inside, innermost first, then enter, outermost first. */
export function sceneHover(ctx: PressContext, from: unknown, to: unknown): void {
  const node = ctx.target.node, view = ctx.view(node);
  const live = liveOf(node);
  const before = entered.get(view) ?? (from === undefined ? [] : chainOf(live?.regions.get(String(from))));
  const after = to === undefined ? [] : chainOf(live?.regions.get(String(to)));
  if (after.length) entered.set(view, after);
  else entered.delete(view);
  const stays = new Set(after.map((r) => r.key)), was = new Set(before.map((r) => r.key));
  const run = (r: SceneRegion, actions: string | undefined) => {
    if (actions) ctx.run(actions, { scope: r.scope, locate: r.locate, functions: SCENE_FUNCTIONS });
  };
  for (const r of before) if (!stays.has(r.key)) run(r, r.onLeave);
  for (const r of [...after].reverse()) if (!was.has(r.key)) run(r, r.onHover);
}

/** ComponentDef.cursor for scene: an arrow over what's only hovered, a hand over what's pressed. */
export function sceneCursor(t: HitTarget): string {
  const r = liveOf(t.node)?.regions.get(String(t.detail));
  return r && hoverOnly(r) ? "default" : "pointer";
}
