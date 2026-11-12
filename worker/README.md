# SayShape model proxy

A Cloudflare Worker that answers the website's chat page with SayShape interfaces, **without the API key ever reaching the browser**. GitHub Pages only serves files, so the key can't live there: it lives here, as a Cloudflare secret. It also still answers questions about a spreadsheet without the spreadsheet's rows leaving the browser (the second request shape below); no page uses that one at the moment.

```
chat page (GitHub Pages)                             this worker                          the model provider
   │  question (+ first question, follow-ups since,
   │  latest answer's spec, for a follow-up)
   └──────────────────────────────────────────────▶ checks, limits ── key + guide + messages ──▶ model
   ◀───────────── SayShape lines, streamed ────────────┘
the engine draws the answer as it arrives
```

### Chat messages

`POST /answer` with `{"kind": "chat", "message": "…"}`, or for a follow-up with `"refine": {"task": "the first question", "changes": ["follow-ups since"], "spec": "the latest answer"}`. The worker writes every message the model reads with SayShape's model client: a small chat guide (compact, no worked examples, and a few elements left out; `chatGuide` in `src/chat.ts`), which also teaches drawings (the experimental `scene`) and the world map, so chat answers can use them (`chatRegistry`; spreadsheet answers keep the core elements). A drawing's problems from the drawing check (`checkDrawing`) are warnings: they go to the model only when the parser's errors already cause the one repair, then the request, or for a follow-up the bounded refinement from `src/model/context.ts`. Limits: 400 characters per question and follow-up, 10 earlier follow-ups, a spec of 8,000 characters and 300 lines, 40 KB in all. The spec goes back to the model as its own earlier turn, so it's accepted only when every line is a SayShape line (an element, `state` or `derive`); comments are dropped. Anything else in the body (a model name, messages, a guide) is ignored. What comes back is only ever SayShape lines: the model client drops anything else it writes.

While the model thinks, chat answers stream its thinking as `{"t":"thought"}` events, up to 12,000 characters an answer, which the page shows above the answer. Thinking is free text, not SayShape, so while it's on the key can be used to get prose back that way; set `SHOW_THINKING = "false"` in `wrangler.toml` to stop sending it.

`GET /status` says whether answers are on, and the model's name, without calling the model or counting a question. The chat page asks it when someone starts to type.

A refusal before any answer is JSON with a `reason` the page words itself: `off`, `unconfigured`, `rate`, `daily`, `check`, `too-big` or `bad-request`.

### Spreadsheet questions

The browser sends the question (at most 400 characters), the column names with a type and how many different values each has, three sample rows (cells cut to 100 characters) and a Turnstile token. The worker builds every message itself with SayShape's model client (`src/model`): a guide for data answers, the request with the sample rows fenced as data, and one repair if the parser had to skip lines or the answer doesn't read the data. It always calls the one model set in `wrangler.toml`, so the key can't be borrowed for anything else. An answer must read the spreadsheet by name (`data`) and may not declare it, so the model can't make up or copy rows.

Protections, in `src/handler.ts`, `src/chat.ts` and `src/answer.ts`, tested in `test/worker.test.ts`:

- only origins in `ALLOWED_ORIGINS` may call it;
- an optional [Turnstile](https://developers.cloudflare.com/turnstile/) check on every request;
- a per-IP rate limit (4 a minute, `[[ratelimits]]` in `wrangler.toml`);
- a daily cap for the whole site (`DAILY_ANSWERS`, counted in a KV namespace);
- request limits (40 KB for a chat message with its follow-up context; 16 KB for a spreadsheet question, far too small for a spreadsheet) and a cap on reply length;
- a follow-up's spec is taken back only when it's SayShape and nothing else;
- spreadsheet cells reach the model only as quoted, fenced data;
- provider errors become plain messages; the provider's raw reply is never forwarded;
- `GENERATION_ENABLED = "false"` turns live answers off without touching the site.

## Deploy (one time)

You need a free Cloudflare account and an API key from any OpenAI-compatible provider (`MODEL_URL` defaults to NVIDIA's; set it to your provider's, e.g. DeepSeek's). Run these from this folder:

```bash
npm ci
npx wrangler login                          # opens the browser to sign in to Cloudflare
npx wrangler secret put MODEL_API_KEY       # paste the provider's key when asked; Cloudflare stores it encrypted
npx wrangler kv namespace create ANSWER_COUNT
```

Paste the id that last command prints into the `[[kv_namespaces]]` lines in `wrangler.toml` and uncomment them. Set `MODEL_URL` to the provider's OpenAI-compatible base URL, `MODEL` to the model's id as the provider names it, and `MODEL_LABEL` to the name the page should show. Then:

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
| `SAYSHAPE_MODEL_LABEL` | optional: the model's name, shown before the page has asked the worker |

These are public values, so they're Variables, not Secrets. The chat page reads them at build time, so run the Pages workflow again after setting them. Until `SAYSHAPE_MODEL_ENDPOINT` is set, the chat page says live answers aren't set up.

## The plan it needs

Use Cloudflare's **Workers Paid** plan. The free plan allows 10 ms of processing per request, and an answer takes 200 to 500 ms of it (reading the model's stream piece by piece, then checking the answer). Cloudflare doesn't enforce the free limit every time, so on that plan answers fail at random, cut off mid-stream with no error: `npx wrangler tail` shows `exceededCpu`. The page then says the model didn't answer as expected.

## Change or turn off

- Another model: edit `MODEL` and `MODEL_LABEL` in `wrangler.toml` and `npx wrangler deploy`.
- Another provider: any OpenAI-compatible API works. Change `MODEL_URL`, `MODEL` and the `MODEL_API_KEY` secret.
- More or fewer questions a day: change `DAILY_ANSWERS` and deploy.
- Faster or more careful answers: `REASONING_EFFORT` is how hard the model thinks before it writes (DeepSeek: `none`, `low`, `high`, `max`; `high` when it's empty). Thinking is most of the wait, and `none` leaves no thinking to show.
- Turn live answers off: set `GENERATION_ENABLED = "false"` and deploy.
- Rotate the key: create a new one at the provider, `npx wrangler secret put MODEL_API_KEY`, revoke the old one.
- If answers fail with "didn't answer as expected" for every question, the model may refuse `stream_options`: set `STREAM_USAGE = "false"`.

## Run it locally

```bash
printf 'MODEL_API_KEY=<key>\nMODEL=<model id>\nMODEL_URL=<base url>\nALLOWED_ORIGINS=http://localhost:4173\n' > .dev.vars   # ignored by git
npx wrangler dev                            # http://localhost:8787/answer and /status
```

Build the site against it with `VITE_SAYSHAPE_MODEL_ENDPOINT=http://localhost:8787 npm run site:build`, then `npm run site:preview` and open `/sayshape/chat.html`.
