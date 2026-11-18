/**
 * Captures the design review cases (visual/cases.ts, names starting with
 * "review-") at chat and desktop widths in light and dark, for comparing a
 * visual change before and after:
 *
 *   npx tsx scripts/review-shots.ts <out-dir> [--chrome /path/to/chrome]
 *
 * Starts the visual test page's Vite server itself. Unlike the visual
 * regression suite, these shots are for people to look at, not to diff.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { cases } from "../visual/cases";

const PORT = 5198;
const WIDTHS = [360, 600, 1200];
const THEMES = ["light", "dark"];

async function main(): Promise<void> {
  const out = process.argv[2] ?? "review-shots";
  const ci = process.argv.indexOf("--chrome");
  const executablePath = ci > 0 ? process.argv[ci + 1] : undefined;
  mkdirSync(out, { recursive: true });
  const server = spawn("npx", ["vite", "--config", "visual/vite.config.ts", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  try {
    await waitFor(`http://localhost:${PORT}/visual/index.html`);
    const browser = await chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
    for (const c of cases.filter((x) => x.name.startsWith("review-"))) {
      for (const theme of THEMES) {
        for (const width of WIDTHS) {
          await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light" });
          await page.goto(`http://localhost:${PORT}/visual/index.html?case=${c.name}&theme=${theme}&width=${width}`);
          await page.waitForFunction(() => window.__sayShapeReady || window.__sayShapeError);
          const error = await page.evaluate(() => window.__sayShapeError ?? null);
          if (error) throw new Error(`${c.name}: ${error}`);
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await page.locator("#frame").screenshot({ path: `${out}/${c.name}-${theme}-${width}.png` });
        }
      }
    }
    await browser.close();
  } finally {
    server.kill();
  }
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite didn't start at ${url}`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
