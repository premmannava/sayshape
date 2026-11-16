# Prompt caching

The guide is about the same size on every request (with every element, the compact guide is roughly 5,500 tokens and the full one about 18,000; `npm run guide:size` measures yours) and comes first, so a provider's prompt cache can serve it: after the first request those tokens cost a fraction of the input price. SayShape never caches anything itself. It builds the prompt in a cache-friendly order and in each provider's shape; the provider does the caching. The background is in [Model](model.md#prompt-caching).

## What to send first

A cache matches the start of a request, so what is the same on every request goes first and never changes:

1. **Stable part:** the guide, then your app's lasting instructions (its domain, tone, rules), identical for every user.
2. **Variable part:** whatever changes per user or request (who is asking, today's date, a summary of their data), after it.

`cachedPrompt` builds both and gives each provider's shape:

```ts
import { cachedPrompt } from "sayshape/model";

const prompt = cachedPrompt(registry, {
  instructions: "You help Acme's managers see their sales numbers.", // same for everyone
  context: `The user is ${user.name}. Today is ${today}.`,           // per request, sent after
});
```

| You call | Use | What it gives |
|---|---|---|
| Anthropic's Messages API | `system: prompt.anthropic()` | Text blocks, the stable one marked with `cache_control` |
| OpenRouter, or another OpenAI-compatible server that takes text blocks | `messages: [...prompt.marked(), ...messages]` | One system message whose stable part is its own marked block |
| A server that only takes text | `[...prompt.messages(), ...messages]` | One plain system message, stable part first |

If you use `generateSpec`, `config.cache` does the marking for you: `cache: true` marks the guide (the system message) as one text block with `cache_control`.

## Anthropic, OpenAI and OpenRouter

- **Anthropic models** (directly or through OpenRouter) cache only what is marked. A cache read costs about a tenth of the input price; writing costs more than a normal read.
- **OpenAI** caches prompts over 1,024 tokens on its own, best effort, and Gemini 2.5 and later do too. Through OpenRouter, the marked form (stable part as its own block) was what let GPT-6 Luna read the guide from the cache for every new user; one plain system text was reused only when the whole text repeated. GPT-4.1's caching varied from run to run either way.
- **Servers with prefix caching** (vLLM, llama.cpp, many hosted APIs) can reuse the shared start of the prompt. That is the server's doing, and plain text is enough.
- **Marking is off by default** in `generateSpec`: some servers refuse a system message that is a list of text blocks. Turn it on only for a provider you know takes it, and check it works (below).

## The TTL choice

`cachedPrompt(...).anthropic(ttl)` and `.marked(ttl)` take `"5m"` (the default, kept about 5 minutes) or `"1h"`; `config.cache` takes `true` or `"1h"`. A cache write costs more for an hour than for 5 minutes. The cache only pays when requests keep coming before it expires, so pick `"1h"` when requests are sparse enough that the 5-minute entry would often expire, and the default when they are frequent.

## Check that it works

Look at the usage the server reports. With `generateSpec`:

```ts
result.usage.cachedTokens;      // input tokens read from the cache (part of promptTokens)
result.usage.cacheWriteTokens;  // input tokens written to it, usually on the first request
```

On the first request you should see a write (or nothing, for providers that cache on their own), and on the next ones, with a different user or question, `cachedTokens` close to the size of the guide. Both stay `undefined` when the server reports neither, which means unknown, not zero. They are read from `prompt_tokens_details` or from Anthropic's `cache_read_input_tokens` and `cache_creation_input_tokens`.

`prompt.cacheKey` is a fingerprint of the stable part. Log it: if it differs between requests, something in the stable part changes and every request pays full price. OpenAI also takes a key like it as `prompt_cache_key`, which keeps requests with the same start on the same cache.

## Common mistakes

- **Putting something per request in the stable part:** a date, a user's name or id, a random value, a data summary. Put it in `context` (or in the request).
- **Giving instructions that change:** the guide's `notes` and `instructions` are part of the stable part. Edit them and the key changes. (Give one or the other, not both; `cachedPrompt` throws.)
- **Changing the guide options per request:** a different `mode`, `profile` or `imageHosts` is a different guide, so a different cache entry.
- **Sending one plain system text:** with providers that need a marker, or that reused it only when the whole text repeated, nothing is reused once the variable part changes.
- **Marking text that is not first:** the cache serves the start of the request, so earlier changing content defeats it.
- **Letting requests expire:** a 5-minute entry that gets no request for 5 minutes is written again.

## The website's chat page

The website's model proxy (`worker/`) sends the chat guide and the data guide as one stable system message, built with `cachedPrompt`, with everything per visitor in the messages after it. Set `PROMPT_CACHE` to `true`, `5m` or `1h` to send it as a marked block; it is off by default. See `worker/README.md`.
