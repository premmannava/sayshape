/**
 * The model proxy for the public website: a Cloudflare Worker that answers
 * questions about a spreadsheet with a SayShape interface, without the API
 * key or the spreadsheet ever reaching the model provider from the browser.
 *
 * The browser sends the question, the column names and three sample rows
 * (and a Turnstile token); the rows themselves stay in the browser. The
 * worker builds every message itself, with SayShape's own model client
 * (src/model): the guide, the request and at most one repair. So the key can
 * only ever be used for this one model and this one job.
 *
 *   POST /answer   {"question": "...", "rows": 18217, "columns": [{"name": "country", "type": "text", "distinct": 12}, ...],
 *                   "sample": [{"country": "Germany", ...}, ...], "token": "..."}
 *   → 200 application/x-ndjson, one JSON object per line:
 *       {"t":"phase","v":"writing"}   what the model is doing
 *       {"t":"text","v":"card\n"}     clean SayShape lines, to push into the engine
 *       {"t":"reset"}                 throw away what was shown: a repair is coming
 *       {"t":"done","spec":"…","problems":0,"repaired":false,"ms":1234,"model":"…","tokens":{"in":10900,"out":180}}
 *       {"t":"error","message":"…"}   a message to show; the stream ends
 *
 * Plain functions with no Cloudflare types, so test/worker.test.ts can run
 * it in Node with a fake model.
 */
import { generateSpec, ModelError, type Phase } from "../../src/model";
import { coreComponents } from "../../src/components";
import { Registry } from "../../src/registry";
import { answerGuide, answerRequest, checkAnswer, DATA, readQuestion } from "./answer";

/** The part of a Workers KV namespace the daily count uses. */
export interface Counter {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** The provider key. A secret: `wrangler secret put MODEL_API_KEY`. */
  MODEL_API_KEY?: string;
  /** The one model this proxy calls, as the provider names it. */
  MODEL?: string;
  /** The model's name as people see it on the page. Default: MODEL. */
  MODEL_LABEL?: string;
  /** OpenAI-compatible base URL. Default: NVIDIA's API. */
  MODEL_URL?: string;
  /** "false" when the provider refuses stream_options (then the page shows no token counts). */
  STREAM_USAGE?: string;
  /** Comma-separated origins allowed to call, e.g. https://premmannava.github.io */
  ALLOWED_ORIGINS?: string;
  /** Turnstile secret. When set, every request needs a valid token. */
  TURNSTILE_SECRET?: string;
  /** "false" turns answers off without redeploying the site. */
  GENERATION_ENABLED?: string;
  /** Workers rate limiting binding, keyed by IP. Optional. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Questions answered per day (UTC) for the whole site, counted in ANSWER_COUNT. Default 500. */
  DAILY_ANSWERS?: string;
  /** A KV namespace for the daily count. Without it there's no daily cap. */
  ANSWER_COUNT?: Counter;
}

export interface Deps {
  fetch?: typeof fetch;
  /** Keeps the worker running until the stream ends (ctx.waitUntil on Cloudflare). */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Today's date, for the daily count. */
  today?: () => string;
}

/** Big enough for 40 columns and 3 rows of 100-character cells; far too small for a spreadsheet. */
export const MAX_BODY_BYTES = 16_000;
const MAX_TOKENS = 3_000;
const DEFAULT_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_DAILY = 500;
const registry = new Registry(coreComponents);

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const allowedOrigins = (env: Env) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export const DAILY_LIMIT_MESSAGE = "Today's free questions are used up. Try the sample spreadsheets, or come back tomorrow.";

/** What a person sees when the model call fails. Never the provider's raw reply. */
export function friendlyError(e: unknown): string {
  if (e instanceof ModelError) {
    if (e.status === 429) return "The model is busy right now. Try again in a minute, or try the sample spreadsheets.";
    if (e.status === 401 || e.status === 403) return "The model service rejected this site's credentials. Live answers are unavailable right now.";
    if (e.status === 402) return "The model service needs credits for this request. Live answers are unavailable right now.";
    if (e.status !== undefined && e.status >= 500) return "The model service had a problem. Try again in a minute.";
    return "The model didn't answer as expected. Try again, or ask it another way.";
  }
  return "Something went wrong while answering. Try again.";
}

