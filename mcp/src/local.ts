/**
 * This server and a client joined in memory, with no stdio or HTTP: exactly the tools, descriptions
 * and results a chat app gets. The library's benchmark uses it (eval/compare/mcp-route.ts) to
 * measure answers that go through the MCP server, quick start and sayshape_docs included.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerOptions } from "./server";

export async function connectLocal(opts: Partial<ServerOptions> = {}): Promise<Client> {
  const server = createServer({ uiHtml: () => "<!doctype html><title>SayShape</title>", ...opts });
  const client = new Client({ name: "sayshape-benchmark", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
