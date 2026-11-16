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
- **Copy text** (a copy icon). With nothing selected, this copies the whole interface as it is now: headings and text as lines, fields as "Label: value", checkboxes as [x] or [ ], and tables and chart data as tab-separated rows that paste straight into Excel or Google Sheets as cells. Buttons are left out and passwords are never copied. Ctrl+C (Cmd+C on a Mac) does the same unless the person is typing in a field. The server asks the chat app for clipboard access; where it isn't given, the view says so. Nothing is sent to the model.
- **Save as PDF, Save as PowerPoint and Present**, while a slide deck is showing. See [Slide decks](#slide-decks).
- **A theme selector** for SayShape's Teal, Purple, Blue and Neutral presets, when the server is started with `--theme-picker`. Useful for demos; for a company, set its theme with `--theme` instead.

When none is on, there's no toolbar at all. Whoever installs the server chooses, with flags in the chat app's `args`:

| Flag | Effect |
|---|---|
| `--theme-picker` | Show the theme selector (off by default) |
| `--theme teal\|purple\|blue\|neutral\|studio` | The theme interfaces use (default `teal`). `studio` is the Studio look: Inter, rounder corners and an indigo-to-violet accent |
| `--accent "#e4572e"` | A brand color (hex, `#rrggbb` or `#rgb`) for buttons, highlights and charts' first series, laid over the theme. The same as `--colors` with one color: the other five chart series are worked out from it. Text in it must stay readable (4.5:1), and no color manages that on both white and near-black, so it's darkened in light mode or lightened in dark mode where needed; the server says at startup what each mode uses. Without `--accent` or `--colors`, a few known chat apps (Claude, ChatGPT, VS Code, Gemini, Grok) get their own brand color as the accent, unless the person picks a theme in the selector or `--theme` is not the default |
| `--colors "#e4572e,#2e86ab,#f2c14e"` | Up to six brand colors, hex, in one quoted argument separated by commas, most important first. The first does what `--accent` does (buttons, highlights, the first chart series); the rest are the next chart series in that order, each made readable (3:1); the series the list does not cover are worked out from the first color, kept quieter so it stays the strongest, and away from the colors used for good and bad. A color too like an earlier one is replaced by a worked-out one. Only the accent and the chart series change: surface, text, lines and the good, warn and bad colors still follow the chat app. A bad entry, an empty one or more than six stops the server at startup and names the problem. Use either `--colors` or `--accent`, not both |
| `--no-model-colors` | Take away `show_interface`'s `colors` argument. Without this flag, a model sends `colors` (a list of hex colors, most important first) only when the person, or its instructions, named colors to use; they're drawn over everything above (the server's `--colors`, a theme the person picked, the chat app's color), entries that aren't hex colors are ignored, and the result reminds the model to send the same colors on later calls in the conversation, since nothing is stored. With the flag, the tool is exactly what it was before the argument existed and the view ignores colors sent anyway. Chat apps that can't draw views draw the page in them (see below) and get the same reminder; `--widget-dir` files don't use the argument yet |
| `--no-save-image` | Hide Save image (shown by default where the chat app can download) |
| `--no-copy-text` | Hide Copy text, and leave Ctrl+C alone (shown by default) |
| `--select-touch` | Let a long press on a touch screen select the word under the finger, with the phone's own handles and Copy menu. Off by default until it has been checked on real phones; `--no-select-touch` says off explicitly. Mouse and pen selection are unaffected |
| `--no-select-text` | No invisible text layer: words can't be selected by dragging or found with Ctrl/Cmd+F, and nothing extra is added to the page (on by default) |
| `--scene` | **Experimental.** Turn on scenes: pictures and animations the model paints from shapes, with parts people can press and soft shadows, glow and shine for depth (off by default). Leave it out to turn them off again. |
| `--behavior` | **Experimental.** Turn on behavior: things that change by themselves on a timer (a countdown, a simulation) and, together with `--scene`, shapes people drag (off by default). Rules only change the interface's own values; they still can't run code. Chat apps that can't draw views don't get it. |
| `--logo https://cdn.example.com/logo.png` | An https image drawn small in the corner of every slide of a deck. Its host is allowed like `--image-hosts`, so the logo loads. See [Slide decks](#slide-decks). |
| `--slides` | Does nothing. Slide decks need no flag; this is accepted so setups written for an earlier version still start. |
| `--image-hosts cdn.example.com,*.img.example.com` | Hosts `image` elements may load from, comma-separated; `*.example.com` allows its subdomains. None by default, so no images show. See [Images](#images). |
| `--widget-dir <folder>` | For chat apps that can't draw MCP Apps views but can show a widget made from a file: write each interface there as one self-contained file (stdio only; refused with `--http`). Off by default. See [Chat apps that show widgets from files](#chat-apps-that-show-widgets-from-files). |
| `--widget-host <name>` | With `--widget-dir` only: hook that chat app's adapter into every file, so `emit:` presses (and the interface's state) are saved for the model's next turn. Names: `muse`. An unknown name, or no `--widget-dir`, stops the server with a message. Off by default. See [Adapting a file to a chat app](#adapting-a-file-to-a-chat-app---widget-host). |

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--theme", "blue", "--theme-picker"] }
```

With both experimental features on:

```json
"sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp", "--scene", "--behavior"] }
```

Then ask for something that moves or can be pressed: *"Draw a traffic light I can press, where the active light glows"*, *"Draw a shiny ball bouncing with a shadow on the floor"* or *"A 30-second countdown I can pause"*. Both features may still change between releases.

### Slide decks

`deck` and `slide` are ordinary elements: the quick start in `show_interface`'s description lists them ("a presentation or slide deck, one idea per slide: `deck bind=page`", and "a deck at the top level, not inside a card; a slide per idea"), and `sayshape_docs` gives their props and an example like any other element. Ask for *"A short deck for our Q3 business review"* and the model writes a deck of 16:9 slides that the view shows one at a time, with arrows, dots, Left and Right, and a swipe. The language is described in [the language reference](../docs/language.md#slide-decks).

- **No flag.** Earlier versions needed `--slides`. It is still accepted and does nothing, so existing setups keep starting.
- **`--logo <https url>`** draws a small logo in the bottom left corner of every slide. The address must be https with a plain host; the host is added to `--image-hosts` (and to the view's content security policy), so it loads. It works on its own, without `--slides`.
- **Files.** While a deck is showing, and where the chat app lets views download files (and not with `--no-save-image`), the download button saves a **PDF** and a second button saves a **PowerPoint file**, one page per slide (up to 60). Each page is a picture of the slide as the engine draws it, after anything the person changed, so the file looks exactly like the chat and can't be edited. Nothing is sent to the model.
- **Present.** Where the chat app has a full-screen mode, a Present button shows the deck at the largest size that fits, and puts it back.
- **Text-only clients get a sentence, not a page.** Their page loads an engine pinned at least two weeks behind releases (`PAGE_ENGINE_VERSION`, see [releasing](../docs/releasing.md#the-engine-version-the-text-only-page-loads)), which has no slides yet. So `show_interface` checks the deck as usual and answers with one plain sentence: the deck is written correctly, but this app can't show slide decks yet, and the person needs a chat app that draws SayShape views. A server started with `--widget-dir` is the exception: its file carries this server's own engine, so a deck draws there.

### Images

The view has no website of its own, so an `image` only loads from a host you list with `--image-hosts`, usually your company's image CDN:

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--image-hosts", "cdn.acme.com,images.unsplash.com"] }
```

