// Runs each query in reports.sql against the saved answers and prints its rows.
// One `wrangler d1 execute --command` per query: with --file, remote runs print only a summary.
// Extra arguments go to wrangler, e.g. `npm run report -- --local` for a local copy.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("../reports.sql", import.meta.url)), "utf8");
const queries = [];
let title = "";
let lines = [];
for (const line of sql.split("\n")) {
  const t = line.trim();
  if (t.startsWith("--")) { if (!lines.length) title = t.replace(/^--\s*/, ""); continue; }
  if (t) lines.push(line);
  if (t.endsWith(";")) { queries.push({ title, text: lines.join("\n") }); lines = []; title = ""; }
}

const extra = process.argv.slice(2);
const where = extra.includes("--local") ? [] : ["--remote"];
for (const q of queries) {
  console.log(`\n## ${q.title}`);
  execFileSync("npx", ["wrangler", "d1", "execute", "sayshape-records", ...where, ...extra, "--command", q.text], { stdio: "inherit" });
}
