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
 *   sayshape-mcp --http [port]   Streamable HTTP on /mcp (default port 3001), for
 *                                clients that connect to a URL. Bind it behind
 *                                HTTPS before exposing it beyond localhost.
 */
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, setImageHosts, setScenes } from "./server";
import { parseViewArgs, type ViewOptions } from "./ui/view-options";
import { DataSource } from "./data";
import { McpResultStore } from "./mcp-results";

// dist/server.js and dist/ui.html sit side by side.
const UI_PATH = fileURLToPath(new URL("./ui.html", import.meta.url));
let uiCache: Promise<string> | null = null;
const uiHtml = () => (uiCache ??= readFile(UI_PATH, "utf8"));

const MAX_BODY_BYTES = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

async function serveHttp(port: number, data: DataSource | undefined, view: ViewOptions): Promise<void> {
  const http = createHttpServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("SayShape MCP server: use /mcp\n");
      return;
    }
    if (req.method !== "POST") {
      // Stateless: no server-sent event streams to resume and no sessions to end.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    try {
      const body = await readJson(req);
      // A fresh server and transport per request keeps requests independent.
      // Datasets live in the shared DataSource, so a later request (the interface fetching rows) finds them.
      const server = createServer({ uiHtml, data, view });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null }));
    }
  });
  await new Promise<void>((done) => http.listen(port, "127.0.0.1", done));
  console.error(`SayShape MCP server on http://127.0.0.1:${port}/mcp`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.error([
      "Usage: sayshape-mcp [--data database.db] [--mcp-result result.json ...] [--http [port]]",
      "                    [--theme-picker] [--theme teal|purple|blue|neutral|studio] [--no-save-image] [--no-copy-text] [--scene]",
      "                    [--image-hosts host1,host2,...]",
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
  const dataAt = args.indexOf("--data");
  let data: DataSource | undefined;
  if (dataAt >= 0) {
    const path = args[dataAt + 1];
    if (!path || path.startsWith("--")) throw new Error("--data needs the path to a SQLite database file.");
    data = await DataSource.open(path);
    console.error(`SayShape: reading ${path} (read-only)`);
  }
  const httpAt = args.indexOf("--http");
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
  if (httpAt >= 0) {
    const port = Number(args[httpAt + 1] ?? 3001);
    await serveHttp(Number.isInteger(port) && port > 0 ? port : 3001, data, view);
    return;
  }
  // stdout carries the protocol, so anything for people goes to stderr.
  await createServer({ uiHtml, data, mcpResults, view }).connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