The one list does three things: the view's engine loads from those hosts and no others, the server asks the chat app to allow them in the view's Content Security Policy (MCP Apps `resourceDomains`), and the model is told which hosts work, so it doesn't invent URLs elsewhere. Images must be https, and the host must send CORS headers (`Access-Control-Allow-Origin`), as image CDNs do, because the view keeps its canvas readable for Save image and Copy text. An image that can't load shows its description instead. Some chat apps may not honour a view's CSP request; then images show their descriptions there.

## In chat apps that can't draw interfaces

Coding agents and other text-only clients (Claude Code, Codex, Antigravity and others) call `show_interface` but can't show MCP Apps views. When a client connects without announcing MCP Apps support (the `io.modelcontextprotocol/ui` capability), and the spec has nothing to fix, `show_interface`'s text result carries a small, complete HTML page instead, with two sentences telling the model what to do with it: publish it as a page if it has a tool for that, or save it as an `.html` file and give the person its path to open in a browser. The server itself writes no files. For these clients the result is text alone, with no structured part: the structured part is for the view, and some clients (Claude Code is one) give their model the structured part in place of the text, which would lose the page. Clients that draw views get exactly what they got before.

The page is a few kilobytes plus the spec: a canvas, the engine loaded from jsDelivr (`sayshape@<version>/dist/sayshape.global.js`, and the map's own script when the spec has a map), and the spec embedded as JSON with `<` escaped, so nothing in it can end the script. It follows light and dark mode, and a `data-theme="light"` or `"dark"` on its root element; its background is the engine theme's own; and it fits a phone with no sideways scrolling.

Brand colors reach the page too. The server works out the final colors for light and dark itself, from the `colors` argument if the model sent it, else `--colors` or `--accent`, and writes the accent, the text on it, the map's highlight and the six chart series into the page as values; the page lays them over the engine's own themes, so the pinned engine needs to know nothing about color lists. When the model's colors were used, the result ends with the same reminder the view's results do, outside the page, to send them again on later calls. Without any colors the page is exactly what it was.

A page outside the chat has no conversation to send `emit:` actions to, so for these clients only:

- **The model is told not to use `emit:`.** Their quick start (in `show_interface`'s description and `sayshape_docs` with nothing named) says to leave it out and ask the person to reply in the chat instead.
- **A spec with `emit:` gets it back to fix**, line by line, with no page until it's gone. Buttons can keep `set:`, `go:` or `notify:`, so they still do something on the page. Everything else in the interface (state, controls, charts, screens) works.
- **Links pressed in `rich=true` text open in a new tab** (https only). In the chat they're sent to the model as `emit:link`; on the page, the page is the host, so it opens them as any web page would.

Clients that draw views see none of this: the same descriptions, the same docs and the same results as before.

What doesn't work there:

- **Save image and Copy text** aren't on the page.
- **It needs internet access** to load the engine from the CDN; without it, or before the pinned version is on the CDN, the page names the engine version that didn't load.
- **Interfaces that load datasets** (`--data`, `--mcp-result`) can't be shown: the page has no way to fetch rows, and the rows never go through the conversation. The model is told so and answers in text.
- It uses SayShape's default look in light and dark; `--theme`, `--theme-picker` and the chat app's own colors and fonts apply only to the view. Brand colors (`--colors`, `--accent` and the `colors` argument) are the one thing from them the page does use.
- The engine version is pinned and moves at releases, so the page can be one release behind the server: an element added in the newest release may not draw there yet. ([Why](https://github.com/premmannava/sayshape/blob/main/docs/releasing.md#the-engine-version-the-text-only-page-loads).)
- For chat apps whose sandbox blocks the CDN but can show a widget from a file, see [`--widget-dir`](#chat-apps-that-show-widgets-from-files).
- In `--http` mode the server makes a new server for every request and never sees what the client announced, so it always answers as for a client that draws views.

The same interface sent again gets no second page, and a spec with problems gets them to fix first, with no page. To see what a client announces, start the server with `SAYSHAPE_LOG_CLIENT=1` in its environment: each connection writes the client's name and capabilities to stderr.

### Chat apps that show widgets from files

Some chat apps show a widget built from a file on your computer, inside a sandbox that loads nothing from outside: no scripts from a CDN, no network requests, no remote images. The page above can't draw there, because it loads the engine from jsDelivr. Muse is the one this was tested in. What its sandbox allows is what such an app needs the file to be: inline scripts, `blob:` scripts and `DecompressionStream` work; the widget has to be an HTML fragment (no `<!doctype>`, `<html>`, `<head>` or `<body>`) under 1 MB, stored whole with the chat and run in its own frame, so nothing is shared between widgets; the app scans a widget's source for browser storage names; and the frame is about 656 px wide with Times as its default font.

Start the server with `--widget-dir <folder>` and, for a client that announces no MCP Apps support, `show_interface` writes the interface into that folder and returns a short text result instead of a page: the file's absolute path, and an instruction to create the widget from that file exactly as it is, without reading or editing it. The engine is inside the file, so it never passes through the model's context. Problems to fix are reported as before, with no file. Clients that draw views, and every client when the flag is off, get what they got before.

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--widget-dir", "/Users/you/sayshape-widgets"] }
```

- **One file, made from this server's own engine.** `npm run build` builds the engine from this repository's `src/` (`scripts/pack-widget-engine.mjs`: the same entry as the page's CDN build, built from this repository's `src/`, so it has the slide elements even while the page's pinned older engine doesn't), gzips it with Node's zlib and ships it in the package as `dist/widget-engine.json`, so the file always matches the server that checked the spec. The fragment holds one wrapping `<div>` (full width, at most 760 px, with its own font), a canvas, the spec (as JSON with `<` escaped, so `</script>` in a spec stays inert), the packed engine and a loader: it decodes and unpacks the engine with `DecompressionStream` and runs it as a `blob:` script, so nothing is fetched and the engine still can't run anything a spec says. A spec that mentions a browser storage name has its first letter escaped, so the words never appear in the file. Where the engine can't be unpacked, a short plain note shows in place of the canvas. A plain interface makes a file of about 260 KB; one with a map about 480 KB (the map's outlines are a second packed script). If a file would reach 1 MB, none is written and the result says why.
- **The name is a hash** of the spec and everything that changes the file (the settings below and the engine), so the same interface reuses one file. The folder keeps the newest 50 (`sayshape-<16 hex digits>.html`); older ones are deleted, and nothing else in the folder is ever touched.
- **The server's settings reach the file.** `--theme`, `--accent` or `--colors`, `--image-hosts` (and `--logo`), `--scene` and `--behavior` all apply (`--slides` is accepted and does nothing: decks need no flag), and unlike the page, behavior and decks work, because the file carries this server's engine and not an older pinned one. (Images from other hosts can't load in a sandbox like Muse's, so an `image` shows its description there.) Fonts: the file draws in the system font where Instrument Sans or Inter isn't installed.
- **Light and dark** follow `data-theme="light|dark"` on the root element and the system's `prefers-color-scheme`, and changes to either.
- **As on the page:** interfaces that load datasets are refused with the same message, `emit:` is refused and removed by the model first (a widget has no chat to send to yet; see `--widget-host` below for the way around that), and links pressed in `rich=true` text open in a new tab (https only).

### Adapting a file to a chat app (`--widget-host`)

The fragment builder (`mcp/src/widget-file.ts`) takes a `host` option: the source of a function the loader calls once after the first draw, as `(source)(ui, sayshape, root)`, which may return `{ emit(action) }` to receive the actions that aren't links. `--widget-host <name>` sets it to one of the adapters in `mcp/src/widget-hosts/`; `muse` is the only one so far. It only works together with `--widget-dir`:

```json
"sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js", "--widget-dir", "/Users/you/sayshape-widgets", "--widget-host", "muse"] }
```

What changes with it, for clients that get a file:

- **The file carries the adapter.** The Muse adapter keeps `emit:` actions in a short list in the widget's state bridge, next to the interface's own state (saved without passwords, and skipped when it is large), and puts that state back when the widget is mounted again. If `--theme`, `--accent` or `--colors` was given, the adapter ignores the chat app's colors and the interface keeps its own; otherwise it follows the app's.
- **`emit:` is allowed.** The quick start no longer says not to use it, and a line with `emit:` is no longer a problem to fix. It says that presses are saved for the model's next turn instead: after the person's next message, the model reads the widget's state, where `actions` lists what they pressed (name, value, time). The result for a spec that uses `emit:` says the same.
- **Nothing else changes.** Without the flag, `emit:` is handled exactly as above; clients that draw MCP Apps views get the same tools, docs and results with or without it.

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

You need Node.js 20 or later (22.13 or later for `--data`). `npx` downloads the server from npm the first time.

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

**Apps that connect to a URL** (custom connectors in Claude on the web, ChatGPT developer mode): run it over HTTP and put it behind HTTPS (a reverse proxy or a tunnel). By default it listens only on 127.0.0.1; to host it for others, see [Host it publicly](#host-it-publicly).

```bash
npx -y sayshape-mcp --http 3001    # http://127.0.0.1:3001/mcp
```

**From source**, to try changes before they're published:

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape/mcp && npm ci && npm run build
# then use "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js"]
```

Then ask for something visual: *"Show the 2022 World Cup final as a stat card"*, or *"Make me a tip calculator for $86 split three ways"*. Charts can carry a target line, a second line and a note at one point: *"Show monthly sales as bars with last year as a line and a target at 16,000"*.

## Host it publicly

To give Claude, ChatGPT and other chat apps a permanent HTTPS address, run the HTTP mode on a host that puts its own HTTPS proxy in front (Render, Fly.io, Railway and the like). There's no sign-in: anyone who has the address can call it, which is fine for `show_interface` and `sayshape_docs`, since they read nothing but the spec they're sent.

Start it with an exact version, never `@latest`, so what runs is what you checked:

```bash
npx -y sayshape-mcp@0.3.0 --http --host 0.0.0.0 --trust-proxy
```

| | |
|---|---|
| `--http [port]` | Serve MCP on `/mcp`. The port is the flag's, else the `PORT` environment variable (container hosts set it), else 3001. |
| `--host <address>` | Where to listen. `127.0.0.1` by default; `0.0.0.0` (or `::`) to take requests from the host's proxy. `HOST` from the environment is used when no flag is given, but only if it's an IP address: some machines set `HOST` to their own name. |
| `--rate-limit <n>` | Calls a minute per client address, in this process (default 300 when listening beyond loopback, off on loopback; 0 turns it off). Each call in a JSON-RPC batch counts. Over the limit, a request gets `429` with `Retry-After`. |
| `--trust-proxy [hops]` | Count calls by `X-Forwarded-For` instead of the connection's address. Behind a proxy every connection comes from the proxy, so without this everyone shares one count. Each proxy appends the address it received the request from, so the server takes the entry written by the `hops`-th proxy from the end (default 1) and ignores anything the client wrote before it. Set it to exactly the number of proxies in front of the server (your host's docs say how many); more lets clients pick their own address, and never use it without a proxy. |
| `--allow-public-data` | See below. |

`GET /` answers `200` with one plain line, for the host's health check; it isn't rate limited. Requests have limits too: headers must arrive within 10 seconds and the whole request within 30, bodies are capped at 1 MB and headers at 16 KB and 100 fields, and at most 1,000 connections are open at once.

**What it logs:** one line at startup (the address, port and rate limit), and a note if it ignores `HOST`. Nothing from a request: no specs, no addresses, no errors with request content. Specs come from people's conversations and can hold personal data. `SAYSHAPE_LOG_CLIENT=1` adds one line per connection with the client app's name, version and capabilities, still nothing from the conversation. Your host's own access logs are separate: they usually record each request's address, path and status, so check its settings and your privacy policy.

**Calls come from the chat apps' servers.** When Claude or ChatGPT calls a connector, the request comes from the company's servers, not from each person's computer, so everyone using it through one app may share a few addresses and one count. Watch for `429`s once people use it, and raise `--rate-limit` if they're legitimate.

**Don't use `--data` here.** A public server with `--data` would let anyone, with no sign-in, read every table in the database (`query_data` runs any `SELECT`), fetch other callers' results by their id (`d1`, `d2`…), and stall the server with one slow query. So with `--http` on an address beyond loopback, `--data` is refused unless you also pass `--allow-public-data`; only do that for data that's public anyway, on an address protected some other way. `--mcp-result` is refused with `--http` altogether.

## Development

Publishing: `npm publish` from this folder runs the tests and the build first (`prepublishOnly`), then uploads `dist/`, this README and the license.

```bash
npm test           # server and helpers, against an in-memory MCP client
npm run typecheck
npm run build
npm run test:e2e   # the built view in Chromium, inside a sandboxed iframe driven by the MCP Apps host bridge
```

`test:e2e` runs the browser canvas/host-action test, the database-to-interface test, the **text-only page test** (`scripts/e2e-fallback.mjs`: a client without MCP Apps gets a page, which is opened from a file in Chromium with the engine built from `../src` standing in for jsDelivr, and must paint in light, dark and `data-theme`, fit 400px and keep a spec containing `</script>` inert), the **widget file test** (`scripts/e2e-widget.mjs`: the file `--widget-dir` writes is opened in Chromium under a Content Security Policy that blocks every external script, connection and image, and must draw in light and dark, fit 400px, change on a press and keep a hostile spec inert), and the **stdio MCP result import test** (`scripts/e2e-import.mjs`). The last one starts the built server with `--mcp-result`, lists the imported schema, calls `show_interface` and verifies the exact rows delivered by app-only `fetch_dataset`. Screenshots from the browser tests go to `e2e-output/`.

The server bundles the engine from `../src`, so the guide, the parser and the view always match the library they were built with. The MCP packages (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`) are dependencies of this package only. The SayShape library itself still has none.
