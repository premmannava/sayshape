---
title: In Claude, ChatGPT and other chat apps
description: The SayShape MCP server shows SayShape interfaces inside chat apps that support MCP Apps.
---

# In Claude, ChatGPT and other chat apps

The SayShape MCP server lets a chat app's own model show SayShape interfaces **inside the conversation**. It's an [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server, so it works in chat apps that support MCP Apps, such as Claude, ChatGPT, VS Code and Goose. Support differs between apps and versions.

You don't need your own model or API key: the chat app's model writes the spec, and SayShape's engine draws it in the chat.

## How it works

1. The model reads a short quick start in `show_interface`'s description: the syntax and every element's name. For an element it hasn't used yet, it asks `sayshape_docs` for just that element's props and example. Everything it reads is generated from the same component definitions the engine renders with, and it never has to read the whole guide.
2. It calls `show_interface` with a spec. The server checks the spec with SayShape's parser and tells the model which lines it skipped, with line numbers, so it can fix them.
3. The chat app shows the server's view: the SayShape engine in one self-contained HTML file. In apps that stream tool input, the interface builds line by line while the model writes.
4. When someone presses a button with `on=emit:name`, the view sends a message into the conversation with the action, its value and the interface's current values, and the model can respond.

Nothing else leaves an interface. A spec can't run code, open links or make requests, and the chat app's sandbox around the view is a second layer, not the first.

## Data from a database

Start the server with `--data path/to/database.db` (SQLite, opened read-only) and the model gets three more tools. It looks at the tables (`describe_data`), runs one read-only `SELECT` (`query_data`), and shows the result by passing the dataset to `show_interface`. The model sees only the result's columns and a few sample rows. The interface fetches the rows itself, so the numbers on screen come straight from the database and never pass through the model. The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#readme) has the details.

## Brand colors {#brand-colors}

Interfaces can be drawn in your brand's colors. Specs still never contain colors: they come from the server's options, from the chat app, or from a tool argument when the person names colors in the conversation, never from a line of a spec.

Several sources can apply. The first one that gives colors wins:

1. **The `colors` argument of `show_interface`.** A model sends a list of hex colors, most important first, only when the person (or the instructions it was given) named colors to use: *"make it in our brand colors, #e4572e and #2e86ab"*. They are drawn over everything below. Entries that aren't hex colors are ignored, and so is anything past six. Nothing stores them but the conversation, so every result drawn in them ends with a short reminder for the model to send the same colors on its later calls; asking to go back to the normal look stops it. `--no-model-colors` removes the argument.
2. **The server's `--accent` or `--colors`.** The colors of the company that installed the server, for every conversation (the options table below).
3. **The chat app's own brand color,** when neither of the above is set, `--theme` is left at its default and the person hasn't picked a theme in the selector: Claude, ChatGPT, VS Code, Gemini and Grok get their own accent, with chart colors worked out from it.
4. Otherwise, the theme's own colors.

What a list does is the same wherever it comes from: the first color is the accent and the first chart series, the others are the next chart series, any series the list doesn't cover are worked out from the first, a color too like an earlier one becomes a lighter or darker shade of itself, and every color is adjusted separately for light and dark so it stays readable. Only the accent and the chart series change; the chat app still decides the background, text and status colors. [Themes](./themes#brand-colors) has the details and an example. The server prints what each mode uses at startup, and stops with a message if `--colors` has a bad entry, an empty one or more than six.

Chat apps that can't draw interfaces get their page in the same brand colors ([below](#coding-agents)), from the `colors` argument if the model sent it, else `--colors` or `--accent`; their own brand color doesn't apply to a page outside the chat. A `--widget-dir` file uses the server's colors but doesn't read the argument yet.

## In chat apps that can't draw interfaces {#coding-agents}

Coding agents such as Claude Code, Codex and Antigravity call the server's tools but can't show MCP Apps views. For them, `show_interface` returns a small HTML page that draws the interface with the engine from a CDN, and tells the model to publish it as a page or save it as a file for you to open in a browser. Nothing on the page can send something back to the chat, so the model is told not to use `emit:` there (links in the text open in a new tab instead); Save image and Copy text aren't on it, it needs internet access, and interfaces that load database rows can't be shown. It does draw in your [brand colors](#brand-colors), and the result keeps reminding the model to send them. The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#in-chat-apps-that-cant-draw-interfaces) has the details.

## Install

The server is on npm as [`sayshape-mcp`](https://www.npmjs.com/package/sayshape-mcp). You need Node.js 20 or later; `npx` downloads it the first time. Which setup you need depends on your app:

| Your app | Where the server runs | What you see |
|---|---|---|
| Claude Desktop, VS Code, Goose and other MCP Apps clients | On your computer | The interface, inside the chat |
| Claude on the web and phone, ChatGPT | At SayShape's public address, or one you host | The interface, inside the chat |
| Claude Code, Codex, Antigravity | On your computer | A page the agent publishes or saves for you to open in a browser |

Support differs between apps, versions and plans.

### On your computer, inside the chat

Add it to your chat app's MCP settings. In Claude Desktop that's Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

In VS Code, put it in `.vscode/mcp.json`:

```json
{
  "servers": {
    "sayshape": { "type": "stdio", "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

Then restart the app.

### Coding agents: Claude Code, Codex, Antigravity {#coding-agent-setup}

They add MCP servers in their own ways. The answer arrives as a page, not inside the chat ([what that means](#coding-agents)).

**Claude Code**, in a terminal:

```bash
claude mcp add sayshape -- npx -y sayshape-mcp
```

**Codex**, in a terminal. It adds the server to `~/.codex/config.toml`:

```bash
codex mcp add sayshape -- npx -y sayshape-mcp
```

**Antigravity:** in the agent panel's **…** menu, choose **MCP Servers**, then **Manage MCP Servers**, then **View raw config**, and add this to `mcp_config.json`:

```json
{
  "mcpServers": {
    "sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

### Claude on the web and phone, and ChatGPT {#hosted}

These apps connect to a server's address; they can't run a program on your computer. SayShape runs a public server you can add as it is:

```text
https://mcp.sayshape.workers.dev/mcp
```

Add it:

- **Claude:** as a custom connector. On Pro and Max, that's Customize → Connectors → Add, then Add custom connector; on Team and Enterprise, an owner adds it for the organization. Free plans can add one custom connector. Claude connects from Anthropic's servers, so the address must be reachable from the internet.
- **ChatGPT:** turn on developer mode (Settings → Apps → Advanced settings), then create an app with the address (Apps → Create). Developer mode is a beta on the web, for Pro, Business, Enterprise and Edu plans; on Business, Enterprise and Edu an admin may need to allow it.

The public server reads only the specs it's sent and keeps nothing between requests ([privacy](/privacy)). It has a rate limit per caller. The address is meant to stay the same; the version behind it moves to each new release, and may change what interfaces look like while SayShape is a prototype.

#### Host your own {#host-your-own}

To run it yourself, start it on a host that puts its own HTTPS proxy in front, such as Google Cloud Run or Render, with an exact version:

```bash
npx -y sayshape-mcp@0.2.2 --http --host 0.0.0.0 --trust-proxy
```

On Cloud Run, [`deploy/cloud-run/Dockerfile`](https://github.com/premmannava/sayshape/tree/main/deploy/cloud-run/Dockerfile) does this. Your address is then your host's address plus `/mcp`, such as `https://your-domain.example/mcp`; add it the same way. The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#host-it-publicly) explains each flag, the rate limit, the health check at `/`, and what the server logs. Don't add `--data` there: on a public address it would let anyone read the whole database, so the server refuses it.

### Options

Add them after `"sayshape-mcp"` in `args`:

| Option | What it does |
|---|---|
| `--theme studio` | The look interfaces use: `teal` (default), `purple`, `blue`, `neutral` or `studio` |
| `--accent "#e4572e"` | Your brand color for buttons, highlights and charts, made readable in light and dark. The other chart colors are worked out from it |
| `--colors "#e4572e,#2e86ab,#f2c14e"` | Up to six brand colors, most important first, as one quoted argument. The first is the accent and the first chart color, the rest are the next chart colors, and any the list does not cover are worked out from the first. Use this or `--accent`, not both |
| `--no-model-colors` | Keep the colors to the ones above. Without it, when you ask in the conversation for an interface in certain colors, the model passes them along with the interface, and is reminded to keep sending them for the rest of the conversation |
| `--theme-picker` | A theme selector in the interface's toolbar |
| `--scene` | Experimental scenes, off unless you ask for them |
| `--logo https://cdn.example.com/logo.png` | A small logo in the corner of every slide of a deck. Its host is allowed to load images, like `--image-hosts` |
| `--data db.sqlite` | Answers from a SQLite database (needs Node.js 22.13 or later) |

### If it doesn't start

- **Check Node:** run `node -v` in a terminal. It needs 20 or later, and 22.13 or later for `--data`.
- **`npx` not found (common with nvm):** chat apps don't read your shell's settings. Use the full path from `which npx` as `"command"`.
- **Still nothing:** run `npx -y sayshape-mcp --help` in a terminal. It should print the options. Apps also keep MCP logs (Claude Desktop: Settings → Developer).

The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#readme) has every option and how to run it from source.

## Slide decks {#slide-decks}

Ask for a presentation and the model writes a [`deck`](../language/slides) of slides, shown one at a time in the conversation with arrows, dots and the keyboard. There is no flag to turn on: the quick start tells every model about decks. (`--slides`, which an earlier version needed, is still accepted and does nothing, so existing setups keep starting.) Start the server with `--logo` to put your logo in the corner of every slide.

Where the chat app can download files, the toolbar saves a deck as a **PDF** or a **PowerPoint file**, with a page per slide. Each page is a picture of the slide as the engine draws it, so the file looks exactly like the chat, and nothing in it can be edited. In chat apps that can show full screen, **Present** fills the screen with the deck.

Coding agents and other text-only clients get no page for a deck. The page they would be given loads an engine from a CDN that is kept a couple of weeks behind the newest release, so it cannot draw slides yet. Instead the model gets the usual check of its spec and a plain sentence saying the deck is written correctly but this app can't show it, so it can tell the person to use a chat app that draws SayShape views. (A server started with `--widget-dir` carries its own engine in the file it writes, so decks work there.) The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#slide-decks) has the details.

## Compared with the website

The website replays saved answers; no model runs there. The MCP server uses the model you already chat with, so its results depend on that model.
