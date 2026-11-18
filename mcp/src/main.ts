#!/usr/bin/env node
/**
 * Runs the SayShape MCP server.
 *
 *   sayshape-mcp                 stdio, for Claude Desktop, Claude Code, VS Code, Goose…
 *   sayshape-mcp --data file.db  also let the model query a SQLite database (read-only)
 *   sayshape-mcp --theme-picker  show a theme selector above interfaces (off by default)
 *   sayshape-mcp --theme blue    the theme interfaces use: teal (default), purple, blue, neutral or studio
 *   sayshape-mcp --accent "#e4572e"  a brand color for buttons, highlights and charts (made readable
 *                                in light and dark; says so at startup when it had to change it)
 *   sayshape-mcp --colors "#e4572e,#2e86ab"  up to six brand colors: the first is the accent, the rest
 *                                follow as chart series, and series not covered are worked out from the first
 *   sayshape-mcp --no-model-colors  no colors argument on show_interface, so the conversation can't change
 *                                the colors (the operator's --colors, the theme or the chat app's stay)
 *   sayshape-mcp --no-save-image hide the Save image button
 *   sayshape-mcp --no-copy-text  hide the Copy text button
 *   sayshape-mcp --no-select-text  no invisible text layer: words can't be selected or found with Ctrl+F
 *   sayshape-mcp --no-chat-look    the theme's background behind interfaces, as before
 *   sayshape-mcp --select-touch    let a long press on a touch screen select a word (off by default for now)
 *   sayshape-mcp --scene         experimental: let models paint pictures and animations (off by default)
 *   sayshape-mcp --logo https://cdn.example.com/logo.png   a logo in the corner of every slide of a deck
 *                                (slide decks need no flag; --slides is accepted and does nothing)
 *   sayshape-mcp --behavior      experimental: rules that tick and, with --scene, shapes people drag (off by default)
 *   sayshape-mcp --image-hosts cdn.example.com,*.images.example.com
 *                                the only hosts images may load from (https only; left out, the sites
 *                                models know image addresses on, COMMON_IMAGE_HOSTS in src/images.ts)
 *   sayshape-mcp --no-image-hosts  no images from anywhere
 *   sayshape-mcp --widget-dir <folder>  for chat apps that can't draw MCP Apps views but can show a widget
 *                                made from a file: write each interface there as one self-contained file
 *                                (stdio only; not with --http)
 *   sayshape-mcp --widget-dir <folder> --widget-inline
 *                                with --widget-dir: write the engine into each file as plain script text, for
 *                                chat apps that run a file's own scripts but no blob: script (Antigravity)
 *   sayshape-mcp --widget-dir <folder> --widget-host muse
 *                                with --widget-dir: hook that chat app's adapter into each file, so
 *                                emit: presses and the interface's state are saved for the model's next turn
 *   sayshape-mcp --http [port]   Streamable HTTP on /mcp, for clients that connect to a URL
 *                                (port: the flag, else PORT, else 3001). Put it behind HTTPS
 *                                before exposing it beyond this computer.
 *     --host <address>           where it listens (else HOST if it's an IP address, else 127.0.0.1);
 *                                0.0.0.0 on a container host
 *     --rate-limit <n>           calls a minute per client address; 0 turns it off. Default 300
 *                                beyond loopback, off on loopback
 *     --trust-proxy [hops]       count calls by X-Forwarded-For, written by this many proxies
 *                                in front of the server (default 1). Only behind a proxy you run
 *     --allow-public-data        let --data run beyond loopback (refused otherwise: anyone could
 *                                read the whole database)
 *   GET / answers 200 as a health check. Requests have time and size limits;
 *   nothing from a request is logged (http.ts).
 *
 * SAYSHAPE_LOG_CLIENT=1 writes each client's name, version and capabilities to
 * stderr when it connects, to see which chat apps announce MCP Apps
 * ("io.modelcontextprotocol/ui") and which get the text-only page.
 */
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cannotDrawViews, createServer, setBehavior, setImageHosts, setLayoutFirst, setScenes } from "./server";
import { accentNotes, parseViewArgs, type ViewOptions } from "./ui/view-options";
import { DataSource } from "./data";
import { McpResultStore } from "./mcp-results";
import { createHttp, dataRefusal, listen, parseHttpArgs, startupLine } from "./http";
import { loadPackedEngine } from "./widget-engine";
import { WIDGET_HOST_NAMES, isWidgetHost, widgetHostRefusal, type WidgetHostName } from "./widget-hosts";

// dist/server.js and dist/ui.html sit side by side.
const UI_PATH = fileURLToPath(new URL("./ui.html", import.meta.url));
let uiCache: Promise<string> | null = null;
const uiHtml = () => (uiCache ??= readFile(UI_PATH, "utf8"));

