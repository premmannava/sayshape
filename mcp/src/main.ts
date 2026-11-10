#!/usr/bin/env node
/**
 * Runs the SayShape MCP server.
 *
 *   sayshape-mcp                 stdio, for Claude Desktop, Claude Code, VS Code, Goose…
 *   sayshape-mcp --data file.db  also let the model query a SQLite database (read-only)
 *   sayshape-mcp --theme-picker  show a theme selector above interfaces (off by default)
 *   sayshape-mcp --theme blue    the theme interfaces use: teal (default), purple, blue, neutral or studio
 *   sayshape-mcp --no-save-image hide the Save image button
 *   sayshape-mcp --no-copy-text  hide the Copy text button
 *   sayshape-mcp --scene         experimental: let models paint pictures and animations (off by default)
 *   sayshape-mcp --image-hosts cdn.example.com,*.images.example.com
 *                                hosts images may load from (none by default; https only)
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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cannotDrawViews, createServer, setImageHosts, setScenes } from "./server";
import { parseViewArgs, type ViewOptions } from "./ui/view-options";
import { DataSource } from "./data";
import { McpResultStore } from "./mcp-results";
import { createHttp, dataRefusal, listen, parseHttpArgs, startupLine } from "./http";

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
      "                    [--theme-picker] [--theme teal|purple|blue|neutral|studio] [--no-save-image] [--no-copy-text] [--scene]",
      "                    [--image-hosts host1,host2,...]",
      "",
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
      "  --no-save-image  hide the Save image button (shown where the chat app can download files)",
      "  --no-copy-text   hide the Copy text button",
      "  --scene          experimental: scenes, pictures and animations the model paints (off by default)",
      "  --image-hosts    hosts images may load from, comma-separated; *.example.com allows its subdomains",
      "                   (none by default; https only, and the host must send CORS headers)",
    ].join("\n"));
    return;
  }
  const view = parseViewArgs(args);
  // Experimental scenes: the server's parser and docs and the view must agree.
  setScenes(view.scene === true);
  // Images: the model's guide, the view's engine and the chat app's CSP all get the same list.
  setImageHosts(view.imageHosts ?? []);
  const httpAt = args.indexOf("--http");
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
  await logClient(createServer({ uiHtml, data, mcpResults, view })).connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
