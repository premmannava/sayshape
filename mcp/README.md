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
- **Copy text** (a copy icon). A canvas has no text to select, so this copies the whole interface as it is now: headings and text as lines, fields as "Label: value", checkboxes as [x] or [ ], and tables and chart data as tab-separated rows that paste straight into Excel or Google Sheets as cells. Buttons are left out and passwords are never copied. Ctrl+C (Cmd+C on a Mac) does the same unless the person is typing in a field. The server asks the chat app for clipboard access; where it isn't given, the view says so. Nothing is sent to the model.
- **A theme selector** for SayShape's Teal, Purple, Blue and Neutral presets, when the server is started with `--theme-picker`. Useful for demos; for a company, set its theme with `--theme` instead.

When none is on, there's no toolbar at all. Whoever installs the server chooses, with flags in the chat app's `args`:

| Flag | Effect |
|---|---|
| `--theme-picker` | Show the theme selector (off by default) |
| `--theme teal\|purple\|blue\|neutral\|studio` | The theme interfaces use (default `teal`). `studio` is the Studio look: Inter, rounder corners and an indigo-to-violet accent |
| `--no-save-image` | Hide Save image (shown by default where the chat app can download) |
| `--no-copy-text` | Hide Copy text, and leave Ctrl+C alone (shown by default) |
| `--scene` | **Experimental.** Turn on scenes: pictures and animations the model paints from shapes (off by default). Leave it out to turn them off again. |
| `--image-hosts cdn.example.com,*.img.example.com` | Hosts `image` elements may load from, comma-separated; `*.example.com` allows its subdomains. None by default, so no images show. See [Images](#images). |

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--theme", "blue", "--theme-picker"] }
```

### Images

The view has no website of its own, so an `image` only loads from a host you list with `--image-hosts`, usually your company's image CDN:

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--image-hosts", "cdn.acme.com,images.unsplash.com"] }
```

The one list does three things: the view's engine loads from those hosts and no others, the server asks the chat app to allow them in the view's Content Security Policy (MCP Apps `resourceDomains`), and the model is told which hosts work, so it doesn't invent URLs elsewhere. Images must be https, and the host must send CORS headers (`Access-Control-Allow-Origin`), as image CDNs do, because the view keeps its canvas readable for Save image and Copy text. An image that can't load shows its description instead. Some chat apps may not honour a view's CSP request; then images show their descriptions there.

## In chat apps that can't draw interfaces

Coding agents and other text-only clients (Claude Code, Codex, Antigravity and others) call `show_interface` but can't show MCP Apps views. When a client connects without announcing MCP Apps support (the `io.modelcontextprotocol/ui` capability), and the spec has nothing to fix, `show_interface`'s text result carries a small, complete HTML page instead, with two sentences telling the model what to do with it: publish it as a page if it has a tool for that, or save it as an `.html` file and give the person its path to open in a browser. The server itself writes no files. Clients that draw views get exactly what they got before.

The page is a few kilobytes plus the spec: a canvas, the engine loaded from jsDelivr (`sayshape@<version>/dist/sayshape.global.js`, and the map's own script when the spec has a map), and the spec embedded as JSON with `<` escaped, so nothing in it can end the script. It follows light and dark mode, and a `data-theme="light"` or `"dark"` on its root element; its background is the engine theme's own; and it fits a phone with no sideways scrolling.

A page outside the chat has no conversation to send `emit:` actions to, so for these clients only:

- **The model is told not to use `emit:`.** Their quick start (in `show_interface`'s description and `sayshape_docs` with nothing named) says to leave it out and ask the person to reply in the chat instead.
- **A spec with `emit:` gets it back to fix**, line by line, with no page until it's gone. Buttons can keep `set:`, `go:` or `notify:`, so they still do something on the page. Everything else in the interface (state, controls, charts, screens) works.
- **Links pressed in `rich=true` text open in a new tab** (https only). In the chat they're sent to the model as `emit:link`; on the page, the page is the host, so it opens them as any web page would.

Clients that draw views see none of this: the same descriptions, the same docs and the same results as before.

What doesn't work there:

- **Save image and Copy text** aren't on the page.
- **It needs internet access** to load the engine from the CDN; without it, or before the pinned version is on the CDN, the page names the engine version that didn't load.
- **Interfaces that load datasets** (`--data`, `--mcp-result`) can't be shown: the page has no way to fetch rows, and the rows never go through the conversation. The model is told so and answers in text.
- It uses the default Teal light and dark themes; `--theme`, `--theme-picker` and the chat app's own colors and fonts apply only to the view.
- The engine version is pinned and moves at releases, so the page can be one release behind the server: an element added in the newest release may not draw there yet. ([Why](https://github.com/premmannava/sayshape/blob/main/docs/releasing.md#the-engine-version-the-text-only-page-loads).)
- In `--http` mode the server makes a new server for every request and never sees what the client announced, so it always answers as for a client that draws views.

The same interface sent again gets no second page, and a spec with problems gets them to fix first, with no page. To see what a client announces, start the server with `SAYSHAPE_LOG_CLIENT=1` in its environment: each connection writes the client's name and capabilities to stderr.

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

`test:e2e` runs the browser canvas/host-action test, the database-to-interface test, the **text-only page test** (`scripts/e2e-fallback.mjs`: a client without MCP Apps gets a page, which is opened from a file in Chromium with the engine built from `../src` standing in for jsDelivr, and must paint in light, dark and `data-theme`, fit 400px and keep a spec containing `</script>` inert), and the **stdio MCP result import test** (`scripts/e2e-import.mjs`). The last one starts the built server with `--mcp-result`, lists the imported schema, calls `show_interface` and verifies the exact rows delivered by app-only `fetch_dataset`. Screenshots from the browser tests go to `e2e-output/`.

The server bundles the engine from `../src`, so the guide, the parser and the view always match the library they were built with. The MCP packages (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`) are dependencies of this package only. The SayShape library itself still has none.
