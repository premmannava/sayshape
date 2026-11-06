# SayShape MCP server

Lets AI chat apps show SayShape interfaces **inside the conversation**. Ask a question, and instead of a wall of text the assistant answers with a working card, table, chart, form or calculator. SayShape's engine draws it on a canvas, right in the chat.

It's an [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server, so it works in any chat app that supports MCP Apps, such as Claude, ChatGPT, VS Code and Goose. Support differs between apps and versions.

```
you: "Compare the three phone plans I pasted"
  └─ model reads show_interface's quick start, asks sayshape_docs about the elements it'll use,
     then calls show_interface with a spec
       └─ the chat app shows the view: SayShape's engine draws the spec
            └─ you press a button with on=emit:… → it arrives back as a message
```

## What it offers

| | |
|---|---|
| `show_interface` | Takes a spec (and an optional title), checks it with SayShape's own parser and returns any skipped lines with line numbers, along with the docs for the elements on those lines. The chat app shows the result in the view. Its description carries a short quick start (about 450 tokens): the syntax, every element's name, every expression function and how to write for a chat. |
| `sayshape_docs` | Props and an example for just the elements the model names (a `table` brings its `table-column`), and topics on request: expressions, actions, lists, rules, examples, chat, database. |
| `ui://sayshape/interface.html` | The view: the SayShape engine, the Instrument Sans font and a small bridge script, all in one HTML file. It loads nothing from anywhere else. |

In chat apps that stream tool input, the interface builds line by line while the model is still writing it. When the person presses a button with `on=emit:name`, the view sends a message into the conversation naming the action, its value and the interface's current values. The model can then reply or show an updated interface. That's the only way anything leaves an interface: specs can't run code, open links or make requests.

Interfaces match the chat app they're in. The view follows its light or dark mode, and when the app shares its design tokens (MCP Apps hosts pass them as CSS variables) it takes the app's background, text, border and status colors, its fonts and its corner radii. Interfaces use SayShape's Teal theme unless the server is started with another (`--theme`); the theme follows the host's mode and applies to charts through the accent and series color tokens. The model's spec cannot set arbitrary CSS.

Above each interface, at the right, the view can show a slim toolbar:

