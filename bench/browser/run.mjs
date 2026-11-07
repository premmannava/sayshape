/**
 * Interactive scenes in a real browser: frame times, paint time, hit testing,
 * the accessibility tree, memory under sustained animation and resizing, for
 * scenes of 4, 50, 200 and 500 animating objects, pressable and not.
 *
 *   npm run bench:scene-browser                    Playwright's Chromium
 *   CHROME=/path/to/chrome npm run bench:scene-browser
 *   npm run bench:scene-browser -- --seconds 10    longer windows (default 5)
 *
 * Writes bench/browser/results.json and prints a Markdown table. Frame times
 * come from requestAnimationFrame, so they are capped by the display rate;
 * paint time is the engine's own measure of one frame's work.
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg("seconds", 5));
const SIZES = (arg("sizes", "4,50,200,500")).split(",").map(Number);

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const med = (xs) => pct(xs, 50);
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;

const root = resolve(import.meta.dirname, "..", "..");
const server = await createServer({ root, server: { port: 5241, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--no-sandbox", "--enable-precise-memory-info"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: Number(arg("dpr", 1)) });
await page.goto("http://localhost:5241/bench/browser/index.html");
await page.waitForFunction(() => window.__bench?.ready);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const metric = async (name) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name)?.value ?? NaN;

const env = {
  browser: browser.version(),
  cpu: `${cpus()[0]?.model} × ${cpus().length}`,
  memoryGB: Math.round(totalmem() / 2 ** 30),
  devicePixelRatio: await page.evaluate(() => devicePixelRatio),
  headless: true,
  seconds: SECONDS,
};

const rows = [];
const runs = SIZES.flatMap((n) => [[n, false, false], [n, true, false]]);
// Objects that move: their regions change every frame, so the mirror has to follow.
if (SIZES.includes(200)) runs.push([200, false, true], [200, true, true]);
for (const [n, pressable, moving] of runs) {
  {
    await page.evaluate(([n, p, m]) => { window.__bench.load(n, p, m); window.__bench.paints.length = 0; window.__bench.mirrorUpdates = 0; }, [n, pressable, moving]);
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__bench.paints.length = 0; window.__bench.mirrorUpdates = 0; });
    const busy0 = await metric("TaskDuration"), script0 = await metric("ScriptDuration");
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? NaN);
    const frames = await page.evaluate((ms) => window.__bench.frames(ms), SECONDS * 1000);
    const busy1 = await metric("TaskDuration"), script1 = await metric("ScriptDuration");
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? NaN);
    const paints = await page.evaluate(() => [...window.__bench.paints]);
    const mirror = await page.evaluate(() => window.__bench.mirrorUpdates);
    const hits = await page.evaluate(() => window.__bench.hitTest(4000));
    const tree = await page.evaluate(() => window.__bench.treeMs(20));
    const regions = await page.evaluate(() => window.__bench.ui.hitRegions.filter((h) => h.box.node.type === "scene").length);
    // Resizing: the container narrows and widens; time each relayout and paint.
    const resize = await page.evaluate(async () => {
      const box = document.getElementById("box");
      const out = [];
      for (const w of [700, 420, 1000, 360, 1000]) {
        const t = performance.now();
        box.style.width = `${w}px`;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.__bench.ui.renderNow();
        out.push(performance.now() - t);
      }
      return out;
    });
    const wall = SECONDS;
    rows.push({
      objects: n, pressable, moving, regions,
      frameMedianMs: r1(med(frames)), frameP95Ms: r1(pct(frames, 95)), frameP99Ms: r1(pct(frames, 99)),
      dropped: frames.filter((f) => f > 25).length, frames: frames.length,
      paintMedianMs: r1(med(paints)), paintP95Ms: r1(pct(paints, 95)), paintP99Ms: r1(pct(paints, 99)),
      mainThreadBusyPct: Math.round((100 * (busy1 - busy0)) / wall), scriptPct: Math.round((100 * (script1 - script0)) / wall),
      heapChangeKB: Math.round((heap1 - heap0) / 1024),
      hitTestMedianUs: r1(med(hits) * 1000), hitTestP99Us: r1(pct(hits, 99) * 1000),
      a11yTreeMedianMs: r1(med(tree)), mirrorMutations: mirror,
      resizeMedianMs: r1(med(resize)),
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
}

// Sustained animation: the 200 pressable objects for longer, heap sampled every few seconds.
const sustained = [];
await page.evaluate(() => { window.__bench.load(200, true); });
for (let i = 0; i <= 6; i++) {
  if (i) await page.waitForTimeout(5000);
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  sustained.push({ seconds: i * 5, heapMB: r1((await page.evaluate(() => performance.memory?.usedJSHeapSize ?? NaN)) / 2 ** 20) });
}

await browser.close();
await server.close();
writeFileSync(resolve(import.meta.dirname, "results.json"), JSON.stringify({ env, rows, sustained }, null, 1));

console.log(`\nBrowser: ${env.browser}, CPU: ${env.cpu}, memory ${env.memoryGB} GB, device pixel ratio ${env.devicePixelRatio}, headless, ${SECONDS} s per run\n`);
console.log("| Objects | Pressable | Moving | Frame median / p95 / p99 (ms) | Frames > 25 ms | Paint median / p95 / p99 (ms) | Main thread busy | Hit test median / p99 (µs) | A11y tree (ms) | Mirror mutations | Resize (ms) |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.objects} | ${r.pressable ? "yes" : "no"} | ${r.moving ? "yes" : "no"} | ${r.frameMedianMs} / ${r.frameP95Ms} / ${r.frameP99Ms} | ${r.dropped} of ${r.frames} | ${r.paintMedianMs} / ${r.paintP95Ms} / ${r.paintP99Ms} | ${r.mainThreadBusyPct}% | ${r.hitTestMedianUs} / ${r.hitTestP99Us} | ${r.a11yTreeMedianMs} | ${r.mirrorMutations} | ${r.resizeMedianMs} |`);
}
console.log(`\nHeap while 200 pressable objects animate: ${sustained.map((s) => `${s.seconds}s ${s.heapMB} MB`).join(", ")}`);
