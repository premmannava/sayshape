/**
 * What the token benchmark measures for one answer: its size in tokens,
 * whether it draws with no errors, whether every requested part is there, and
 * how many tokens arrive before the first element is drawn while it streams.
 *
 * Tokens are counted with one tokenizer throughout: o200k_base from
 * gpt-tokenizer (a dev dependency). It is not Claude's tokenizer, so absolute
 * numbers differ by model; ratios between variants are what to compare.
 */
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { coreComponents } from "../../src/components";
import { mapComponents } from "../../src/components/map";
import { render, type Rendered } from "../../src/testing";
import type { Value } from "../../src/types";
import type { BenchRequest } from "./requests";

export const TOKENIZER = "o200k_base (gpt-tokenizer)";
export const tokens = (text: string): number => encode(text).length;

export const BENCH_COMPONENTS = [...coreComponents, ...mapComponents];

/** Draw a spec the way a host would: its data set first (by reference), then the spec. */
export function draw(spec: string, state?: Record<string, unknown>, width = 600): Rendered {
  const ui = render("", { components: BENCH_COMPONENTS, width });
  for (const [k, v] of Object.entries(state ?? {})) ui.set(k, v as Value);
  ui.setSpec(spec);
  ui.sayshape.renderNow();
  return ui;
}

/** Whether anything but the root is drawn with a size. */
function painted(ui: Rendered): boolean {
  return ui.findAll({}).some((f) => f.box && f.box.h > 0 && f.box.w > 0);
}

/**
 * Tokens written up to and including the line that first draws an element,
 * cutting the spec at line boundaries as a stream would arrive. undefined when
 * nothing is ever drawn.
 */
export function tokensBeforeFirstPaint(spec: string, state?: Record<string, unknown>): number | undefined {
  const lines = spec.split("\n");
  const ui = render("", { components: BENCH_COMPONENTS, width: 600 });
  for (const [k, v] of Object.entries(state ?? {})) ui.set(k, v as Value);
  for (let i = 1; i <= lines.length; i++) {
    const prefix = lines.slice(0, i).join("\n") + "\n";
    ui.setSpec(prefix);
    ui.sayshape.renderNow();
    if (painted(ui)) return tokens(prefix);
  }
  return undefined;
}

/**
 * Where an answer's tokens go: data (state lines), formulas (derive lines and
 * {…} outside quotes), visible words (quoted text) and structure (the rest:
 * element names, props, indentation). Each piece is tokenized on its own, so
 * the parts add up to about, not exactly, the whole.
 */
export interface Composition { data: number; structure: number; words: number; formulas: number }

export function composition(spec: string): Composition {
  const out: Composition = { data: 0, structure: 0, words: 0, formulas: 0 };
  for (const line of spec.split("\n")) {
    const t = line.trimStart();
    if (!t) continue;
    if (/^state\s/.test(t)) { out.data += tokens(line); continue; }
    if (/^derive\s/.test(t)) { out.formulas += tokens(line); continue; }
    let rest = "";
    let i = 0;
    while (i < line.length) {
      const c = line[i]!;
      if (c === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
        out.words += tokens(line.slice(i, j + 1));
        i = j + 1;
      } else if (c === "{") {
        let depth = 0, j = i;
        for (; j < line.length; j++) { if (line[j] === "{") depth++; else if (line[j] === "}" && --depth === 0) break; }
        out.formulas += tokens(line.slice(i, j + 1));
        i = j + 1;
      } else { rest += c; i++; }
    }
    out.structure += tokens(rest);
  }
  return out;
}

export interface RunResult {
  request: string;
  run: string;
  outputTokens: number;
  firstPaintTokens?: number;
  composition: Composition;
  errors: number;
  warnings: number;
  /** Zero error diagnostics and the spec drew. */
  clean: boolean;
  parts: { label: string; passed: boolean }[];
  complete: boolean;
  problems: string[];
}

export function measure(request: BenchRequest, run: string, spec: string): RunResult {
  const problems: string[] = [];
  let ui: Rendered | undefined;
  try { ui = draw(spec, request.state); } catch (e) { problems.push(`draw threw: ${(e as Error).message}`); }
  const diags = ui?.sayshape.diagnostics ?? [];
  for (const d of diags) problems.push(`line ${d.line} ${d.severity}: ${d.message}`);
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.length - errors;
  const parts = request.parts.map((p) => {
    let passed = false;
    try { passed = !!ui && p.test(ui, spec); } catch { passed = false; }
    return { label: p.label, passed };
  });
  return {
    request: request.id,
    run,
    outputTokens: tokens(spec),
    firstPaintTokens: tokensBeforeFirstPaint(spec, request.state),
    composition: composition(spec),
    errors,
    warnings,
    clean: !!ui && errors === 0,
    parts,
    complete: parts.every((p) => p.passed),
    problems,
  };
}
