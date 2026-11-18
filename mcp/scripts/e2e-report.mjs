// End-to-end check of reports, in a real browser, on every path that offers them: the built server is
// started with no flag (adaptive guides are the default), a report is sent as a model would on its first turn, and
//   - the view (dist/ui.html, as the server serves it, inside the MCP Apps host bridge) draws it: a chart,
//     the total and the filter are on the screen reader mirror, and pressing the filter changes the total;
//   - a widget file (--widget-dir, this server's own packed engine) draws it too;
//   - the CDN page path is never offered reports (its pinned engine predates them), so the server refuses
//     the spec there instead of making a page that can't draw it.
// --adaptive-guides is still accepted, for existing launch commands, and changes nothing.
//
//   npm run build && node scripts/e2e-report.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "vite";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });
const dist = process.env.SAYSHAPE_MCP_DIST ?? here("../dist/");
const server = join(dist, "server.js");
const widgets = mkdtempSync(join(tmpdir(), "sayshape-report-widgets-"));

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };

const REPORT = `report "Revenue" data=sales filter=region
  sum amount
  bar month amount
state sales=[{month: "Jan", region: "West", amount: 1200}, {month: "Jan", region: "East", amount: 800}, {month: "Feb", region: "West", amount: 1500}, {month: "Feb", region: "East", amount: 600}]
`;
const UI = { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } };

async function connect(args, caps) {
  const c = new Client({ name: "e2e-report", version: "1.0.0" }, caps);
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server, ...args], stderr: "pipe" }));
  return c;
}
const textOf = (r) => r.content?.[0]?.text ?? "";

// The server, as a chat app that draws views: the report is accepted on the first turn, and the view it serves draws reports.
const view = await connect([], UI);
const tools = (await view.listTools()).tools;
const description = tools.find((t) => t.name === "show_interface")?.description ?? "";
check(description.includes("A REPORT, ready to write"), "with no flag the report syntax is in show_interface's description");
const accepted = await view.callTool({ name: "show_interface", arguments: { spec: REPORT, title: "Revenue" } });
check(/^The interface is showing in the conversation, with no problems/.test(textOf(accepted)), "the report is accepted with no docs call");
const html = (await view.readResource({ uri: "ui://sayshape/interface.html" })).contents[0].text;
check(/<meta name="sayshape-view" content="[^"]*presets=1/.test(html), "the view the server serves is told to draw reports");
await view.close();

const flagged = await connect(["--adaptive-guides"], UI);
check(JSON.stringify((await flagged.listTools()).tools) === JSON.stringify(tools), "--adaptive-guides still starts the server, with the same tools as no flag");
await flagged.close();

// A text-only client on the CDN page: never offered reports, and a report is a problem to fix rather than a page.
const page = await connect([], undefined);
const pageDescription = (await page.listTools()).tools.find((t) => t.name === "show_interface")?.description ?? "";
check(!pageDescription.includes("A REPORT") && !/^- report:/m.test(pageDescription), "a client on the CDN page isn't offered reports");
const pageResult = textOf(await page.callTool({ name: "show_interface", arguments: { spec: REPORT } }));
check(/Unknown element "report"/.test(pageResult) && !/jsdelivr/.test(pageResult), "a report sent there anyway gets a problem to fix, not a page");
await page.close();

// A widget file: this server's own engine, with presets on.
const files = await connect(["--widget-dir", widgets], undefined);
const fileText = textOf(await files.callTool({ name: "show_interface", arguments: { spec: REPORT, title: "Revenue" } }));
const widgetPath = /^(\/\S+\.html)$/m.exec(fileText)?.[1] ?? "";
check(!!widgetPath, "a widget-file client gets a file for the report");
await files.close();

await build({
  logLevel: "warn",
  configFile: false,
  build: { outDir: out + "host-report", emptyOutDir: true, lib: { entry: here("../test/host/host.ts"), name: "TestHost", formats: ["iife"], fileName: () => "host.js" } },
});
const hostJs = readFileSync(out + "host-report/host.js", "utf8");

/** The words the engine put on the screen reader mirror: what's drawn, as text. */
const mirrorText = (frame) => frame.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" "));

const browser = await chromium.launch();
try {
  // The view, as Claude or ChatGPT run it.
  {
    const p = await browser.newPage({ viewport: { width: 680, height: 900 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("https://host.test/", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><body style="margin:20px;background:#fff"><script>${hostJs}</script></body>` }));
    await p.goto("https://host.test/");
    await p.evaluate((h) => window.TestHost.mount(h, "light"), html);
    await p.evaluate(() => window.host.ready);
    await p.evaluate((spec) => window.host.bridge.sendToolInput({ arguments: { spec } }), REPORT);
    await p.evaluate(() => window.host.bridge.sendToolResult({ content: [{ type: "text", text: "The interface is showing in the conversation, with no problems." }] }));
    await p.waitForTimeout(800);
    await p.screenshot({ path: out + "report-view.png" });
    const frame = p.frames().find((f) => f !== p.mainFrame());
    const words = await mirrorText(frame);
    check(/Revenue/.test(words) && /Amount by month/i.test(words), `the view draws the report's title and its chart ("${words.replace(/\s+/g, " ").slice(0, 120)}…")`);
    check(/\$4\.1K/.test(words), "the view shows the total of every row ($4.1K)");
    check(/Region/.test(words), "the view shows the region filter");
    check(errors.length === 0, `no errors in the view (${errors.join("; ")})`);
    await p.close();
  }
  // The widget file, in a bare page.
  {
    const fragment = readFileSync(widgetPath, "utf8");
    const p = await browser.newPage({ viewport: { width: 400, height: 900 } });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route("http://widget.test/widget.html", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0">${fragment}</body></html>` }));
    await p.goto("http://widget.test/widget.html");
    await p.waitForTimeout(1200);
    await p.screenshot({ path: out + "report-widget.png" });
    const words = await mirrorText(p.mainFrame());
    check(/Amount by month/i.test(words) && /\$4\.1K/.test(words), `the widget file draws the report's chart and total ("${words.replace(/\s+/g, " ").slice(0, 120)}…")`);
    check(errors.length === 0, `no errors in the widget (${errors.join("; ")})`);
    await p.close();
  }
} finally {
  await browser.close();
  rmSync(widgets, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nReports draw on every path that offers them.");
