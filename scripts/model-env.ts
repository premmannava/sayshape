/**
 * Reads the model settings from .env.local (or the environment), for the
 * playground's dev server and the evaluation script. Never sent to a browser:
 * the playground reaches the model through the dev server's /api/model proxy.
 *
 *   SAYSHAPE_MODEL_URL    OpenAI-compatible base URL, up to /v1. Default: LM Studio, http://localhost:1234/v1
 *   SAYSHAPE_MODEL        Model name. Default: the playground lets you pick from the server's list.
 *   SAYSHAPE_API_KEY      Bearer token, if the server needs one.
 *   SAYSHAPE_USER_SUFFIX  Text added to every request, e.g. /no_think to stop Qwen3 thinking first.
 *   SAYSHAPE_PROMPT_CACHE Mark the guide for prompt caching (npm run eval and compare): 1 for about
 *                     5 minutes, 1h for an hour. Needed for Anthropic models; OpenAI caches on its own.
 */
import { loadEnv } from "vite";

export interface ModelEnv {
  url: string;
  model: string;
  apiKey: string;
  userSuffix: string;
  /** ModelConfig.cache: true, "1h", or undefined when off. */
  cache?: true | "1h";
}

export const DEFAULT_MODEL_URL = "http://localhost:1234/v1";

export function readModelEnv(mode = "development", dir = process.cwd()): ModelEnv {
  const env = { ...loadEnv(mode, dir, "SAYSHAPE_"), ...pick(process.env) };
  return {
    url: (env.SAYSHAPE_MODEL_URL || DEFAULT_MODEL_URL).replace(/\/+$/, ""),
    model: env.SAYSHAPE_MODEL ?? "",
    apiKey: env.SAYSHAPE_API_KEY ?? "",
    userSuffix: env.SAYSHAPE_USER_SUFFIX ?? "",
    cache: parseCache(env.SAYSHAPE_PROMPT_CACHE),
  };
}

/** "1h" caches for an hour; 1, true, yes, on or 5m for the default; anything else is off. */
export function parseCache(value: string | undefined): true | "1h" | undefined {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "1h") return "1h";
  return ["1", "true", "yes", "on", "5m"].includes(v) ? true : undefined;
}

/** SAYSHAPE_ variables already in the environment win over the file. */
function pick(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith("SAYSHAPE_") && v !== undefined)) as Record<string, string>;
}