async function verifyTurnstile(env: Env, token: string, ip: string, doFetch: typeof fetch): Promise<boolean> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET!);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

/**
 * Count one more answer today, or say the day's are used up. KV is eventually
 * consistent, so two requests at the same moment can both get through: the
 * cap is a guard against runaway use, not an exact count.
 */
async function takeDaily(env: Env, today: string): Promise<boolean> {
  if (!env.ANSWER_COUNT) return true;
  const cap = Number(env.DAILY_ANSWERS ?? DEFAULT_DAILY);
  const key = `answers:${today}`;
  const used = Number((await env.ANSWER_COUNT.get(key)) ?? 0) || 0;
  if (Number.isFinite(cap) && used >= cap) return false;
  await env.ANSWER_COUNT.put(key, String(used + 1), { expirationTtl: 2 * 24 * 60 * 60 });
  return true;
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const url = new URL(req.url);
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(env);

  if (url.pathname !== "/answer") return json(404, { error: "Not found" });
  // Only the site may call. (Origin can be forged outside a browser; Turnstile and rate limits cover that.)
  if (!allowed.includes(origin)) return json(403, { error: "This origin isn't allowed" });
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST" }, cors);

  if (env.GENERATION_ENABLED === "false") return json(503, { error: "Live answers are turned off right now. The sample spreadsheets still work." }, cors);
  if (!env.MODEL_API_KEY || !env.MODEL) return json(503, { error: "Live answers aren't configured." }, cors);

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "That's more than a question: only the columns and three sample rows are sent." }, cors);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Send JSON" }, cors);
  }
  const q = readQuestion(body);
  if ("error" in q) return json(400, { error: q.error }, cors);

  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  if (env.TURNSTILE_SECRET) {
    const token = typeof body.token === "string" ? body.token : "";
    if (!token || !(await verifyTurnstile(env, token, ip, doFetch))) return json(403, { error: "The human check failed. Reload the page and try again." }, cors);
  }
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: ip || "unknown" });
    if (!success) return json(429, { error: "That's a lot of questions at once. Wait a minute and try again." }, cors);
  }
  const today = deps.today?.() ?? new Date().toISOString().slice(0, 10);
  if (!(await takeDaily(env, today))) return json(429, { error: DAILY_LIMIT_MESSAGE, daily: true }, cors);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: Record<string, unknown>) => writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});

  const run = async () => {
    try {
      const result = await generateSpec({
        config: {
          url: env.MODEL_URL ?? DEFAULT_URL,
          model: env.MODEL!,
          apiKey: env.MODEL_API_KEY,
          maxTokens: MAX_TOKENS,
          streamUsage: env.STREAM_USAGE !== "false",
        },
        registry,
        request: answerRequest(q),
        guide: answerGuide(),
        stateNames: [DATA],
        check: checkAnswer,
        // One repair, only for errors: lines the parser had to skip, or an answer that doesn't read the data.
        repairOn: "errors",
        signal: req.signal,
        fetch: doFetch,
        onText: (v) => void send({ t: "text", v }),
        onReset: () => void send({ t: "reset" }),
        onPhase: (v: Phase) => void send({ t: "phase", v }),
      });
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (!result.spec.trim() || errors.some((d) => /never reads data|Don't declare data/.test(d.message))) {
        await send({ t: "error", message: "The model couldn't answer that one from the spreadsheet. Try asking it another way." });
        return;
      }
      const { promptTokens, completionTokens } = result.usage;
      await send({
        t: "done",
        spec: result.spec,
        problems: result.diagnostics.length,
        repaired: !!result.repair,
        ms: Math.round(result.timings.totalMs),
        model: env.MODEL_LABEL?.trim() || env.MODEL,
        ...(promptTokens !== undefined && completionTokens !== undefined ? { tokens: { in: promptTokens, out: completionTokens } } : {}),
      });
    } catch (e) {
      if (!req.signal?.aborted) await send({ t: "error", message: friendlyError(e) });
    } finally {
      await writer.close().catch(() => {});
    }
  };

  // Keep the worker alive until the stream finishes, where the platform offers waitUntil.
  const done = run();
  deps.waitUntil?.(done);
  return new Response(readable, { status: 200, headers: { ...cors, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
