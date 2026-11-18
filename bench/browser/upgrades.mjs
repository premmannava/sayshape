/**
 * Scene upgrades in a real browser: frame intervals and engine paint time for
 * each spec in upgrade-specs.ts (desktop, and a phone: 390 px wide at DPR 3
 * with the CPU slowed 4×), and light and dark screenshots.
 *
 *   CHROME=/usr/bin/google-chrome node bench/browser/upgrades.mjs [--seconds 3] [--shots dir] [--only a,b]
 *
 * Headless Chrome may raster on the CPU, so frame rates here are a floor.
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg("seconds", 3));
const SHOTS = arg("shots", "");
const ONLY = arg("only", "");
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r1 = (x) => Math.round(x * 10) / 10;

const root = resolve(import.meta.dirname, "..", "..");
const server = await createServer({ root, server: { port: 5243, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--no-sandbox"] });
const rows = [];
for (const device of [{ name: "desktop", width: 640, dpr: 2, slow: 1 }, { name: "phone", width: 390, dpr: 3, slow: 4 }]) {
  const page = await browser.newPage({ viewport: { width: device.width + 40, height: 900 }, deviceScaleFactor: device.dpr });
  const cdp = await page.context().newCDPSession(page);
  if (device.slow > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: device.slow });
  await page.goto("http://localhost:5243/bench/browser/upgrades.html");
  await page.waitForFunction(() => window.__up?.ready);
  const names = (await page.evaluate(() => window.__up.names)).filter((n) => !ONLY || ONLY.split(",").includes(n));
  for (const name of names) {
    for (const dark of device.name === "desktop" ? [false, true] : [false]) {
      await page.evaluate(([n, d, w]) => window.__up.load(n, d, w), [name, dark, device.width]);
      const { intervals, paints } = await page.evaluate((ms) => window.__up.frames(ms), SECONDS * 1000);
      const iv = intervals.slice(5);
      rows.push({ spec: name, device: device.name, theme: dark ? "dark" : "light", fps: r1(1000 / pct(iv, 50)), p95FrameMs: r1(pct(iv, 95)), medianPaintMs: r1(pct(paints, 50)), p95PaintMs: r1(pct(paints, 95)) });
      if (SHOTS && device.name === "desktop") {
        mkdirSync(SHOTS, { recursive: true });
        await page.locator("#canvas").screenshot({ path: `${SHOTS}/${name}-${dark ? "dark" : "light"}.png` });
      }
    }
  }
  await page.close();
}
await browser.close();
await server.close();
writeFileSync(resolve(import.meta.dirname, "upgrades-results.json"), JSON.stringify(rows, null, 1) + "\n");
console.log("| spec | device | theme | fps (median) | p95 frame ms | median paint ms | p95 paint ms |\n|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.spec} | ${r.device} | ${r.theme} | ${r.fps} | ${r.p95FrameMs} | ${r.medianPaintMs} | ${r.p95PaintMs} |`);
