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

## In chat apps that can't draw interfaces

Coding agents such as Claude Code, Codex and Antigravity call the server's tools but can't show MCP Apps views. For them, `show_interface` returns a small HTML page that draws the interface with the engine from a CDN, and tells the model to publish it as a page or save it as a file for you to open in a browser. Nothing on the page can send something back to the chat, so the model is told not to use `emit:` there (links in the text open in a new tab instead); Save image and Copy text aren't on it, it needs internet access, and interfaces that load database rows can't be shown. The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#in-chat-apps-that-cant-draw-interfaces) has the details.

## Install

The server is on npm as [`sayshape-mcp`](https://www.npmjs.com/package/sayshape-mcp). You need Node.js 20 or later; `npx` downloads it the first time. Add it to your chat app's MCP settings. In Claude Desktop that's Settings → Developer → Edit Config:

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

For apps that connect to a URL (Claude on the web, ChatGPT), run it over HTTP, put it behind HTTPS and add its `/mcp` address:

```bash
npx -y sayshape-mcp --http 3001
```

Then restart the app.

### Options

Add them after `"sayshape-mcp"` in `args`:

| Option | What it does |
|---|---|
| `--theme studio` | The look interfaces use: `teal` (default), `purple`, `blue`, `neutral` or `studio` |
| `--theme-picker` | A theme selector in the interface's toolbar |
| `--scene` | Experimental scenes, off unless you ask for them |
| `--data db.sqlite` | Answers from a SQLite database (needs Node.js 22.13 or later) |

### If it doesn't start

- **Check Node:** run `node -v` in a terminal. It needs 20 or later, and 22.13 or later for `--data`.
- **`npx` not found (common with nvm):** chat apps don't read your shell's settings. Use the full path from `which npx` as `"command"`.
- **Still nothing:** run `npx -y sayshape-mcp --help` in a terminal. It should print the options. Apps also keep MCP logs (Claude Desktop: Settings → Developer).

The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#readme) has every option and how to run it from source.

## Compared with the website

The website replays saved answers; no model runs there. The MCP server uses the model you already chat with, so its results depend on that model.
