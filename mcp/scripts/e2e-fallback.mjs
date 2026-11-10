// End-to-end check of the page show_interface gives chat apps that can't draw
// MCP Apps views: a client that announces no MCP Apps support asks for an
// interface, the page from its result is saved as a file and opened in
// Chromium, and it must paint, follow light, dark and data-theme, fit 400px
// with no sideways scrolling, keep a hostile spec inert, and open a pressed
// link in a new tab. A spec with emit: gets no page until it's removed.
//
// The page loads the engine from jsDelivr at PAGE_ENGINE_VERSION. Here those
// requests are answered with the engine built from this repository's src/
// (or, with SAYSHAPE_ENGINE_DIST, the dist/ of an installed sayshape package),
// so the check doesn't depend on what npm has published.
//
//   npm run build && node scripts/e2e-fallback.mjs     screenshots go to e2e-output/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { build } from "vite";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });
const dist = process.env.SAYSHAPE_MCP_DIST ?? here("../dist/");

// The engine scripts the page asks jsDelivr for.
let engine = process.env.SAYSHAPE_ENGINE_DIST;
if (!engine) {
  engine = join(out, "cdn");
  for (const [entry, name, file] of [["../../src/browser.ts", "sayshape", "sayshape.global.js"], ["../../src/components/map/browser.ts", "sayshapeMap", "sayshape-map.global.js"]]) {
    await build({
      logLevel: "warn",
      configFile: false,
      build: { outDir: engine, emptyOutDir: false, target: "es2020", lib: { entry: here(entry), name, formats: ["iife"], fileName: () => file } },
    });
  }
}
for (const file of ["sayshape.global.js", "sayshape-map.global.js"]) if (!existsSync(join(engine, file))) throw new Error(`${join(engine, file)} is missing`);

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

// A client with no MCP Apps capability, as text-only chat apps connect.
const client = new Client({ name: "e2e-text-only", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, "server.js")], stderr: "pipe" }));

const CHART = `state sales=[{m: "Jan", v: 120}, {m: "Feb", v: 180}, {m: "Mar", v: 150}, {m: "Apr", v: 210}]
card
  text "Sales by month" style=title
  text "</script><script>window.injected = 1; alert(1)</script><!-- <img src=x onerror=alert(2)>" tone=muted
  chart "Revenue (k$)" kind=bar items=sales x=m y=v
  text "Read [the notes](https://example.com/notes) on how it was counted." rich=true
  button "Add May" on=add:sales:{m: "May", v: 190}
`;
const MAP = `card
  text "Offices" style=title
  map fit=pins
    pin "London" lat=51.5 lon=-0.12
    pin "Tokyo" lat=35.7 lon=139.7
`;

async function pageFor(spec, title) {
  const r = await client.callTool({ name: "show_interface", arguments: { spec, title } });
  const text = r.content?.[0]?.text ?? "";
  const html = /(`{3,})html\n([\s\S]*?)\1/.exec(text)?.[2];
  check(!!html && r.structuredContent?.page === true, `${title}: the text result carries a page`);
  return html ?? "";
}

const pages = { chart: await pageFor(CHART, "Sales"), map: await pageFor(MAP, "Offices") };

// emit: has no chat to reach from a page: the model is asked to remove it first.
{
  const tools = (await client.listTools()).tools;
  check(/emit: can't reach you: don't use it/.test(tools.find((t) => t.name === "show_interface")?.description ?? ""), "the quick start tells a text-only client not to use emit:");
  const r = await client.callTool({ name: "show_interface", arguments: { spec: 'card\n  button "Send" on=emit:sent' } });
  const text = r.content?.[0]?.text ?? "";
  check(r.structuredContent?.page === false && /line 2 \(error\): emit: can't reach you/.test(text) && !/```/.test(text), "a spec with emit: gets it back to fix, with no page");
}
const files = {};
for (const [name, html] of Object.entries(pages)) {
  files[name] = join(out, `fallback-${name}.html`);
  writeFileSync(files[name], html);
}
await client.close();

const LIGHT = { surface: "rgb(255, 255, 255)" };
const DARK = { surface: "rgb(18, 25, 28)" };

const browser = await chromium.launch();
async function open(file, { scheme = "light", width = 400 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("dialog", (d) => { problems.push(`a dialog opened: ${d.message()}`); void d.dismiss(); });
  const requested = [];
  await page.route("https://cdn.jsdelivr.net/npm/**", (route) => {
    const url = route.request().url();
    requested.push(url);
    const m = /\/npm\/sayshape@(\d+\.\d+\.\d+)\/dist\/(sayshape(?:-map)?\.global\.js)$/.exec(url);
    if (!m) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: readFileSync(join(engine, m[2])) });
  });
  await page.goto(pathToFileURL(file).href);
  return { page, problems, requested };
}

