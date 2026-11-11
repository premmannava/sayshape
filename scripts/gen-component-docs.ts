/**
 * Regenerates the component reference in docs/components.md from the
 * component definitions, between the COMPONENTS:START and COMPONENTS:END
 * markers. (It lived in README.md until the README was cut down to a page.)
 *
 *   npm run docs:components           write docs/components.md
 *   npm run docs:components -- --check  fail if it is out of date (for CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coreComponents } from "../src/components";
import { mapComponents } from "../src/components/map";
import { CATEGORIES } from "../src/component";
import { componentSection } from "./component-docs";

const TARGET = resolve(__dirname, "../docs/components.md");
const START = "<!-- COMPONENTS:START (generated from src/components) -->";
const END = "<!-- COMPONENTS:END -->";
const CAT_START = "<!-- CATEGORIES:START (generated from src/components) -->";
const CAT_END = "<!-- CATEGORIES:END -->";

const all = [...coreComponents, ...mapComponents];
const anchor = (type: string) => `[\`${type}\`](#${type})`;
const categories = [
  "| Category | Components |",
  "|---|---|",
  ...CATEGORIES.map((cat) => [cat, all.filter((c) => c.category === cat)] as const)
    .filter(([, defs]) => defs.length)
    .map(([cat, defs]) => `| ${cat[0]!.toUpperCase() + cat.slice(1)} | ${defs.map((d) => anchor(d.type)).join(", ")} |`),
].join("\n");

/** Replace the text between two markers, failing loudly if they're missing. */
function between(text: string, start: string, end: string, content: string): string {
  const a = text.indexOf(start), b = text.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`docs/components.md is missing the ${start} / ${end} markers`);
  return text.slice(0, a + start.length) + "\n" + content + "\n" + text.slice(b);
}

const current = readFileSync(TARGET, "utf8");
const next = between(between(current, CAT_START, CAT_END, categories), START, END, all.map((c) => componentSection(c)).join("").trim());

if (process.argv.includes("--check")) {
  if (next !== current) {
    console.error("docs/components.md is out of date. Run: npm run docs:components");
    process.exit(1);
  }
  console.log("docs/components.md is up to date.");
} else {
  writeFileSync(TARGET, next);
  console.log(`Wrote ${all.length} components to docs/components.md`);
}
