/**
 * The token benchmark (bench/tokens/README.md).
 *
 *   npm run token-bench -- kit <dir> [variant...]   write each guide and request as text files, for writers
 *   npm run token-bench -- score <runs-dir>          score every answer under <runs-dir>/<variant>/
 *
 * Answers are files named <request-id>__<run>.ss. Scoring writes
 * <runs-dir>/<variant>/results.json and prints a Markdown summary.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDE_VARIANTS, guideText } from "../bench/tokens/guides";
import { measure, tokens, TOKENIZER, type RunResult } from "../bench/tokens/measure";
import { REQUESTS, requestById } from "../bench/tokens/requests";

const [cmd, dir, ...rest] = process.argv.slice(2);

function kit(out: string, variants: string[]) {
  mkdirSync(join(out, "guides"), { recursive: true });
  mkdirSync(join(out, "requests"), { recursive: true });
  for (const v of variants.length ? variants : Object.keys(GUIDE_VARIANTS)) {
    const g = guideText(v);
    writeFileSync(join(out, "guides", `${v}.txt`), g);
    console.log(`guide ${v}: ${tokens(g)} tokens, ${g.length} characters`);
  }
  for (const r of REQUESTS) writeFileSync(join(out, "requests", `${r.id}.txt`), r.text);
}

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

function score(runs: string) {
  const rows: string[] = [];
  const mix: string[] = [];
  for (const variant of readdirSync(runs).filter((d) => statSync(join(runs, d)).isDirectory()).sort()) {
    const files = readdirSync(join(runs, variant)).filter((f) => f.endsWith(".ss")).sort();
    const results: RunResult[] = files.map((f) => {
      const [id, run] = f.replace(/\.ss$/, "").split("__") as [string, string];
      return measure(requestById(id), run, readFileSync(join(runs, variant, f), "utf8"));
    });
    const comp = results.reduce((a, r) => ({ data: a.data + r.composition.data, structure: a.structure + r.composition.structure, words: a.words + r.composition.words, formulas: a.formulas + r.composition.formulas }), { data: 0, structure: 0, words: 0, formulas: 0 });
    const all = comp.data + comp.structure + comp.words + comp.formulas || 1;
    const pct = (n: number) => `${Math.round((n / all) * 100)}%`;
    mix.push(`| ${variant} | ${pct(comp.data)} | ${pct(comp.structure)} | ${pct(comp.words)} | ${pct(comp.formulas)} |`);
    const guide = GUIDE_VARIANTS[variant] ? tokens(guideText(variant)) : undefined;
    writeFileSync(join(runs, variant, "results.json"), JSON.stringify({ tokenizer: TOKENIZER, variant, guideTokens: guide, results }, null, 2) + "\n");
    for (const id of [...new Set(results.map((r) => r.request))]) {
      const rs = results.filter((r) => r.request === id);
      const fp = rs.map((r) => r.firstPaintTokens).filter((n): n is number => n !== undefined);
      rows.push(`| ${variant} | ${id} | ${guide ?? "?"} | ${median(rs.map((r) => r.outputTokens))} | ${fp.length ? median(fp) : "never"} | ${rs.filter((r) => r.clean).length}/${rs.length} | ${rs.filter((r) => r.complete).length}/${rs.length} |`);
    }
  }
  console.log(`Tokenizer: ${TOKENIZER}. Medians over runs.\n\n| Variant | Request | Guide tokens | Output tokens | Tokens before first paint | First-try clean | Complete |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}`);
  console.log(`\nWhere output tokens go (all runs of a variant):\n\n| Variant | Data | Structure | Visible words | Formulas |\n|---|---|---|---|---|\n${mix.join("\n")}`);
}

if (cmd === "kit" && dir) kit(dir, rest);
else if (cmd === "score" && dir) score(dir);
else { console.error("Usage: npm run token-bench -- kit <dir> [variant...] | score <runs-dir>"); process.exit(1); }
