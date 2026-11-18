/**
 * z= in a scene: siblings drawn in order of depth.
 *
 * Without z anywhere in a block, its lines draw in written order, as they
 * always did (draw.ts never comes here). With z, the block is walked first:
 * every line it would draw is noted with the scope in force at it (each item
 * and index, lets above it), its z and its place in the order. The notes are
 * sorted by z, ties in written order, then drawn. Copies of each and lines in
 * if blocks join their parent's lines, so a planet inside each can pass behind
 * and in front of a sun written beside the each. Sorting stops at group and
 * use: their own lines sort among themselves, inside them.
 *
 * Pressable shapes are recorded as they're drawn, so the one drawn on top is
 * the one pressed: hits follow the order here with nothing more to do.
 *
 * It takes the walk and the drawing from draw.ts as arguments, so the two
 * modules don't import each other.
 */
import type { Scope } from "../../expr";
import type { Locate } from "../../paths";
import type { SayShapeNode } from "../../types";
import type { Frame } from "./draw";

type Leaf = (node: SayShapeNode, scope: Scope, f: Frame) => void;

/** What drawing by depth needs from draw.ts. */
export interface DepthHooks {
  /** Work through a block's lines (if=, if, each, let), handing each line to draw to leaf. */
  walk: (nodes: readonly SayShapeNode[], scope: Scope, f: Frame, leaf: Leaf) => void;
  /** Draw one line (a shape, group or use). */
  draw: Leaf;
  /** A line's z= in this scope. */
  z: (node: SayShapeNode, scope: Scope) => number;
  /** Stop once the frame has drawn this many shapes. */
  maxShapes: number;
}

const known = new WeakMap<readonly SayShapeNode[], boolean>();

/** Whether a block has a line with z=, here or inside its each and if blocks (not inside group, use or define). */
export function hasDepth(nodes: readonly SayShapeNode[]): boolean {
  let has = known.get(nodes);
  if (has === undefined) {
    has = nodes.some((n) => (n.type === "each" || n.type === "if" ? hasDepth(n.children) : n.props.z !== undefined));
    known.set(nodes, has);
  }
  return has;
}

interface Entry {
  node: SayShapeNode; scope: Scope; z: number; i: number;
  /** Which each copies and uses it's inside, and where its names live in state, for recording presses. */
  copy: string[]; locate: Locate | undefined;
}

/** Draw a block's lines back to front by z (stable: equal z keeps written order). */
export function drawByDepth(nodes: readonly SayShapeNode[], scope: Scope, f: Frame, hooks: DepthHooks): void {
  const entries: Entry[] = [];
  hooks.walk(nodes, scope, f, (node, at) => {
    const z = node.props.z === undefined ? 0 : hooks.z(node, at);
    entries.push({ node, scope: at, z: Number.isFinite(z) ? z : 0, i: entries.length, copy: f.press ? f.press.copy.slice() : [], locate: f.press?.locate });
  });
  entries.sort((a, b) => a.z - b.z || a.i - b.i);
  const rec = f.press;
  const copy = rec?.copy, locate = rec?.locate;
  try {
    for (const e of entries) {
      if (f.shapes >= hooks.maxShapes) return;
      // Groups and uses push onto copy and pop again, so each entry's own copy can be lent out.
      if (rec) { rec.copy = e.copy; if (e.locate) rec.locate = e.locate; }
      hooks.draw(e.node, e.scope, f);
    }
  } finally {
    if (rec && copy) { rec.copy = copy; if (locate) rec.locate = locate; }
  }
}
