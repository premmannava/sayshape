# Connecting a model

## Try it in the playground

The playground's **Ask a model** box sends your request to a real model and streams the screen in as the model writes it. It works with any server that speaks the OpenAI chat format: LM Studio, Ollama, vLLM and llama.cpp on your own machine, or DeepSeek, OpenAI, OpenRouter and others in the cloud.

1. Start a model server. With **LM Studio**: load a model (Qwen3 14B works well), open the Developer tab and start the server. It listens on `http://localhost:1234/v1`, which is the default, so no settings are needed.
2. For anything else, copy `.env.example` to `.env.local` and fill it in. `.env.local` is never committed.
3. Run `npm run dev`, pick the model in the box, describe a screen and press **Ask**.

```bash
# .env.local
SAYSHAPE_MODEL_URL=http://localhost:1234/v1   # LM Studio (default); Ollama: http://localhost:11434/v1
SAYSHAPE_MODEL=                               # optional: the model to preselect
SAYSHAPE_API_KEY=                             # only for servers that need one
SAYSHAPE_USER_SUFFIX=                         # optional: added to every request, e.g. /no_think for Qwen3
```

The dev server passes the playground's requests through to the model server, so the browser needs no CORS settings and never sees the key. While it runs you'll see the model wait, think, write, and fix problems. When it's done, the status line says how long it took, how long until the first line appeared, and whether SayShape's parser found problems that a second request fixed. Tick **Refine this screen** to ask for changes to the current screen instead of a new one. It sends the first request, the changes since and the screen as it is now, including your own edits (see [Changing a screen](#changing-a-screen)).

Reasoning models such as Qwen3 and DeepSeek R1 think before writing. Their thinking is hidden from the screen, but it delays the first line. With Qwen3, `SAYSHAPE_USER_SUFFIX=/no_think` skips it.

**Copy guide**, under the model guide at the bottom of the playground, copies the same instructions the model gets, for trying SayShape in any chat app.

The playground uses the compact guide with equipment-order and numeric-calculator examples, plus short binding reminders. The calculator demonstrates numeric state, automatic control bindings, and derived totals without JavaScript event handlers. This leaves more room for a request and repair on local models loaded with an 8K context window. The library's default remains the full guide. A request can still exceed the model's context with a large spec or refinement; guide token estimates are not exact tokenizer counts.

## Measure it

```bash
npm run eval                        # all 60 requests, with the model from .env.local
npm run eval -- --model qwen3-14b   # another model on the same server
npm run eval -- --only data,hard    # some categories or request ids
npm run eval -- --no-repair         # first tries only
```

`eval/cases.ts` holds 60 requests: forms (a login and a sign-up among them), comparisons, dashboards, shopping, multi-screen flows, content, lists of data (a to-do list, a cart, a kanban board, orders with their lines, a search that filters as you type), requests that describe the data without naming the element (goals against targets, a signup funnel, orders by weekday and hour, one order's details, plans to choose between, regions or dates to filter by), harder multi-part requests, and traps like "a big red button" (SayShape has no colors).

Some requests also have **behavior checks** (`eval/checks.ts`): the final spec is rendered with the real engine and used. Ticking a box must change the "X of Y done" count, changing a quantity must change the total, Remove must remove an item, typing in a search must filter the list. A spec can be valid and still not work, and these catch that.

The report shows how many specs were valid on the first try and after one repair, whether they used the expected elements, how many worked when used, any invented props or elements, input and output tokens, and time to the first line. It's written to `eval/results/<date>-<model>/` with every generated spec, which you can paste into the playground, and everything the model sent for each request (`<id>.raw.txt`), thinking included.

Token counts are the server's own when it reports them, and "unknown" when it doesn't; they're never filled in with zero. Estimates (characters divided by 4) are labelled as estimates. Reasoning tokens a server reports are part of its output tokens and aren't added again. The time to the first SayShape line is when something could be shown, not when the screen is usable.

To compare ways of prompting, give variants. Each request runs once per variant, one after another, with the same model and settings:

```bash
npm run eval -- --guide full,compact                      # the full guide against the compact one
npm run eval -- --guide full,compact --profile shop       # both, describing only the shop profile's elements
npm run eval -- --guide compact --repair-guide same,full  # does repairing with the full guide help?
npm run eval -- --enforce-profile                         # elements outside the profile count as problems
npm run eval -- --stream-usage                            # ask the server for token usage (if it supports it)
npm run guide:size                                        # guide size by section, and what refinement sends
```

The report starts with a side-by-side table on the requests every variant can build. A request that needs an element a profile doesn't have (by its expected elements) isn't sent for that profile; it's listed as not supported. `results.json` records each result's guide mode, profile, repair guide and context policy.

## Check the picks

A spec can be valid, work when used and still show the data the wrong way: a donut for one number out of a total, bars for two series over time, a table for a grid that's clearer as a heatmap. `npm run pick-eval` asks whether a model picks the representation that shows the data best.

```bash
npm run pick-eval                         # the model from .env.local, with the full guide
npm run pick-eval -- --guide compact      # with the compact guide
npm run pick-eval -- --runs 2             # each request twice
npm run pick-eval -- --only share-few,relate  # some requests, by id
npm run pick-eval -- --prompts kit/       # write what a model is given, without the grades
npm run pick-eval -- --answers kit/answers  # score answers made elsewhere
npm run pick-eval -- --answers kit/answers --out picks/  # put the report somewhere else
```

`eval/picks.ts` holds 67 requests that describe data and what someone wants from it, never the element. Round 1 covers each chart kind, structure (trees, flows, boards, schedules), inputs and content: the kinds of data the guide's picks describe, so it measures whether a model follows them. Round 2 is harder: raw numbers, vague requests, and requests that want several things at once, scored part by part, each part by a different element. Each request lists its best answers (2 points), acceptable ones (1), and poor or never-right ones (0); a best answer with a never-right one beside it counts as acceptable. Traps are requests where an obvious pick is wrong, such as a chart for a single number with its change, and there the obvious pick is never-right. A test checks that no pick quotes a request, so the guide never hands a model the answer.

An answer is read element by element: a multiple select is graded as a multiple select when the request lists one, not as a plain select. A request with no answer scores 0, so skipping doesn't help. Every answer is also rendered with the real engine; the report says whether it parsed without errors and drew without text spilling out of its box, and lists warnings separately. `--prompts` writes the quick start, the full guide, each element's docs and the requests to a folder, for running models by hand (it reads the MCP server's texts, so run `npm --prefix mcp install` first). Answers go back in as `answers/<model>-<setup>-r<run>/<id>.sayshape`, with no hyphen in the setup's name, or as `.jsonl` files of `{"id", "spec", "model", "setup", "run"}`. Reports go to `eval/results/picks-<date>/`, or to `--out`.

## Compare it with HTML

`npm run compare` asks each model for the same 30 requests twice, once in SayShape and once as an HTML fragment (markup, CSS and JavaScript, with Chart.js allowed for charts), and judges both the same way: by what's on screen and what happens when it's used.

```bash
npm run compare                                           # the model from .env.local, every request once
npm run compare -- --models openai/gpt-4.1,qwen/qwen3-32b # several models on the same server
npm run compare -- --runs 3                               # each request three times per model and format
npm run compare -- --only dashboard,s1                    # some categories or request ids
npm run compare -- --guide compact                        # SayShape's compact guide
npm run compare -- --cache 1h                             # mark the guide for prompt caching
```

The requests (`eval/compare/tasks.ts`) cover KPIs, charts, tables, forms, calculators, dashboards, maps and two security cases, where data that looks like HTML must stay text. Every figure a check looks for is in the request. SayShape answers are rendered by the real engine and HTML answers run in jsdom; checks type into fields, press things by their visible text and read the visible text, so they mean the same for both. `eval/compare/reference.ts` holds a working answer to every request in both formats, and the tests check that each passes every check.

Every answer is a first try with no repair. The report gives, per model and format: how many answers worked, checks passed, input and output tokens as the server reported them, time to the first token and in total, cost (looked up for OpenRouter models), code size, and for HTML the patterns that cost safety or theming: HTML inserted as strings, code built from strings, external scripts and fixed colors. It's written to `eval/compare/results/<date>/` with every answer.

## In your own app

`sayshape/model` does what the playground does: it streams a spec from an OpenAI-compatible endpoint, removes thinking and code fences, checks the result with SayShape's parser, and asks once for a fix.

```ts
import { generateSpec } from "sayshape/model";

ui.beginStream();
const result = await generateSpec({
  config: { url: "/api/model", model: "qwen3-14b" }, // a route on your server that adds the key
  registry: ui.registry,
  request: "A booking form for a cabin, 2 to 6 guests",
  guide: {
    imageHosts: ["cdn.example.com"],
    actions: [{ name: "book", value: "the number of guests", description: "when the user books" }],
    notes: "A cabin rental site. Prices are per night.",
  },
  onText: (text) => ui.push(text),
  onReset: () => ui.beginStream(), // a fix is coming: start the screen over
});
ui.endStream();
// result.spec, result.diagnostics, result.first, result.repair, result.timings, result.usage, result.messages
```

If your app supplies data with `ui.state.set`, pass its names as `stateNames: ["products"]`, so a spec that reads them isn't flagged as using unknown names and sent back for a needless repair. When a model writes its whole spec inside a thinking block it never closes, `generateSpec` finds the spec there (`result.first.recovered`).

The guide comes from `languageGuide(registry, options)`, generated from the registered components, so it always matches what the engine supports. Its options tell the model which image hosts work, which `emit:` actions your app listens for, and anything about your app it should know.

### A smaller guide: compact mode and profiles

The full guide is the default. Two options make it smaller:

```ts
guide: {
  mode: "compact",   // "full" (default) or "compact"
  profile: "shop",   // which elements the model is told about: "forms", "lists", "shop", "dashboard", or a list of names
}
```

- **Compact mode** describes each element in one line, generated from the same component definitions: its props with their types and allowed values (`!` marks a required prop), what it holds or where it must go, and what it's for. It keeps the rules that change what a spec does (one line per element, indentation, quoting, local actions versus `emit` events, that an item of a list worked out from state writes back to state, roles instead of colors, image hosts), and shows one worked example instead of four plus one per element. The app's own context (image hosts, actions, notes) comes last, so the part that's the same for every app stays a shared prefix.
- **Profiles** choose the elements the model is told about. A profile's elements bring what they need (`tab` brings `tabs`, `list` brings `list-item`), and `column` and `text` are always included. Examples and instructions that would use an element outside the profile are left out. A profile is chosen by your app; SayShape doesn't guess one from the request.

| Guide (with one image host) | Characters | Tokens (estimated) |
|---|---|---|
| full (default) | 23,865 | ~5,970 |
| full, `examples: false` | 19,873 | ~4,970 |
| full, profile `shop` | 17,853 | ~4,460 |
| compact | 8,303 | ~2,080 |
| compact, profile `shop` | 6,570 | ~1,640 |
| compact, profile `forms` | 4,391 | ~1,100 |

Tokens here are characters divided by 4, a rough estimate; `npm run guide:size` prints the current numbers by section. A smaller guide is cheaper and faster to read, but whether a model writes screens as good with it is a question for `npm run eval -- --guide full,compact` on your model. The full guide stays the default until that's been shown.

Three sets of elements are involved, and they're separate:

- **The renderer's**: the registry your SayShape was made with. It can show any of them, whoever wrote the spec.
- **The model's**: the profile. The guide only describes these.
- **What's checked**: by default, a spec is checked against the renderer's elements. With `enforceProfile: true`, it's checked against the profile, so an element outside it is sent back for repair.

Examples are chosen explicitly: `examples` turns each element's own short example on or off (default on in full mode, off in compact), and `workedExamples` picks the larger ones by name (`["todo", "cart"]`, `["equipment"]` for a filterable order calculator, or `false` for none). With a profile, an example that uses an element outside it is never shown.

### Repairs

`generateSpec` asks once for a fix when the parser finds problems (`repairOn: "any" | "errors" | "never"`). With a compact guide, `repairGuide: "full"` sends the full guide for that one repair, still limited to the profile. Each attempt reports the guide it used (`result.first.guide`, `result.repair?.guide`); `npm run eval -- --guide compact --repair-guide same,full` measures whether it helps.

### Changing a screen

To change the current screen ("make the total bigger"), pass a `refine` context instead of the whole conversation:

```ts
import { generateSpec, nextRefineContext, type RefineContext } from "sayshape/model";

let context: RefineContext = { task: "A packing list for a 3-day hike", requirements: ["Prices in euros"], spec: first.spec };

const r = await generateSpec({ config, registry, request: "Add a progress bar", refine: { ...context, spec: ui.spec } });
context = nextRefineContext(context, "Add a progress bar", r.spec);
```

It sends the original task, the `requirements` that must always hold, the changes asked for since, the current spec as it is now (hand edits included), and the new change. It doesn't send earlier specs, failed tries or repair messages, so a change costs about the same on the tenth turn as on the second (`npm run guide:size` shows the difference). Its limits:

- Earlier changes are kept as text, up to `contextPolicy.maxChanges` (default 20). Past that the oldest are left out with a note; the current spec still has their effect. `requirements` are never left out, so anything that must survive belongs there.
- App state is sent only if you pass it, as `refine.state`, and only the values you pass.
- Nothing is summarized by another model call.

`result.messages` is the conversation that produced the accepted spec: the guide, the context, the request and the final spec. A rejected repair isn't in it, and a kept repair replaces the first spec. (Before, it included the repair exchange.) `result.transcript` has everything that was sent and received. Passing `result.messages` as `history` still works for apps that want the whole conversation.

### Usage and timing

`result.usage` adds up the server's token counts over the first try and the repair: `promptTokens`, `completionTokens`, and `reasoningTokens` (part of the completion tokens, not added again). A total is `undefined`, meaning unknown, when any attempt didn't report it; `usage.reported` says how many did. Each attempt also has `inputChars` and `estimatedInputTokens` (characters / 4), `estimatedThinkingTokens`, the guide it used and how long it took. A reasoning model's thinking is often most of the wait: `config.reasoningEffort` sends `reasoning_effort` in the server's own words (DeepSeek: `none`, `low`, `high`, `max`, and `high` when it's left out). Many servers only report usage while streaming when asked; set `config.streamUsage: true` for those that support `stream_options` (OpenAI, vLLM, recent LM Studio and llama.cpp).

### Prompt caching

The guide is the same on every request and comes first, so a provider's prompt cache can serve it: after the first request, those tokens cost a fraction of the input price. With the full guide at about 10,500 tokens of input per request, this is most of the cost of a request.

```ts
const result = await generateSpec({
  config: { url: "https://openrouter.ai/api/v1", model, apiKey, cache: true }, // or cache: "1h"
  registry, request,
});
result.usage.cachedTokens;      // input tokens read from the cache (part of promptTokens)
result.usage.cacheWriteTokens;  // input tokens written to it, usually on the first request
```

- **Anthropic models** (directly or through OpenRouter) cache only what's marked: `cache: true` sends the guide as a text block with `cache_control`, kept about 5 minutes; `cache: "1h"` keeps it an hour. A cache read costs about a tenth of the input price; writing it costs more than a normal read (more for an hour).
- **OpenAI** caches prompts over 1,024 tokens on its own, best effort, and Gemini 2.5 and later do too. Through OpenRouter, `cache: true` still helped: with the guide as its own marked block, GPT-6 Luna read it from the cache for every new user, while one plain system text was reused only when it repeated exactly. GPT-4.1's caching varied from run to run either way.
- The cache only pays when requests keep coming before it expires. Don't add anything that changes per request (a date, a user's name) before or inside the guide: put it in the request.
- `cachedTokens` and `cacheWriteTokens` are read from whichever fields the server uses (`prompt_tokens_details`, or Anthropic's `cache_read_input_tokens` and `cache_creation_input_tokens`), and stay `undefined` when it reports neither.

`npm run eval` and `npm run compare` turn it on with `SAYSHAPE_PROMPT_CACHE=1` (or `1h`) in `.env.local`; `npm run compare -- --cache 1h` overrides that for one run, and the report shows how much input came from the cache and prices cache reads and writes at the model's own rates.

Putting the guide first and the request last means requests with the same guide options share a prefix, which servers with prefix caching (vLLM, llama.cpp, many hosted APIs) can reuse. That's the server's doing: SayShape builds the same text each time, but doesn't cache anything itself.

### Your own model calls

When your app calls its model itself (its own chatbot, its own SDK), `cachedPrompt` builds the system prompt in a cache-friendly order and in each provider's shape: the guide (compact by default) and your lasting instructions first, never changing, then whatever changes per user or request.

```ts
import { cachedPrompt } from "sayshape/model";

const prompt = cachedPrompt(registry, {
  instructions: "You help Acme's managers see their sales numbers.", // the same for everyone: cached
  context: `The user is ${user.name}. Today is ${today}.`,             // changes per request: sent after it
});

// Anthropic's Messages API: the stable part is marked for caching.
await anthropic.messages.create({ model, system: prompt.anthropic(), messages, max_tokens: 4000 });

// OpenRouter or another OpenAI-compatible server that takes text blocks, for any model.
await fetch(`${url}/chat/completions`, { method: "POST", body: JSON.stringify({ model, messages: [...prompt.marked(), ...messages] }) });

// A server that only takes plain text.
const plain = [...prompt.messages(), ...messages];

prompt.cacheKey; // a fingerprint of the cached part: if it changes between requests, so does the prompt
```

`prompt.stable` is the cached part, `prompt.variable` the per-request part and `prompt.text` both. Measured through OpenRouter with a different user on each request, the marked forms let Claude Haiku 5.5 read the whole guide from the cache on the second request (5,541 of 5,574 input tokens) and GPT-6 Luna on every request after its first; a single plain system text was reused only when it repeated exactly. Give lasting instructions as `instructions` (or `guide.notes`, not both), and keep anything personal or dated in `context`, so the cached part stays the same for every user.

Send the user's choices back to the model with `emit` actions, passing `result.messages` as `history` to continue the conversation:

```ts
ui.on("action", ({ name, value }) => {
  continueConversation(`The user chose ${name}: ${value}`);
});
```

> **Keep API keys on a server.** Point `config.url` at a route on your backend that adds the key, as the playground's dev server does. Never put a model API key in front-end code.
