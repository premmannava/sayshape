/**
 * A system prompt for apps that call their model themselves (their own chatbot, their own SDK),
 * laid out so the provider's prompt cache can serve most of it.
 *
 * A prompt cache matches the start of a request, so the part that's the same on every request has
 * to come first and never change:
 *
 *   stable:    the SayShape guide (compact by default), then the app's lasting instructions
 *   variable:  what changes per user or request (who's asking, today's date, a data summary)
 *
 * Providers differ in how they're told: Anthropic caches only up to a cache_control marker;
 * OpenAI and Gemini cache on their own, best effort. Through OpenRouter, the marked form (stable
 * part as its own marked block) was what let a model reuse the guide across different users:
 * measured on Claude Haiku 5.5 and GPT-6 Luna, where one plain system text was reused only when
 * the whole text repeated. The methods give each shape. SayShape caches and sends nothing itself.
 */
import { languageGuide, type GuideOptions } from "../prompt";
import type { Registry } from "../registry";
import type { ChatMessage } from "./stream";

export interface CachedPromptOptions {
  /** How the guide is built. Default: compact mode, which matched the full guide's quality at a fraction of the input. */
  guide?: GuideOptions;
  /**
   * The app's lasting instructions, the same for every user: its domain, tone, rules. Kept in the
   * cached part, after the guide (as guide.notes; give one or the other).
   */
  instructions?: string;
  /**
   * What changes per user or request: who's asking, today's date, a summary of their data. Sent
   * after the cached part, so it never breaks the cache. Leave out when there's none.
   */
  context?: string;
}

/** How long Anthropic keeps a marked prefix: about 5 minutes (the default), or an hour (a cache write costs more). */
export type CacheTtl = "5m" | "1h";

/** A text block of Anthropic's Messages API, or of an OpenAI-compatible message whose server passes cache markers on. */
export interface TextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

export interface CachedPrompt {
  /** Identical on every request with the same options: the guide, then the instructions. This is what gets cached. */
  stable: string;
  /** The per-request context, or "" when there's none. */
  variable: string;
  /** The whole system prompt as one text: stable, then variable. */
  text: string;
  /**
   * A short fingerprint of the stable part. If it changes between requests, something in the
   * stable part does too and every request pays full price. OpenAI also takes it as
   * prompt_cache_key, which keeps requests with the same prefix on the same cache.
   */
  cacheKey: string;
  /**
   * One plain system message, stable part first: for servers that only take text, such as a
   * local server with prefix caching. A provider may then reuse it only when the whole text
   * repeats (as GPT-6 Luna did through OpenRouter), so prefer marked() or anthropic() where they work.
   */
  messages(): ChatMessage[];
  /** For Anthropic's Messages API: its system field, with the stable part marked for caching. */
  anthropic(ttl?: CacheTtl): TextBlock[];
  /**
   * For OpenAI-compatible servers that take text blocks, such as OpenRouter, for any model: one
   * system message whose stable part is its own text block, marked for caching. Models that cache
   * on their own ignore the marker but still reuse the separate block.
   */
  marked(ttl?: CacheTtl): Array<{ role: "system"; content: TextBlock[] }>;
}

/** FNV-1a over the text, twice with different seeds: a stable 16-character key, no dependencies. */
function fingerprint(text: string): string {
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return hash(0x811c9dc5) + hash(0x9747b28c);
}

const marker = (ttl: CacheTtl): NonNullable<TextBlock["cache_control"]> => (ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" });

/** Build the system prompt for an app's own model calls, split into the cached and the per-request part. */
export function cachedPrompt(registry: Registry, opts: CachedPromptOptions = {}): CachedPrompt {
  const guide: GuideOptions = { mode: "compact", ...opts.guide };
  if (opts.instructions !== undefined && guide.notes !== undefined) {
    throw new Error("cachedPrompt: give the app's instructions as instructions or as guide.notes, not both");
  }
  const stable = languageGuide(registry, opts.instructions !== undefined ? { ...guide, notes: opts.instructions } : guide);
  const variable = (opts.context ?? "").trim();
  const text = variable ? `${stable}\n\n${variable}` : stable;
  return {
    stable,
    variable,
    text,
    cacheKey: fingerprint(stable),
    messages: () => [{ role: "system", content: text }],
    anthropic: (ttl = "5m") => [{ type: "text", text: stable, cache_control: marker(ttl) }, ...(variable ? [{ type: "text" as const, text: variable }] : [])],
    marked: (ttl = "5m") => [{ role: "system", content: [{ type: "text", text: stable, cache_control: marker(ttl) }, ...(variable ? [{ type: "text" as const, text: variable }] : [])] }],
  };
}
