/** Model prices for cost figures in npm run compare and npm run sessions. */
import type { Prices } from "./run";

/** Dollars per token for each model, from OpenRouter's model list. Other servers: unknown. */
export async function pricesFor(url: string, models: string[]): Promise<Record<string, Prices>> {
  if (!/openrouter\.ai/.test(url)) return {};
  const res = await fetch(`${url}/models`).catch(() => null);
  if (!res?.ok) return {};
  const json = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }> };
  const out: Record<string, Prices> = {};
  for (const m of json.data ?? []) {
    if (models.includes(m.id) && m.pricing?.prompt !== undefined && m.pricing.completion !== undefined) {
      const p = m.pricing;
      out[m.id] = {
        prompt: Number(p.prompt), completion: Number(p.completion),
        ...(p.input_cache_read !== undefined ? { cacheRead: Number(p.input_cache_read) } : {}),
        ...(p.input_cache_write !== undefined ? { cacheWrite: Number(p.input_cache_write) } : {}),
      };
    }
  }
  return out;
}
