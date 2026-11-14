// End-to-end check of the widget file show_interface writes with --widget-dir, for chat apps
// that can't draw MCP Apps views but can show a widget made from a file: a client that
// announces no MCP Apps support asks for an interface, the file named in the result is read,
// and its fragment is opened in Chromium inside a page whose Content Security Policy blocks
// every external script, connection and image, as such an app's sandbox does. It must draw in
// light and dark (and follow data-theme), fit 400px with no sideways scrolling, change on a
// press, keep a hostile spec inert, open a pressed link in a new tab, show a short note when
// the engine can't be unpacked, and the server must refuse --widget-dir with --http. With
// --widget-host muse the file also hooks the Muse adapter in: an emit: button is accepted, and
// pressing it with a fake state bridge on the page puts the action in the bridge's state; the flag's
// own refusals (an unknown host, no --widget-dir) are checked too.
//
// Nothing here is served from a CDN: the engine is inside the file, unpacked by the loader.
//
//   npm run build && node scripts/e2e-widget.mjs     screenshots go to e2e-output/
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });
const dist = process.env.SAYSHAPE_MCP_DIST ?? here("../dist/");
const server = join(dist, "server.js");
const widgets = mkdtempSync(join(tmpdir(), "sayshape-widgets-"));
const hosted = mkdtempSync(join(tmpdir(), "sayshape-widgets-host-"));

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

// --widget-dir writes files for an app on this computer to read: an HTTP server can't offer that.
{
  const r = spawnSync(process.execPath, [server, "--http", "0", "--widget-dir", widgets], { encoding: "utf8", timeout: 20000 });
  check(r.status === 1 && /--widget-dir can't be used with --http/.test(r.stderr), `--widget-dir with --http is refused (exit ${r.status}: ${r.stderr.trim().split("\n")[0]})`);
}

// --widget-host is for --widget-dir only, and only for the hosts there's an adapter for.
{
  const unknown = spawnSync(process.execPath, [server, "--widget-dir", widgets, "--widget-host", "nope"], { encoding: "utf8", timeout: 20000 });
  check(unknown.status === 1 && /doesn't know "nope"/.test(unknown.stderr) && /muse/.test(unknown.stderr), `an unknown --widget-host stops the server and lists the hosts (exit ${unknown.status}: ${unknown.stderr.trim().split("\n")[0]})`);
  const alone = spawnSync(process.execPath, [server, "--widget-host", "muse"], { encoding: "utf8", timeout: 20000 });
  check(alone.status === 1 && /only applies with --widget-dir/.test(alone.stderr), `--widget-host without --widget-dir is refused (exit ${alone.status}: ${alone.stderr.trim().split("\n")[0]})`);
}

// A client with no MCP Apps capability, as such chat apps connect.
const client = new Client({ name: "e2e-widget", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, "--widget-dir", widgets], stderr: "pipe" }));

const CHART = `state sales=[{m: "Jan", v: 120}, {m: "Feb", v: 180}, {m: "Mar", v: 150}, {m: "Apr", v: 210}]
state days=2
card
  text "Sales by month" style=title
  text "</script><script>window.injected = 1; alert(1)</script><!-- <img src=x onerror=alert(2)> localStorage" tone=muted
  chart "Revenue (k$)" kind=bar items=sales x=m y=v
  stat label="Days" value={days}
  button "Add day" on=inc:days
  text "Read [the notes](https://example.com/notes) on how it was counted." rich=true
`;
const MAP = `card
  text "Offices" style=title
  map fit=pins
    pin "London" lat=51.5 lon=-0.12
    pin "Tokyo" lat=35.7 lon=139.7
`;