/** Waits for the picture to stop changing (new elements fade in), then counts pixels that aren't the background. */
async function painted(page, bg) {
  const measure = () => page.evaluate((bg) => {
    const c = document.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let ink = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) ink++;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
    }
    return { ink, light, w: c.width, h: c.height };
  }, bg);
  let last = await measure();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    const next = await measure();
    const settled = next.ink === last.ink && next.h === last.h;
    last = next;
    if (settled && last.ink > 500) break;
  }
  return last;
}
const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

try {
  // Light, at a phone's width.
  {
    const { page, problems, requested } = await open(files.chart);
    const p = await painted(page, rgb(LIGHT.surface));
    check(p.ink > 1500 && p.h > 200, `light: the chart paints (${p.w}×${p.h}, ${p.ink} inked pixels)`);
    check((await background(page)) === LIGHT.surface, `light: the background is the light theme's surface (${await background(page)})`);
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: innerWidth, canvas: document.querySelector("canvas").getBoundingClientRect().width }));
    check(widths.doc <= widths.view && widths.canvas <= 400, `400px wide: no sideways scrolling (page ${widths.doc}px, canvas ${widths.canvas}px)`);
    check(requested.length === 1 && /sayshape@\d+\.\d+\.\d+\/dist\/sayshape\.global\.js$/.test(requested[0]), `loads one engine script from jsDelivr at an exact version (${requested.join(", ")})`);
    const inert = await page.evaluate(() => ({ scripts: document.scripts.length, injected: "injected" in window, imgs: document.images.length, comments: document.createTreeWalker(document, NodeFilter.SHOW_COMMENT).nextNode() !== null }));
    check(inert.scripts === 2 && !inert.injected && inert.imgs === 0 && !inert.comments, `a spec with </script>, <!-- and <img onerror> stays inert (${JSON.stringify(inert)})`);
    check(problems.length === 0, `light: no errors or dialogs${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.screenshot({ path: join(out, "fallback-light-400.png"), fullPage: true });

    // A viewer picking dark on a published page sets data-theme on the root element.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const d = await painted(page, rgb(DARK.surface));
    check((await background(page)) === DARK.surface && d.light > 300, `data-theme="dark" over a light system turns it dark (${await background(page)}, ${d.light} light pixels of text)`);
    await page.close();
  }
  // Dark from the system, and data-theme="light" overriding it.
  {
    const { page, problems } = await open(files.chart, { scheme: "dark", width: 640 });
    const p = await painted(page, rgb(DARK.surface));
    check(p.ink > 1500 && (await background(page)) === DARK.surface, `dark: the chart paints on the dark theme's surface (${p.ink} inked pixels, ${await background(page)})`);
    await page.screenshot({ path: join(out, "fallback-dark-640.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await painted(page, rgb(LIGHT.surface));
    check((await background(page)) === LIGHT.surface, `data-theme="light" over a dark system turns it light (${await background(page)})`);
    check(problems.length === 0, `dark: no errors or dialogs${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.close();
  }
  // A link pressed in rich text opens in a new tab: Tab to it (the screen reader mirror's link) and press Enter.
  {
    const { page, problems } = await open(files.chart, { width: 640 });
    await painted(page, rgb(LIGHT.surface));
    await page.context().route("https://example.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>notes</title>" }));
    const opened = page.context().waitForEvent("page", { timeout: 15000 })
      .then(async (p) => { await p.waitForURL(/^https:/, { timeout: 10000 }).catch(() => {}); return p.url(); })
      .catch((e) => `nothing opened: ${e.message.split("\n")[0]}`);
    await page.locator("canvas").focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "link")) break;
    }
    await page.keyboard.press("Enter");
    const url = await opened;
    check(url === "https://example.com/notes", `a pressed link opens in a new tab (${url})`);
    check(problems.length === 0, `link: no errors${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.close();
  }
  // The map's own script.
  {
    const { page, problems, requested } = await open(files.map, { width: 640 });
    const p = await painted(page, rgb(LIGHT.surface));
    check(requested.some((u) => u.endsWith("/sayshape-map.global.js")) && p.ink > 1500, `a map loads the map script and paints (${p.ink} inked pixels)`);
    check(problems.length === 0, `map: no errors${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.screenshot({ path: join(out, "fallback-map.png"), fullPage: true });
    await page.close();
  }
  // Offline, or a version the CDN won't serve: a plain message, not a blank page.
  {
    const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.goto(pathToFileURL(files.chart).href);
    const note = await page.evaluate(() => { const n = document.getElementById("note"); return n.hidden ? "" : n.textContent; });
    check(/sayshape@\d+\.\d+\.\d+\) didn't load from cdn\.jsdelivr\.net/.test(note) && /isn't available from the CDN yet/.test(note), `without the CDN it names the version that didn't load ("${note.slice(0, 70)}…")`);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nThe text-only page passed.");
