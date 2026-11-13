---
title: Privacy
description: What SayShape's public server and website receive, and what they keep.
---

# Privacy

SayShape's public server and website keep nothing you send them. There are no accounts, no cookies and no analytics.

Last updated: November 12, 2026.

## The public MCP server

This is the server at `https://mcp.sayshape.workers.dev/mcp` that Claude, ChatGPT and other chat apps connect to.

**What it receives.** When your chat app's model shows an interface, it sends the server a spec: the lines of SayShape that describe the interface. A spec can hold content from your conversation, such as the numbers in a chart. The server also receives the names of the elements a model asks for documentation on.

**What it does with it.** It checks the spec, replies to the chat app, and forgets it. Each request is handled on its own; nothing is written to a database, a file or a log. The server doesn't log specs, addresses or errors that contain request content.

**Rate limit.** To stop abuse, the server counts requests per IP address for one minute, in memory. The counts aren't stored.

**Where the interface is drawn.** In your chat app, on your device. What you type or press in an interface stays there. If an interface has a button that sends your choice back, it goes to your chat app's model as part of your conversation, not to SayShape.

**Images.** An interface can load images only from hosts the server's operator has allowed. The public server allows no outside hosts.

**Who runs the machines.** The server runs on Cloudflare and Google Cloud. Like any host, they keep their own technical records of requests, such as the time, the IP address, the path and the status. Those records don't include the content of a request, and SayShape doesn't use them to identify anyone.

## This website

The website is static files on GitHub Pages. SayShape sets no cookies, stores nothing in your browser and runs no analytics. GitHub keeps its own records of visits, as any host does.

**Playground, examples and compare.** These run in your browser. What you type in the playground isn't sent anywhere.

**The chat page.** This is the one page that sends what you type to a model. Your question, your follow-ups and the current interface's spec go to SayShape's model proxy, which passes them to the model provider (currently DeepSeek) to write the answer. The proxy:

- stores no questions and no answers;
- keeps one number: how many answers the whole site has given today;
- counts requests per IP address for one minute, to limit abuse;
- may run a Cloudflare Turnstile check to tell people from bots.

The model provider handles what it receives under its own terms. Don't type personal or confidential information into the chat page.

## The npm packages

`sayshape` and `sayshape-mcp` run on your own computer or servers and send nothing to SayShape. If you host the MCP server yourself, what's kept depends on you and your host.

One case loads a file from elsewhere: for chat apps that can't draw interfaces, the MCP server gives the agent a small HTML page, and that page loads the SayShape engine from the jsDelivr CDN when you open it.

## Changes and questions

If this changes, this page changes with it. For questions, open an issue on [GitHub](https://github.com/premmannava/sayshape/issues).