async function fileFor(spec, title) {
  const r = await client.callTool({ name: "show_interface", arguments: { spec, title } });
  const text = r.content?.[0]?.text ?? "";
  const path = /^(\/\S+\.html)$/m.exec(text)?.[1];
  check(!!path && r.structuredContent === undefined && !/<\w+[ >]|```/.test(text), `${title}: the result names a file and carries no HTML`);
  return path ?? "";
}
const files = { chart: await fileFor(CHART, "Sales"), map: await fileFor(MAP, "Offices") };
const sizes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, statSync(f).size]));
console.log(`  file sizes: plain ${sizes.chart} bytes, with the map ${sizes.map} bytes`);
check(sizes.chart < 1_000_000 && sizes.map < 1_000_000, "both files are under 1 MB");
{
  const again = await client.callTool({ name: "show_interface", arguments: { spec: CHART.replace("Sales by month", "Sales by month!") } });
  check(/^(\/\S+\.html)$/m.test(again.content?.[0]?.text ?? ""), "another interface gets a file of its own");
}
const plainNoEmit = await client.callTool({ name: "show_interface", arguments: { spec: 'card\n  button "Send" on=emit:sent' } });
check(/emit: can't reach you/.test(plainNoEmit.content?.[0]?.text ?? "") && !/\.html/.test(plainNoEmit.content?.[0]?.text ?? ""), "without --widget-host an emit: button is still a problem to fix");
await client.close();

// With --widget-host muse: emit: is accepted, and the model is told presses are saved for its next turn.
const ORDER = `card
  text "Order" style=title
  button "Place order" on=emit:submit_order
`;
const hostClient = new Client({ name: "e2e-widget-host", version: "1.0.0" });
await hostClient.connect(new StdioClientTransport({ command: process.execPath, args: [server, "--widget-dir", hosted, "--widget-host", "muse"], stderr: "pipe" }));
const hostDescription = (await hostClient.listTools()).tools.find((t) => t.name === "show_interface")?.description ?? "";
check(/saves a press for your next turn/.test(hostDescription) && !/emit: can't reach you/.test(hostDescription), "with --widget-host the quick start says presses are saved, not that emit: is off");
const hostResult = await hostClient.callTool({ name: "show_interface", arguments: { spec: ORDER, title: "Order" } });
const hostText = hostResult.content?.[0]?.text ?? "";
const hostFile = /^(\/\S+\.html)$/m.exec(hostText)?.[1] ?? "";
check(!!hostFile && /Presses are saved for your next turn/.test(hostText), "with --widget-host a spec using emit: gets a file and the new wording");
await hostClient.close();

const fragments = Object.fromEntries(Object.entries({ ...files, order: hostFile }).map(([k, f]) => [k, readFileSync(f, "utf8")]));
check(!/<!doctype|<html|<head|<body/i.test(fragments.chart) && !/localStorage|sessionStorage|indexedDB/i.test(fragments.chart), "the fragment has no document wrapper and no browser storage names");

const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(18, 25, 28)";
const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);

// A page like a sandboxed widget frame: the fragment inside a bare document, and a Content Security
// Policy that allows only inline scripts and blob: scripts, and data: images.
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src data:";
const PAGE = "http://widget.test/widget.html";
const pageOf = (fragment, theme) =>
  `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${fragment}</body></html>`;

const browser = await chromium.launch();
async function open(fragment, { scheme = "light", width = 400, theme = null, init = "" } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  const problems = [];
  const requests = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("dialog", (d) => { problems.push(`a dialog opened: ${d.message()}`); void d.dismiss(); });
  page.on("request", (r) => { if (!r.url().startsWith("blob:") && !r.url().startsWith("data:")) requests.push(r.url()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (init) await page.addInitScript(init);
  await page.route("**/*", (route) => {
    if (route.request().url() === PAGE) return route.fulfill({ status: 200, contentType: "text/html", headers: { "content-security-policy": CSP }, body: pageOf(fragment, theme) });
    return route.abort();
  });
  await page.goto(PAGE);
  return { page, problems, requests };
}

/** Waits for the picture to stop changing (new elements fade in), then counts pixels that aren't the background. */
async function painted(page, bg) {
  const measure = () => page.evaluate((bg) => {
    const c = document.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let ink = 0, light = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]) >>> 0;
      if (d[i + 3] === 0) continue;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) ink++;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
    }
    return { ink, light, sum, w: c.width, h: c.height };
  }, bg);
  let last = await measure();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    const next = await measure();
    const settled = next.ink === last.ink && next.h === last.h && next.sum === last.sum;
    last = next;
    if (settled && last.ink > 500) break;
  }
  return last;
}
const background = (page) => page.evaluate(() => getComputedStyle(document.querySelector("div[id^=sw-]")).backgroundColor);

try {
  // Light, at a phone's width.
  {
    const { page, problems, requests } = await open(fragments.chart);
    const p = await painted(page, rgb(LIGHT));
    check(p.ink > 1500 && p.h > 200, `light: the chart paints (${p.w}×${p.h}, ${p.ink} inked pixels)`);
    check((await background(page)) === LIGHT, `light: the widget's background is the light theme's surface (${await background(page)})`);
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, view: innerWidth, canvas: document.querySelector("canvas").getBoundingClientRect().width, box: document.querySelector("div[id^=sw-]").getBoundingClientRect().width }));
    check(widths.doc <= widths.view && widths.canvas <= 400 && widths.box <= 400, `400px wide: it fits, no sideways scrolling (page ${widths.doc}px, widget ${widths.box}px, canvas ${widths.canvas}px)`);
    check(requests.length === 1 && requests[0] === PAGE, `nothing is requested but the page itself (${requests.join(", ")})`);
    const violations = await page.evaluate(() => window.__csp);
    check(violations.length === 0, `the Content Security Policy blocked nothing the widget needed (${violations.join("; ") || "no violations"})`);
    const inert = await page.evaluate(() => ({ injected: "injected" in window, imgs: document.images.length, comments: document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT).nextNode() !== null, inline: [...document.scripts].filter((s) => !s.src).length, blobs: [...document.scripts].filter((s) => s.src.startsWith("blob:")).length }));
    check(!inert.injected && inert.imgs === 0 && !inert.comments && inert.inline === 1 && inert.blobs === 1, `a spec with </script>, <!-- and <img onerror> stays inert; the engine is one blob: script (${JSON.stringify(inert)})`);
    check(problems.length === 0, `light: no errors or dialogs${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.screenshot({ path: join(out, "widget-light-400.png"), fullPage: true });

    // The policy really does block outside scripts, connections and images (so the checks above mean something).
    const blocked = await page.evaluate(async () => {
      const result = {};
      try { await fetch("https://example.com/x"); result.fetch = "allowed"; } catch { result.fetch = "blocked"; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/sayshape@0.1.1/dist/sayshape.global.js";
      result.script = await new Promise((ok) => { s.onload = () => ok("allowed"); s.onerror = () => ok("blocked"); document.head.appendChild(s); });
      const img = new Image();
      img.src = "https://example.com/x.png";
      result.image = await new Promise((ok) => { img.onload = () => ok("allowed"); img.onerror = () => ok("blocked"); });
      return result;
    });
    check(blocked.fetch === "blocked" && blocked.script === "blocked" && blocked.image === "blocked", `the page's policy blocks external fetches, scripts and images (${JSON.stringify(blocked)})`);

    // A press changes the screen: the stat's number and the picture.
    const before = await painted(page, rgb(LIGHT));
    const box = await page.getByRole("button", { name: "Add day" }).boundingBox();
    check(!!box, "the button is reachable by a screen reader (a mirror node named \"Add day\")");
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const after = await painted(page, rgb(LIGHT));
    check(after.sum !== before.sum, `a press changes the screen (picture ${before.sum} → ${after.sum})`);
    await page.screenshot({ path: join(out, "widget-pressed-400.png"), fullPage: true });

    // A viewer picking dark on a widget sets data-theme on the root element.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const d = await painted(page, rgb(DARK));
    check((await background(page)) === DARK && d.light > 300, `data-theme="dark" over a light system turns it dark (${await background(page)}, ${d.light} light pixels of text)`);
    await page.close();
  }
  // Dark from the system, and data-theme="light" overriding it.
  {
    const { page, problems } = await open(fragments.chart, { scheme: "dark", width: 656 });
    const p = await painted(page, rgb(DARK));
    check(p.ink > 1500 && (await background(page)) === DARK, `dark: the chart paints on the dark theme's surface (${p.ink} inked pixels, ${await background(page)})`);
    await page.screenshot({ path: join(out, "widget-dark-656.png"), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await painted(page, rgb(LIGHT));
    check((await background(page)) === LIGHT, `data-theme="light" over a dark system turns it light (${await background(page)})`);
    check(problems.length === 0, `dark: no errors or dialogs${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.close();
  }
  // A link pressed in rich text opens in a new tab: Tab to it (the screen reader mirror's link) and press Enter.
  {
    const { page, problems } = await open(fragments.chart, { width: 656 });
    await painted(page, rgb(LIGHT));
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
  // The map's own script, inside the file.
  {
    const { page, problems, requests } = await open(fragments.map, { width: 656 });
    const p = await painted(page, rgb(LIGHT));
    const blobs = await page.evaluate(() => [...document.scripts].filter((s) => s.src.startsWith("blob:")).length);
    check(blobs === 2 && p.ink > 1500 && requests.length === 1, `a map unpacks the map script too and paints (${blobs} blob: scripts, ${p.ink} inked pixels)`);
    check(problems.length === 0, `map: no errors${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.screenshot({ path: join(out, "widget-map.png"), fullPage: true });
    await page.close();
  }
  // The Muse adapter: a fake bridge on the page, a press of an emit: button, and the action in the bridge's state.
  {
    const bridge = () => {
      window.__bridge = { state: null, writes: 0 };
      window.hatchWidget = {
        getState(defaults) { if (!window.__bridge.state) window.__bridge.state = JSON.parse(JSON.stringify(defaults)); return JSON.parse(JSON.stringify(window.__bridge.state)); },
        setState(next) {
          window.__bridge.state = JSON.parse(JSON.stringify(next));
          window.__bridge.writes++;
          setTimeout(() => window.dispatchEvent(new CustomEvent("hatch-widget-state", { detail: { state: JSON.parse(JSON.stringify(next)) } })), 0);
        },
      };
    };
    const { page, problems, requests } = await open(fragments.order, { width: 656, init: `(${bridge})()` });
    const p = await painted(page, rgb(LIGHT));
    check(p.ink > 500, `the hosted file paints (${p.ink} inked pixels)`);
    check(await page.evaluate(() => typeof document.querySelector("div[id^=sw-]").sayshapeHost === "function"), "the file carries the host adapter");
    const before = await page.evaluate(() => window.__bridge.state);
    check(!!before && before.actions?.length === 0, `the bridge starts with no actions (${JSON.stringify(before?.actions)})`);
    const box = await page.getByRole("button", { name: "Place order" }).boundingBox();
    check(!!box, "the emit: button is reachable by a screen reader");
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => (window.__bridge.state?.actions?.length ?? 0) > 0, null, { timeout: 5000 }).catch(() => {});
    const saved = await page.evaluate(() => window.__bridge.state);
    check(saved?.actions?.length === 1 && saved.actions[0].name === "submit_order" && typeof saved.actions[0].at === "string", `the press is in the bridge's state (${JSON.stringify(saved?.actions)})`);
    check(typeof saved?.spec === "string" && /^[0-9a-f]{8}-\d+$/.test(saved.spec), `the bridge state also holds the spec's fingerprint (${saved?.spec})`);
    check(requests.length === 1 && problems.length === 0, `hosted: nothing requested but the page, no errors${problems.length ? `: ${problems.join("; ")}` : ""}`);
    await page.screenshot({ path: join(out, "widget-hosted.png"), fullPage: true });
    await page.close();
  }
  // Where it can't unpack: a short plain note in place of the canvas, not a blank frame.
  {
    const { page } = await open(fragments.chart, { init: "delete window.DecompressionStream;" });
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => { const n = document.querySelector("p[id$=-note]"); return { shown: !n.hidden, text: n.textContent, canvas: getComputedStyle(document.querySelector("canvas")).display }; });
    check(state.shown && state.canvas === "none" && /can't unpack the SayShape engine/.test(state.text), `without DecompressionStream it shows a note in place of the canvas ("${state.text.slice(0, 60)}…")`);
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(widgets, { recursive: true, force: true });
  rmSync(hosted, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nThe widget file passed.");