- **Save image** (a download icon), in chat apps that let views download files (MCP Apps' `downloadFile` capability). It saves the interface as it looks now, after anything the person changed, as a sharp PNG (twice the screen's resolution, on the theme's background, without hover or messages) named after the interface's title, ready to paste into an email, a chat or a slide. Nothing is sent to the model.
- **A theme selector** for SayShape's Teal, Purple, Blue and Neutral presets, when the server is started with `--theme-picker`. Useful for demos; for a company, set its theme with `--theme` instead.

When neither is on, there's no toolbar at all. Whoever installs the server chooses, with flags in the chat app's `args`:

| Flag | Effect |
|---|---|
| `--theme-picker` | Show the theme selector (off by default) |
| `--theme teal\|purple\|blue\|neutral` | The theme interfaces use (default `teal`) |
| `--no-save-image` | Hide Save image (shown by default where the chat app can download) |

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--theme", "blue", "--theme-picker"] }
```

## Tokens

A model never reads the whole language guide (about 7,500 tokens). It gets a quick start in `show_interface`'s description (about 450) and asks `sayshape_docs` for only the elements it's about to use: about 140 tokens for a button, 700 for a chart and a table, 1,200 for a six-element dashboard. If it guesses an element wrong, the result of `show_interface` brings that element's docs, so a wrong guess costs one retry, not the whole guide. Retries are the expensive part, because each call resends the whole conversation, so the server avoids the needless ones: it quietly fixes Markdown fences and typographic quotes (the view tidies the same way), tells the model when a problem was only an ignored prop and needs no new call, and answers an unknown function like `argmax` with the one to use instead (`first(sort(rows, 'revenue', 'desc'))`). With a database, the rows go from the database to the interface, so the model's tokens don't grow with the data either.

Each call makes a new interface in the chat, so the server and view keep the chat tidy when a model calls more than it should, which smaller models often do. An interface with problems the model was asked to fix folds into a one-line "Fixing this interface" note, with a button to show it anyway in case no correction comes. The same interface sent again within ten minutes, without changes, is answered with "already showing" and folds into "Same interface as above". Repeats are tracked per conversation over stdio; the stateless HTTP mode doesn't track them.

## Show data from a database

Start the server with `--data` and a SQLite file, and the model can answer questions about it with interfaces:

```bash
node dist/server.js --data /path/to/database.db     # opened read-only
```

Three more tools appear:

| | |
|---|---|
| `describe_data` | The tables and views, their columns, row counts and how they join. |
| `query_data` | Runs one read-only `SELECT` and keeps the result (at most 500 rows) as a dataset. The model gets its id, columns and three sample rows, never the full result. |
| `fetch_dataset` | Only the interface can call this one (MCP Apps `visibility: ["app"]`): it loads a dataset's rows. |

The model then calls `show_interface` with `data={"sales": "d1"}` and writes `items=sales` in the spec. While the rows load, the chart, table and figures show placeholders in their own shape, then draw in when the rows arrive (and before the first line of a spec arrives, a placeholder card). The interface fetches the rows itself and fills them in, so **the numbers on screen come straight from the database and never pass through the model**. That keeps them exact, and the model's token use stays the same however many rows there are.

Safety: the file is opened read-only, so SQLite refuses any write. Only a single `SELECT` (or `WITH … SELECT`) is accepted, with no `ATTACH` or `PRAGMA`, and results are capped. Reading a database needs Node.js 22.13 or later, which has SQLite built in, so there's nothing else to install.

To try it, the [Chinook sample database](https://github.com/lerocha/chinook-database) (a small music store, MIT licence) works well: ask *"Show revenue by country as a chart and a table"* or *"Top 10 artists by tracks sold"*.

## Import structured MCP results (PR #44)

SayShape now normalizes **trusted upstream MCP tool results** into datasets. The model sees only a dataset id, column names and types, while **full rows go to the interface** via the existing app-only `fetch_dataset` call. It works without a database or copying rows through the language model.

### Try the bundled example (stdio)

From the `mcp/` directory after `npm run build`:

```bash
node dist/server.js --mcp-result examples/github-prs.json
```

Connect your stdio MCP host to that command. Ask: *"Call list_datasets and show a bar chart of checks_passed by PR number plus a table of title, author_login, status and checks_failed."*

The JSON file is a normal MCP tool result:

```json
{ "structuredContent": { "pull_requests": [{ "number": 44, "title": "Bridge", "author": { "login": "Ada" }, "checks_passed": 8 }] } }
```

Repeat `--mcp-result file.json` to import multiple results. The files come from a **trusted integration**; this is not a URL-fetching tool. Valid JSON text from an MCP tool's `content` array is also supported. The adapter preserves numeric and boolean fields, flattens nested fields (`author.login` becomes `author_login`), and normalizes unsafe names. Multiple potential arrays require an explicit `path` from the trusted caller. Imported results use `m1`, `m2` references, separate from the existing SQLite `d1`, `d2` references.

```text
model: list_datasets
  -> m1 (github-prs): 4 rows; columns: number number, title text, ...
model: show_interface({ spec: "chart ... items=prs ...", data: { prs: "m1" } })
view:  fetch_dataset({ id: "m1" })   # app-only, contains complete normalized rows
```

### Trusted programmatic integration

A trusted orchestrator that already talks to another MCP server can register its `client.callTool(...)` result directly, without feeding the rows back into the model:

```ts
import { McpResultStore } from "./src/mcp-results";
import { createServer } from "./src/server";

const store = new McpResultStore(); // one store per authorized user/session
const upstream = await githubClient.callTool({ name: "list_pull_requests", arguments: {} });
const dataset = store.ingest(upstream, { label: "GitHub PRs" });
// For ambiguous payloads, pass { path: "data.pullRequests.nodes" }.
const sayshape = createServer({ uiHtml: () => bundledUi, mcpResults: store });
// Connect sayshape to a trusted transport. list_datasets exposes dataset.id
// and fields; show_interface can render them without embedding rows.
```

This is a **source-level integration API**, not yet a published SDK. SayShape does **not** automatically discover, authorize or call other MCP servers, and buttons do not invoke arbitrary upstream tools. Those capabilities are separate work.

**Safety:** imported results are capped at 500 rows, 32 columns and 9,000 cells; long text is shortened. Keep one store per authorized user/session because dataset ids are references, **not access-control secrets**. For now `--mcp-result` is deliberately **stdio-only**: the current stateless HTTP transport has no per-user dataset isolation. SQLite's existing read-only mode remains unchanged.

## Install

You need Node.js 20 or later.

> **Not on npm yet.** Until it's published, build it from source and point your chat app at `dist/server.js` (see **From source** below), using `"command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js"]` in place of the `npx` lines. Once it's published, the `npx` settings below work as written.

**Claude Desktop:** Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

Quit Claude Desktop completely (Cmd+Q) and reopen it. If it can't find `npx`, use the full path that `which npx` prints.

**VS Code:** in `.vscode/mcp.json`:

```json
{
  "servers": {
    "sayshape": { "type": "stdio", "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

**Apps that connect to a URL** (custom connectors in Claude on the web, ChatGPT developer mode): run it over HTTP and put it behind HTTPS (a reverse proxy or a tunnel). It listens only on 127.0.0.1:

```bash
npx -y sayshape-mcp --http 3001    # http://127.0.0.1:3001/mcp
```

**From source**, to try changes before they're published:

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape/mcp && npm ci && npm run build
# then use "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js"]
```

Then ask for something visual: *"Show the 2022 World Cup final as a stat card"*, or *"Make me a tip calculator for $86 split three ways"*.

## Development

Publishing: `npm publish` from this folder runs the tests and the build first (`prepublishOnly`), then uploads `dist/`, this README and the license.

```bash
npm test           # server and helpers, against an in-memory MCP client
npm run typecheck
npm run build
npm run test:e2e   # the built view in Chromium, inside a sandboxed iframe driven by the MCP Apps host bridge
```

`test:e2e` runs the browser canvas/host-action test, the database-to-interface test, and the **stdio MCP result import test** (`scripts/e2e-import.mjs`). The last one starts the built server with `--mcp-result`, lists the imported schema, calls `show_interface` and verifies the exact rows delivered by app-only `fetch_dataset`. Screenshots from the browser tests go to `e2e-output/`.

The server bundles the engine from `../src`, so the guide, the parser and the view always match the library they were built with. The MCP packages (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`) are dependencies of this package only. The SayShape library itself still has none.
