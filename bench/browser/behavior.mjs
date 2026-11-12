/**
 * Rules ticking in a real browser (docs/plans/behavior.md): for a small
 * screen and screens of about 1,000 and 5,000 elements, a rule every 16, 33
 * and 50 ms, measured over a few seconds each: ticks a second actually run,
 * frame intervals, and the engine's own work per frame (everything in
 * renderNow: layout, paint and the screen reader mirror; not the browser's raster),
 * and whether the slow-down guard raised the floor. Each size also runs
 * with no rule, the page writing the same state on its own timer (what a
 * host can do today), as a control.
 *
 *   npm run bench:behavior-browser                       Playwright's Chromium
 *   CHROME=/path/to/chrome npm run bench:behavior-browser
 *   npm run bench:behavior-browser -- --seconds 5        longer windows (default 3)
 *
 * Writes bench/browser/behavior-results.json and prints a Markdown table.
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg("seconds", 3));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

const root = resolve(import.meta.dirname, "..", "..");
const server = await createServer({ root, server: { port: 5242, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto("http://localhost:5242/bench/browser/behavior.html");
await page.waitForFunction(() => window.__behavior?.ready);

const env = { browser: browser.version(), cpu: `${cpus()[0]?.model} × ${cpus().length}`, memoryGB: Math.round(totalmem() / 2 ** 30), headless: true, seconds: SECONDS };
const rows = [];
for (const size of ["small", "1000", "5000"]) {
  for (const [every, control] of [[16, false], [33, false], [50, false], [16, true], [50, true]]) {
    const r = await page.evaluate(([s, e, ms, c]) => window.__behavior.run(s, e, ms, c), [size, every, SECONDS * 1000, control]);
    rows.push({
      size, every, control, canvasHeight: r.canvasHeight,
      ticksPerSecond: r1(r.ticks / SECONDS),
      wanted: r1(1000 / every),
      frameMedianMs: r1(pct(r.frames, 50)),
      frameP95Ms: r1(pct(r.frames, 95)),
      workMedianMs: r2(pct(r.work, 50)),
      workP95Ms: r2(pct(r.work, 95)),
      busyShare: r2(r.work.reduce((a, b) => a + b, 0) / (SECONDS * 1000)),
      floor: r.floor,
      warnings: r.warnings,
    });
  }
}
await browser.close();
await server.close();
writeFileSync(resolve(import.meta.dirname, "behavior-results.json"), JSON.stringify({ env, rows }, null, 2) + "\n");
console.log(`${env.browser}, ${env.cpu}, ${SECONDS} s each\n`);
console.log("| Screen (canvas height) | Writes | Every | Ticks/s (wanted) | Frame median / p95 | Engine work per frame median / p95 | Share of time in the engine | Floor after |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.size === "small" ? "countdown" : `~${r.size} elements`} (${r.canvasHeight} px) | ${r.control ? "host timer, no rule" : "rule"} | ${r.every} ms | ${r.ticksPerSecond} (${r.wanted}) | ${r.frameMedianMs} / ${r.frameP95Ms} ms | ${r.workMedianMs} / ${r.workP95Ms} ms | ${Math.round(r.busyShare * 100)}% | ${r.control ? "–" : `${r.floor} ms`} |`);
