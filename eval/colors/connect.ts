/**
 * The MCP server as a chat app that draws MCP Apps views gets it: the real tools, descriptions and results,
 * from the real server (mcp/src/server.ts) joined to a client in memory, and a client that announces the
 * MCP Apps extension, as Claude and ChatGPT do. (A client that doesn't gets the text-only fallback, which
 * is another conversation.) One server per conversation: it remembers the last interface it showed, to
 * catch a model sending the same one twice, and that belongs to one conversation.
 *
 * The server lives in mcp/ with its own packages, so this loads it only when it runs: install them first
 * with `npm install --prefix mcp`. This file imports the SDK from mcp/node_modules by path, the same copy
 * the server uses, so the library needs none of mcp/'s packages to typecheck.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Backend, ToolDef } from "./run";

const MCP_DIR = fileURLToPath(new URL("../../mcp/", import.meta.url));

/** The tools the people in these conversations can use: show_interface and sayshape_docs. */
export const TOOL_NAMES = ["show_interface", "sayshape_docs"];

interface McpClient {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> }>;
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>;
  getInstructions(): string | undefined;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

/** The file a package's exports gives for a subpath ("." or "./server"), as an absolute file URL. */
export function packageFile(pkg: string, subpath: string): string {
  const dir = `${MCP_DIR}node_modules/${pkg}/`;
  const json = JSON.parse(readFileSync(`${dir}package.json`, "utf8")) as { exports?: Record<string, unknown> };
  const entry = json.exports?.[subpath] ?? json.exports?.[subpath.replace(/[^/]+$/, "*")];
  const pick = (e: unknown): string | undefined =>
    typeof e === "string" ? e : e && typeof e === "object" ? pick((e as Record<string, unknown>).import ?? (e as Record<string, unknown>).default) : undefined;
  const rel = pick(entry);
  if (!rel) throw new Error(`${pkg} has no export ${subpath}`);
  const file = rel.includes("*") ? rel.replace("*", subpath.replace(/^.*\//, "")) : rel;
  return pathToFileURL(`${dir}${file}`).href;
}

export async function load<T>(url: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ url)) as T;
  } catch (e) {
    throw new Error(`This needs the MCP server's packages: run npm install --prefix mcp (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** A fresh in-memory server and a view client, as one conversation's backend. */
export async function connectView(): Promise<Backend> {
  const serverModule = await load<{ createServer: (o: { uiHtml: () => string }) => { connect(t: unknown): Promise<void> } }>(pathToFileURL(`${MCP_DIR}src/server.ts`).href);
  const sdk = await load<{ Client: new (info: { name: string; version: string }, opts: unknown) => McpClient }>(packageFile("@modelcontextprotocol/sdk", "./client"));
  const memory = await load<{ InMemoryTransport: { createLinkedPair(): [unknown, unknown] } }>(packageFile("@modelcontextprotocol/sdk", "./inMemory.js"));
  const apps = await load<{ EXTENSION_ID: string; RESOURCE_MIME_TYPE: string }>(packageFile("@modelcontextprotocol/ext-apps", "./server"));

  const server = serverModule.createServer({ uiHtml: () => "<!doctype html><title>SayShape</title>" });
  const client = new sdk.Client(
    { name: "colors-eval", version: "1.0.0" },
    { capabilities: { extensions: { [apps.EXTENSION_ID]: { mimeTypes: [apps.RESOURCE_MIME_TYPE] } } } },
  );
  const [clientSide, serverSide] = memory.InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const tools: ToolDef[] = (await client.listTools()).tools
    .filter((t) => TOOL_NAMES.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  return {
    tools,
    instructions: client.getInstructions() ?? "",
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args });
      return (r.content ?? []).map((c) => c.text ?? "").join("\n");
    },
    close: () => client.close(),
  };
}
