# SayShape model proxy

A Cloudflare Worker that answers questions about a spreadsheet with a SayShape interface, **without exposing the API key and without the spreadsheet leaving the visitor's browser**. The website doesn't use it at the moment: its landing page replays saved answers. It's kept for a page that answers live, with a fast enough model. GitHub Pages only serves files, so the key can't live there: it lives here, as a Cloudflare secret.

```
landing page (GitHub Pages)                          this worker                          NVIDIA
the file is read in the browser;
its rows stay there
   │  question + column names + 3 sample rows (≈1 KB)
   └──────────────────────────────────────────────▶ checks, limits ── key + guide + request ──▶ model
   ◀───────────── SayShape lines, streamed ────────────┘
the engine draws the answer with every row
```

The browser sends the question (at most 400 characters), the column names with a type and how many different values each has, three sample rows (cells cut to 100 characters) and a Turnstile token. The worker builds every message itself with SayShape's model client (`src/model`): a guide for data answers, the request with the sample rows fenced as data, and one repair if the parser had to skip lines or the answer doesn't read the data. It always calls the one model set in `wrangler.toml`, so the key can't be borrowed for anything else. An answer must read the spreadsheet by name (`data`) and may not declare it, so the model can't make up or copy rows.

Protections, in `src/handler.ts` and `src/answer.ts`, tested in `test/worker.test.ts`:

- only origins in `ALLOWED_ORIGINS` may call it;
- an optional [Turnstile](https://developers.cloudflare.com/turnstile/) check on every request;
- a per-IP rate limit (4 a minute, `[[ratelimits]]` in `wrangler.toml`);
- a daily cap for the whole site (`DAILY_ANSWERS`, counted in a KV namespace);
- a 16 KB request limit, far too small for a spreadsheet, and a cap on reply length;
- spreadsheet cells reach the model only as quoted, fenced data;
- provider errors become plain messages; the provider's raw reply is never forwarded;
- `GENERATION_ENABLED = "false"` turns live answers off without touching the site.

## Deploy (one time)

You need a free Cloudflare account and an NVIDIA API key from [build.nvidia.com](https://build.nvidia.com). Run these from this folder:

```bash
npm ci
npx wrangler login                          # opens the browser to sign in to Cloudflare
npx wrangler secret put MODEL_API_KEY       # paste the NVIDIA key when asked; Cloudflare stores it encrypted
npx wrangler kv namespace create ANSWER_COUNT
```

Paste the id that last command prints into the `[[kv_namespaces]]` lines in `wrangler.toml` and uncomment them. Set `MODEL` to the model's id as NVIDIA's API example shows it, and `MODEL_LABEL` to the name the page should show. Then:

```bash
npx wrangler deploy                         # prints the worker's URL, e.g. https://sayshape-model.<you>.workers.dev
```

Recommended, against bots:

1. In the Cloudflare dashboard, **Turnstile → Add widget**. Hostname: `premmannava.github.io`. Mode: Managed.
2. `npx wrangler secret put TURNSTILE_SECRET` with the widget's **secret key**.

Then tell the website where the worker is. In GitHub: **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
|---|---|
| `SAYSHAPE_MODEL_ENDPOINT` | `https://sayshape-model.<you>.workers.dev` |
| `TURNSTILE_SITE_KEY` | the widget's **site key** (public), if you made one |

These are public values, so they're Variables, not Secrets. A page that asks this worker reads them at build time; the current landing page doesn't, so they change nothing until one does.

## Change or turn off

- Another model: edit `MODEL` and `MODEL_LABEL` in `wrangler.toml` and `npx wrangler deploy`.
- Another provider: any OpenAI-compatible API works. Change `MODEL_URL`, `MODEL` and the `MODEL_API_KEY` secret.
- More or fewer questions a day: change `DAILY_ANSWERS` and deploy.
- Turn live answers off: set `GENERATION_ENABLED = "false"` and deploy.
- Rotate the key: create a new one at NVIDIA, `npx wrangler secret put MODEL_API_KEY`, revoke the old one.
- If answers fail with "didn't answer as expected" for every question, the model may refuse `stream_options`: set `STREAM_USAGE = "false"`.

## Run it locally

```bash
printf 'MODEL_API_KEY=nvapi-...\nMODEL=<model id>\nALLOWED_ORIGINS=http://localhost:4173\n' > .dev.vars   # ignored by git
npx wrangler dev                            # http://localhost:8787/answer
```

Build the site against it with `VITE_SAYSHAPE_MODEL_ENDPOINT=http://localhost:8787 npm run site:build`, then `npm run site:preview`.