/** SAYSHAPE_LOG_CLIENT: say what the client announced, once it has connected. */
function logClient(server: McpServer): McpServer {
  if (!process.env.SAYSHAPE_LOG_CLIENT) return server;
  // createServer sets its own oninitialized (the text-only description); keep it.
  const before = server.server.oninitialized;
  server.server.oninitialized = () => {
    before?.();
    const client = server.server.getClientVersion();
    const caps = JSON.stringify(server.server.getClientCapabilities() ?? {});
    console.error(`SayShape: ${client?.name ?? "a client"} ${client?.version ?? ""} connected; ${cannotDrawViews(server) ? "no MCP Apps, so show_interface gives a page" : "draws MCP Apps views"}; capabilities ${caps}`);
  };
  return server;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.error([
      "Usage: sayshape-mcp [--data database.db] [--mcp-result result.json ...]",
      "                    [--http [port] [--host address] [--rate-limit n] [--trust-proxy [hops]] [--allow-public-data]]",
      "                    [--theme-picker] [--theme teal|purple|blue|neutral|studio] [--accent color | --colors list]",
      "                    [--no-model-colors] [--no-save-image] [--no-copy-text] [--no-select-text] [--no-chat-look] [--select-touch] [--scene] [--behavior] [--layout-first] [--logo <https url>]",
      "                    [--image-hosts host1,host2,... | --no-image-hosts] [--widget-dir folder [--widget-inline] [--widget-host name]]",
      "",
      "  --widget-dir <folder>  for chat apps that can't draw interfaces but can show a widget made from a file:",
      "                      write each interface there as one self-contained file, named by a hash of the",
      "                      spec and settings (the newest 50 are kept); stdio only, refused with --http",
      "  --widget-inline     with --widget-dir: put the engine in each file as plain script text (about twice the",
      "                      size), for chat apps that show the file but say the engine didn't start",
      `  --widget-host <name>  with --widget-dir: hook a chat app's adapter into each file so emit: presses and the`,
      "                      interface's state are saved for the model's next turn; hosts: " + WIDGET_HOST_NAMES.join(", "),
      "  --http [port]       Streamable HTTP on /mcp instead of stdio; port from the flag, else PORT, else 3001",
      "  --host <address>    where to listen: 127.0.0.1 by default, else HOST if it's an IP address;",
      "                      0.0.0.0 to take requests from other machines (behind an HTTPS proxy)",
      "  --rate-limit <n>    calls a minute per client address (0: off); default 300 beyond loopback, off on it",
      "  --trust-proxy [n]   count calls by X-Forwarded-For, as written by n proxies in front (default 1);",
      "                      only behind proxies you run, or clients can choose their own address",
      "  --allow-public-data let --data run beyond loopback (refused otherwise: anyone could read the database)",
      "  GET / answers 200 as a health check. Nothing from a request is logged.",
      "",
      "  --theme-picker   show a theme selector above each interface (off by default)",
      "  --theme <name>   the theme interfaces use: teal (default), purple, blue, neutral or studio",
      "  --accent <color> a brand color, such as \"#e4572e\", for buttons, highlights and charts;",
      "                   darkened or lightened where it would be hard to read",
      "  --colors <list>  up to six brand colors, comma-separated, most important first, in one argument:",
      "                   --colors \"#e4572e,#2e86ab,#f2c14e\". The first is the accent and the first chart",
      "                   series, the rest are the next series, and any series the list doesn't cover are",
      "                   worked out from the first. --accent is the same with one color; use one of the two",
      "  --no-model-colors  take away show_interface's colors argument, which a model sends when the person",
      "                   (or its instructions) named colors to use; without it, only the server's colors,",
      "                   the theme and the chat app's own color apply",
      "  --no-save-image  hide the Save image button (shown where the chat app can download files)",
      "  --no-copy-text   hide the Copy text button",
      "  --no-select-text  turn off the invisible text layer that lets people select, copy and find (Ctrl+F) the words",
      "  --no-chat-look    paint the theme's background behind each interface, as before, instead of letting",
      "                    the chat app's own background show through",
      "  --select-touch    let a long press on a touch screen select a word, with the phone's own handles (off by default until checked on real phones)",
      "  --scene          experimental: scenes, pictures and animations the model paints (off by default)",
      "  --logo <url>     an https image drawn small in the corner of every slide of a deck (its host is allowed like --image-hosts)",
      "  --slides         does nothing: slide decks (deck, slide) are always on; kept so existing setups still start",
      "  --behavior       experimental: rules that tick (timers, simulations) and, with --scene, dragging (off by default)",
      "  --layout-first   tell models to write the layout first and the data last, so an interface draws while it is written (off by default)",
      "  --image-hosts    the only hosts images may load from, comma-separated; *.example.com allows its subdomains",
      "                   (https only, and the host must send CORS headers; left out, images load from the",
      "                   well-known sites models know addresses on, such as upload.wikimedia.org and images.unsplash.com)",
      "  --no-image-hosts no images from anywhere",
    ].join("\n"));
    return;
  }
  const view = parseViewArgs(args);
  for (const note of accentNotes(view)) console.error(`SayShape: ${note}`);
  // Experimental scenes: the server's parser and docs and the view must agree.
  setScenes(view.scene === true);
  setBehavior(view.behavior === true);
  // Layout first: only the model's guide changes; the view already draws placeholders while a spec streams in.
  setLayoutFirst(args.includes("--layout-first"));
  // Images: the model's guide, the view's engine and the chat app's CSP all get the same list.
  setImageHosts(view.imageHosts ?? []);
  const httpAt = args.indexOf("--http");
  const widgetAt = args.indexOf("--widget-dir");
  let widgetDir: string | undefined;
  const hostAt = args.indexOf("--widget-host");
  let widgetHost: WidgetHostName | undefined;
  if (hostAt >= 0) {
    const refusal = widgetHostRefusal(args[hostAt + 1], widgetAt >= 0);
    if (refusal) throw new Error(refusal);
    const name = args[hostAt + 1];
    if (name === undefined || !isWidgetHost(name)) throw new Error("unreachable: widgetHostRefusal checked the name");
    widgetHost = name;
  }
  const widgetInline = args.includes("--widget-inline");
  if (widgetInline && widgetAt < 0) throw new Error("--widget-inline only applies with --widget-dir: it changes how the widget files are written. Add --widget-dir <folder>, or leave --widget-inline out.");
  if (widgetAt >= 0) {
    if (httpAt >= 0) throw new Error("--widget-dir can't be used with --http: it writes files on this computer for a chat app on this computer to read, and an HTTP server's callers can't read them.");
    const raw = args[widgetAt + 1];
    if (!raw || raw.startsWith("--")) throw new Error("--widget-dir needs the folder to write widget files into.");
    widgetDir = resolve(raw);
    // Fail now, not on the first interface: the folder must be writable and the engine for its files built.
    try {
      await mkdir(widgetDir, { recursive: true });
      await access(widgetDir, constants.W_OK);
    } catch (e) {
      throw new Error(`--widget-dir ${widgetDir} can't be written to: ${e instanceof Error ? e.message : String(e)}`);
    }
    await loadPackedEngine();
    console.error(`SayShape: chat apps that can't draw interfaces get a widget file in ${widgetDir}${widgetInline ? ", with the engine as plain script text" : ""}${widgetHost ? `, hooked to ${widgetHost}` : ""}`);
  }
  if (httpAt < 0) {
    for (const flag of ["--host", "--rate-limit", "--trust-proxy", "--allow-public-data"]) {
      if (args.includes(flag)) throw new Error(`${flag} only applies with --http.`);
    }
  }
  // Read before opening a database, so a public --data is refused before anything is read.
  const http = httpAt >= 0 ? parseHttpArgs(args, process.env) : null;
  const refusal = http && dataRefusal(args.includes("--data"), http.options);
  if (refusal) throw new Error(refusal);
  const dataAt = args.indexOf("--data");
  let data: DataSource | undefined;
  if (dataAt >= 0) {
    const path = args[dataAt + 1];
    if (!path || path.startsWith("--")) throw new Error("--data needs the path to a SQLite database file.");
    data = await DataSource.open(path);
    console.error(`SayShape: reading ${path} (read-only)`);
  }
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--mcp-result") continue;
    const path = args[++i];
    if (!path || path.startsWith("--")) throw new Error("--mcp-result needs a JSON file path.");
    files.push(path);
  }
  // Dataset references are not credentials. Do not expose imported private
  // results to all HTTP callers until authenticated session isolation lands.
  if (httpAt >= 0 && files.length) {
    throw new Error("--mcp-result is stdio-only. Shared HTTP datasets need authenticated session isolation.");
  }
  let mcpResults: McpResultStore | undefined;
  if (files.length) {
    mcpResults = new McpResultStore();
    for (const path of files) {
      const raw = await readFile(path, "utf8");
      if (raw.length > 5_000_000) throw new Error("MCP result JSON exceeds the 5 MB import limit.");
      const value = JSON.parse(raw) as unknown;
      const label = basename(path).replace(/\.json$/i, "");
      const d = mcpResults.ingest(value, { label });
      console.error("SayShape: imported " + label + " as " + d.id + " (" + d.rows.length + " rows)");
    }
  }
  if (http) {
    for (const note of http.notes) console.error(`SayShape: ${note}`);
    const server = createHttp(() => logClient(createServer({ uiHtml, data, view })), http.options);
    const port = await listen(server, http.options.host, http.options.port);
    console.error(startupLine(http.options, port));
    return;
  }
  // stdout carries the protocol, so anything for people goes to stderr.
  await logClient(createServer({ uiHtml, data, mcpResults, view, ...(widgetDir ? { widgetDir, widgetInline } : {}), ...(widgetHost ? { widgetHost: { name: widgetHost, ignoreAppColors: args.includes("--theme") || args.includes("--accent") || args.includes("--colors") } } : {}) })).connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
