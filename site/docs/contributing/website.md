---
title: Publishing this site
description: How the SayShape website is built with VitePress and deployed to GitHub Pages, and how to run it locally.
---

# Publishing this site

This website lives in `site/` and is built with [VitePress](https://vitepress.dev). It has its own `package.json` and lockfile, so its dependencies (VitePress, Vue, fonts) never become dependencies of the `sayshape` library. Its demos import the engine straight from `src/`, so they always run the code in the repository.

## Run it locally

```bash
npm ci                    # the library's dependencies (also used to generate pages)
npm ci --prefix site      # the website's dependencies
npm run site:dev          # http://localhost:5173/sayshape/
```

`site:dev` and `site:build` first run `npm run site:docs`, which writes the component reference and model guide pages from the component definitions. Those generated files are ignored by git.

To check the production build the way GitHub Pages will serve it:

```bash
npm run site:build        # site/.vitepress/dist
npm run site:preview      # http://localhost:4173/sayshape/
npm run site:check        # internal links, assets, no localhost or secrets in the output
```

## Deployment

`.github/workflows/pages.yml` builds the site on every pull request (without publishing) and deploys it from `main` with GitHub's official Pages actions. It runs the website tests first, so a broken example or invalid snippet stops the deploy.

One-time repository setting, done by a repository admin:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

After the next push to `main` (or running the workflow by hand from the **Actions** tab), the site is at **https://premmannava.github.io/sayshape/**.

## How it's put together

| Path | What it is |
|---|---|
| `site/index.md`, `site/chat.md`, `site/playground.md`, `site/examples/` | The landing page, chat, playground and gallery, as Vue components in the theme |
| `site/examples/catalog.ts` | The gallery's specs: plain data, tested in `test/site.test.ts` |
| `site/docs/` | The documentation; `docs/components/` is generated |
| `site/.vitepress/theme/sayshape/` | Creating SayShape instances in the browser, highlighting, events |
| `site/.vitepress/markdown.ts` | ` ```sayshape live ` blocks: highlighted source plus a live render |
| `scripts/gen-site-docs.ts` | Generates the component reference and guide pages |
| `scripts/check-site.mjs` | Checks the built site's links, assets and contents |

The engine needs a canvas, fonts and `window`, so every demo creates its instance after the page mounts in the browser and destroys it, with all its listeners, when the page unmounts. Pages are emitted as `.html` files, so every route works when visited directly or refreshed on GitHub Pages, which has no server-side routing.

## The landing page's demo

The landing page's demos are saved specs in `site/examples/home.ts`, all drawn by the real engine: the hero streams its answer the way a model's response arrives, then drags two sliders through the engine's own pointer handling; the four showcases, the mortgage calculator and the look switcher run their specs live. `test/home.test.ts` checks that every spec parses and streams cleanly at phone and desktop widths and that its controls and numbers work. No model runs on the landing page.

## The chat page

`/chat` (`Chat.vue`, one `ChatAnswer.vue` per answer) is the one page where a live model answers. Questions go to the model proxy in `worker/`, which holds the key and writes every message the model reads; its address and the Turnstile site key reach the build as `VITE_SAYSHAPE_MODEL_ENDPOINT` and `VITE_TURNSTILE_SITE_KEY` (see `worker/README.md`). Without the endpoint the page says live answers aren't set up and the question box stays off.

- Answers may draw (the experimental `scene`) and show the world map as well as the core elements: the worker teaches all three and each answer's engine registers them (`scene: true, map: true`), so the two must change together.
- Each answer is its own engine, drawn on the page's paper rather than in a frame, and stays live after it finishes. "New chat" unmounts them all, which destroys their engines. A chat stops at eight answers (`MAX_ANSWERS`).
- A follow-up sends the first question, the follow-ups since and the latest answer's spec (`refineMessages`/`nextRefineContext`); older answers' specs never leave the page.
- The brand color recolors every answer and, once picked, the chat frame (bubbles, the send button, focus outlines). `chatTheme` and `frameColors` keep it readable on the paper and on cards.
- `emit:` actions have nothing listening here: the answer's footer shows what an app would receive.
- The model's thinking streams above the answer while it thinks, then folds into "Thought for 8.2 s" (the worker's `SHOW_THINKING` turns it off). Under a finished answer: Spec, Copy text, Save image (`SayShape.picture()`), and where the time went: waiting for the model, thinking, writing, the engine's own drawing time, and the total.
- The page follows a growing answer only as far as it needs to keep the newest part above the question box, never scrolling the question out of sight, and stops following when the visitor scrolls.
- Nothing is requested while the page loads. The status check (`GET /status`) and Turnstile start when someone focuses the question box or a suggestion.
- The page's logic (what's sent, the stream, refusals, colors) is in `site/.vitepress/theme/sayshape/chat.ts`, tested in `test/chat-page.test.ts`.

The site itself holds no secrets: nothing from `.env.local` is read by the site build, and `site:check` fails if a key-shaped string or a value from `.env.local` ends up in the output.
