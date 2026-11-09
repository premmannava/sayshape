// End-to-end check: the built stdio package imports an external MCP result JSON
// and exposes only its schema to the model; the app-only fetch returns real rows.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// SAYSHAPE_MCP_DIST points the check at another build, such as the one inside an installed npm package.
const dist = process.env.SAYSHAPE_MCP_DIST ?? fileURLToPath(new URL("../dist/", import.meta.url));
const serverPath = join(dist, "server.js");
const samplePath = fileURLToPath(new URL("../examples/github-prs.json", import.meta.url));

const forbidden = spawnSync(process.execPath,
  [serverPath, "--mcp-result", samplePath, "--http", "3001"], { encoding: "utf8", timeout: 12000 });
assert.notEqual(forbidden.status, 0, "Shared unauthenticated HTTP import must be refused");
assert.match(forbidden.stderr, /stdio-only/);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath, "--mcp-result", samplePath],
  stderr: "pipe",
});
const client = new Client({ name: "sayshape-import-e2e", version: "1.0.0" });
await client.connect(transport);
try {
  const tools = (await client.listTools()).tools;
  assert(tools.some((t) => t.name === "list_datasets"));
  assert(!tools.some((t) => t.name === "query_data"));
  const fetch = tools.find((t) => t.name === "fetch_dataset");
  assert.deepEqual(fetch?._meta?.ui?.visibility, ["app"]);

  const listed = await client.callTool({ name: "list_datasets", arguments: {} });
  const intro = listed.content[0]?.text ?? "";
  assert.match(intro, /m1 \(github-prs\): 4 rows/);
  assert.match(intro, /checks_passed number/);
  assert(!intro.includes("Premium bars and KPIs"), "Model should not receive the full records");

  const spec = 'card\n  chart "CI checks" kind=bar items=prs x=number y=checks_passed\n  table "PRs" items=prs key=number\n    table-column "Title" field=title\n    table-column "Author" field=author_login\n    table-column "Failures" field=checks_failed format=number\n';
  const shown = await client.callTool({
    name: "show_interface", arguments: { spec, data: { prs: "m1" } },
  });
  assert(!shown.isError, "The imported dataset must render without a tool error");
  assert.equal(shown.structuredContent?.toFix, 0);
  assert(!JSON.stringify(shown).includes("Premium bars and KPIs"), "No full rows in show_interface result");

  const full = await client.callTool({ name: "fetch_dataset", arguments: { id: "m1" } });
  assert(!full.isError);
  assert.equal(full.structuredContent?.rows?.length, 4);
  assert.equal(full.structuredContent?.rows?.[0]?.author_login, "premmannava");
  assert.equal(full.structuredContent?.rows?.[0]?.checks_passed, 12);
  assert.equal(full.structuredContent?.rows?.[3]?.draft, true);
  assert.equal(full.structuredContent?.truncated, false);
  console.log("MCP import CLI end-to-end: all checks passed.");
} finally {
  await client.close();
}
