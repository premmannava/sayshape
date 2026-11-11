/**
 * The chat page's connection to the model proxy (worker/).
 *
 * Everything here is public: the proxy's address and the Turnstile site key
 * come from build-time variables (VITE_SAYSHAPE_MODEL_ENDPOINT,
 * VITE_TURNSTILE_SITE_KEY), and the API key never leaves the proxy. Nothing
 * is requested while the page loads: the status check and the human check
 * start when someone begins to ask, so a visit that only reads makes no
 * request outside the site.
 */
import { readEvents, refusal, type ChatBody, type ChatEvent, type Failure } from "./chat";

const BASE = ((import.meta.env.VITE_SAYSHAPE_MODEL_ENDPOINT as string | undefined)?.trim() || "").replace(/\/(answer|status)\/?$/, "").replace(/\/+$/, "");
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || "";
/** The model's name for the page before the proxy has said it. */
export const MODEL_LABEL = (import.meta.env.VITE_SAYSHAPE_MODEL_LABEL as string | undefined)?.trim() || "";

// https only, except a local proxy (wrangler dev) while developing.
export const configured = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?($|\/)/.test(BASE);
export const needsHumanCheck = configured && !!TURNSTILE_SITE_KEY;

export type Status = { enabled: true; model?: string } | { enabled: false; failure: Failure };

/** Whether answers are on, asked without calling the model. Null when the proxy can't be reached (sending will say so). */
export async function fetchStatus(signal?: AbortSignal): Promise<Status | null> {
  try {
    const res = await fetch(`${BASE}/status`, { signal });
    if (!res.ok) return { enabled: false, failure: refusal(res.status, undefined) };
    const s = (await res.json()) as { enabled?: boolean; model?: string; reason?: string };
    if (s.enabled) return { enabled: true, model: typeof s.model === "string" ? s.model : undefined };
    return { enabled: false, failure: refusal(503, s.reason) };
  } catch {
    return null;
  }
}

/**
 * Send a question. Streamed events go to onEvent; a refusal before any answer
 * (off, rate limit, daily cap…) is returned. A network failure throws.
 */
export async function send(body: ChatBody, opts: { token?: string; signal: AbortSignal; onEvent: (e: ChatEvent) => void }): Promise<Failure | null> {
  const res = await fetch(`${BASE}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.token ? { ...body, token: opts.token } : body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let reason: string | undefined;
    try { reason = ((await res.json()) as { reason?: string }).reason; } catch { /* no body: go by the status */ }
    return refusal(res.status, reason);
  }
  await readEvents(res.body, opts.onEvent);
  return null;
}

// ---------------------------------------------------------------- Turnstile

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let scriptLoading: Promise<TurnstileApi> | null = null;

/** Cloudflare's script, loaded only when someone starts to ask. */
function loadTurnstile(): Promise<TurnstileApi> {
  scriptLoading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load")));
    s.onerror = () => { scriptLoading = null; reject(new Error("The human check couldn't load. Check your connection or content blocker.")); };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/** A Turnstile widget in `el`. Each token works once; take() waits for a fresh one. */
export function humanCheck(el: HTMLElement) {
  let id: string | null = null;
  let token: string | null = null;
  let waiting: Array<(t: string) => void> = [];
  let api: TurnstileApi | null = null;
  let starting: Promise<void> | null = null;

  function start(): Promise<void> {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve();
    starting ??= loadTurnstile().then((t) => {
      api = t;
      id = t.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "flexible",
        appearance: "interaction-only",
        callback: (v: string) => { token = v; waiting.splice(0).forEach((w) => w(v)); },
        "expired-callback": () => { token = null; },
      });
    }).catch((e) => { starting = null; throw e; });
    return starting;
  }

  return {
    start,
    async take(): Promise<string> {
      await start();
      const t = token ?? (await new Promise<string>((r) => waiting.push(r)));
      token = null;
      // Ask for the next token right away, so a follow-up doesn't wait.
      if (api && id) api.reset(id);
      return t;
    },
    destroy() {
      if (api && id) api.remove(id);
      id = null;
      starting = null;
      waiting = [];
    },
  };
}
