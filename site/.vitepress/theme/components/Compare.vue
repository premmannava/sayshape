<script setup lang="ts">
/**
 * The live comparison: one request, answered by one model three times at
 * the same moment, in SayShape, HTML and A2UI, played back at the speed each
 * answer arrived (recorded by scripts/record.ts into public/compare/).
 *
 * Each pane draws its answer the way that format is drawn for real:
 * SayShape by the engine from ../../src, line by line; HTML in a sandboxed
 * iframe, refreshed as markup arrives; A2UI by Google's own Lit renderer
 * (@a2ui/lit), fed each message once it is complete. Nothing is repaired or
 * edited: a broken answer is shown broken.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { withBase } from "vitepress";
import { useLoom } from "../loom/useLoom";

type Chunk = [number, string | null];
interface FormatRecording { chunks: Chunk[]; doneMs?: number; error?: string }
interface Recording {
  id: string;
  request: string;
  model: string;
  recordedAt: string;
  formats: { sayshape: FormatRecording; html: FormatRecording; a2ui: FormatRecording };
}
interface Entry { id: string; model: string; file: string; request: string }
type Key = keyof Recording["formats"];

/** Short names for the benchmark tasks the gallery records (eval/compare/tasks.ts). */
const TITLES: Record<string, string> = {
  k3: "Budget tracker", c5: "Signups chart", t2: "Product search", f1: "Sign-up form",
  f2: "To-do list", x1: "Mortgage calculator", d4: "Spending tracker",
};
const title = (e: { id: string }) => TITLES[e.id] ?? e.id;

const entries = ref<Entry[]>([]);
const loadError = ref<string | null>(null);
const model = ref("");
const pick = ref("");
const rec = shallowRef<Recording | null>(null);
const now = ref(0);
const playing = ref(false);
const open = ref<Record<Key, boolean>>({ sayshape: false, html: false, a2ui: false });

const models = computed(() => [...new Set(entries.value.map((e) => e.model))]);
const shown = computed(() => entries.value.filter((e) => e.model === model.value));

/** When the last of the three answers ended. */
const end = computed(() => {
  const r = rec.value;
  if (!r) return 0;
  return Math.max(...(Object.values(r.formats) as FormatRecording[]).map((f) => f.doneMs ?? f.chunks.at(-1)?.[0] ?? 0), 1);
});

/** The text of an answer as it stood at time t: its chunks so far, starting over at a reset. */
function textAt(f: FormatRecording | undefined, t: number): string {
  if (!f) return "";
  let out = "";
  for (const [at, text] of f.chunks) {
    if (at > t) break;
    out = text === null ? "" : out + text;
  }
  return out;
}

function statusOf(f: FormatRecording | undefined, text: string, t: number): { label: string; kind: "idle" | "live" | "done" | "failed" } {
  if (!f) return { label: "No answer", kind: "idle" };
  const finished = f.doneMs ?? f.chunks.at(-1)?.[0] ?? 0;
  if (f.error && t >= finished) return { label: "The request failed", kind: "failed" };
  if (t <= 0) return { label: "Ready", kind: "idle" };
  if (f.doneMs !== undefined && t >= f.doneMs) return { label: "Done", kind: "done" };
  if (!text) return { label: "Waiting for the model", kind: "live" };
  return { label: "Streaming", kind: "live" };
}

const texts = computed(() => ({
  sayshape: textAt(rec.value?.formats.sayshape, now.value),
  html: textAt(rec.value?.formats.html, now.value),
  a2ui: textAt(rec.value?.formats.a2ui, now.value),
}));
const status = computed(() => ({
  sayshape: statusOf(rec.value?.formats.sayshape, texts.value.sayshape, now.value),
  html: statusOf(rec.value?.formats.html, texts.value.html, now.value),
  a2ui: statusOf(rec.value?.formats.a2ui, texts.value.a2ui, now.value),
}));
const doneAt = (k: Key) => { const d = rec.value?.formats[k].doneMs; return d !== undefined && now.value >= d; };

// --- Loading recordings -----------------------------------------------------

async function loadIndex() {
  try {
    const res = await fetch(withBase("/compare/index.json"));
    if (!res.ok) throw new Error(`index.json: ${res.status}`);
    entries.value = (await res.json()) as Entry[];
    model.value = entries.value[0]?.model ?? "";
    if (entries.value[0]) await choose(entries.value[0]);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}

async function choose(e: Entry) {
  pause();
  pick.value = e.file;
  rec.value = null;
  now.value = 0;
  try {
    const res = await fetch(withBase(`/compare/${e.file}`));
    if (!res.ok) throw new Error(`${e.file}: ${res.status}`);
    rec.value = (await res.json()) as Recording;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  }
}

function chooseModel(m: string) {
  model.value = m;
  const first = entries.value.find((e) => e.model === m && e.id === rec.value?.id) ?? entries.value.find((e) => e.model === m);
  if (first) void choose(first);
}

// --- Playback ----------------------------------------------------------------

let frame = 0;
let last = 0;
function tick(ts: number) {
  if (playing.value) {
    now.value = Math.min(end.value, now.value + (last ? ts - last : 0));
    if (now.value >= end.value) playing.value = false;
  }
  last = ts;
  frame = requestAnimationFrame(tick);
}
function play() { if (now.value >= end.value) now.value = 0; playing.value = true; }
function pause() { playing.value = false; }
function restart() { now.value = 0; playing.value = true; }
function scrub(ev: Event) { pause(); now.value = Number((ev.target as HTMLInputElement).value); }

// --- SayShape: the engine, streamed ----------------------------------------

const canvas = ref<HTMLCanvasElement | null>(null);
let sShown = "";
let sStreaming = false;
const { loom } = useLoom(canvas, () => { sShown = "\u0000"; applySayShape(); });

function applySayShape() {
  const l = loom.value;
  if (!l) return;
  const text = texts.value.sayshape;
  if (sStreaming && text.startsWith(sShown)) {
    if (text.length > sShown.length) l.push(text.slice(sShown.length));
  } else if (text !== sShown) {
    // Started over, or scrubbed back: stream it again from the start.
    l.beginStream();
    sStreaming = true;
    if (text) l.push(text);
  }
  sShown = text;
  if (doneAt("sayshape") && sStreaming) { l.endStream(); sStreaming = false; }
}
// A string, so the watcher fires when the text or the end changes, not on every frame.
watch(() => `${doneAt("sayshape") ? 1 : 0}${texts.value.sayshape}`, applySayShape);

// --- HTML: a sandboxed iframe, refreshed as markup arrives ------------------

/** The HTML in an answer so far: thinking dropped, and the fenced block if the model fenced it. */
function htmlSoFar(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "");
  const fence = text.indexOf("```");
  if (fence < 0) return text;
  const start = text.indexOf("\n", fence);
  if (start < 0) return "";
  const body = text.slice(start + 1);
  const close = body.indexOf("```");
  return close < 0 ? body : body.slice(0, close);
}
const htmlDoc = computed(() => {
  const body = htmlSoFar(texts.value.html);
  return body ? `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>body{margin:16px;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>` : "";
});
const srcdoc = ref("");
let htmlTimer: ReturnType<typeof setTimeout> | null = null;
// Reloading the frame on every token would only flicker; a few times a second is how fast a person could notice.
watch(htmlDoc, (doc) => {
  if (!playing.value || doneAt("html")) { srcdoc.value = doc; return; }
  if (htmlTimer) return;
  htmlTimer = setTimeout(() => { htmlTimer = null; srcdoc.value = htmlDoc.value; }, 300);
});

// --- A2UI: Google's Lit renderer, fed complete messages ---------------------

type A2uiCore = typeof import("@a2ui/web_core/v0_9");
type A2uiLit = typeof import("@a2ui/lit/v0_9");
let a2: { core: A2uiCore; lit: A2uiLit } | null = null;
let processor: InstanceType<A2uiCore["MessageProcessor"]> | null = null;
const surface = shallowRef<unknown>(null);
const a2Problems = ref<string[]>([]);
const a2Failed = ref<string | null>(null);
let aShown = "";
let aCount = 0;

/** The complete top-level JSON objects in the text, in order, whatever lines or fences surround them. */
function completeObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && depth > 0) { if (--depth === 0) out.push(text.slice(start, i + 1)); }
  }
  return out;
}

function resetA2ui() {
  processor?.dispose();
  surface.value = null;
  a2Problems.value = [];
  aCount = 0;
  aShown = "";
  if (!a2) return;
  processor = new a2.core.MessageProcessor([a2.lit.basicCatalog]);
  processor.onSurfaceCreated((s) => { surface.value ??= s; });
}

function applyA2ui() {
  if (!a2) return;
  const text = texts.value.a2ui;
  if (!text.startsWith(aShown)) resetA2ui();
  aShown = text;
  const messages = completeObjects(text);
  for (; aCount < messages.length; aCount++) {
    try {
      processor!.processMessages(JSON.parse(messages[aCount]!));
    } catch (e) {
      a2Problems.value = [...a2Problems.value, `Message ${aCount + 1}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`];
    }
  }
}
watch(() => texts.value.a2ui, applyA2ui);

async function loadA2ui() {
  try {
    // Set up the way A2UI's own renderers are: its styles, its Markdown renderer for Text, and the
    // icon font its Icon component draws with (Material Symbols, self-hosted like the site's other fonts).
    const [core, lit, md] = await Promise.all([
      import("@a2ui/web_core/v0_9"), import("@a2ui/lit/v0_9"), import("@a2ui/markdown-it"),
      import("@fontsource/material-symbols-outlined/400.css"),
    ]);
    core.injectBasicCatalogStyles(document);
    core.setMarkdownRenderer(md.renderMarkdown);
    a2 = { core, lit };
    resetA2ui();
    applyA2ui();
  } catch (e) {
    a2Failed.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => {
  frame = requestAnimationFrame(tick);
  void loadIndex();
  void loadA2ui();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  if (htmlTimer) clearTimeout(htmlTimer);
  processor?.dispose();
});

const recordedOn = computed(() => (rec.value ? new Date(rec.value.recordedAt).toISOString().slice(0, 10) : ""));
const seconds = computed(() => (now.value / 1000).toFixed(1));
const toggle = (k: Key) => { open.value = { ...open.value, [k]: !open.value[k] }; };
</script>

<template>
  <div class="cmp">
    <header class="cmp-head">
      <h1>Same request. Three ways to draw it.</h1>
      <p>Each pane got the same request from the same model at the same moment. Watch how SayShape, HTML and A2UI turn the model's stream into an interface you can use, at the speed it arrived.</p>
    </header>

    <section class="cmp-card" aria-label="Request">
      <p v-if="loadError" class="cmp-error" role="alert">Couldn't load the recordings: {{ loadError }}</p>
      <div v-if="models.length > 1" class="cmp-row" role="group" aria-label="Model">
        <span class="cmp-label">Model</span>
        <button v-for="m in models" :key="m" type="button" class="cmp-chip" :aria-pressed="m === model" @click="chooseModel(m)">{{ m }}</button>
      </div>
      <div class="cmp-row" role="group" aria-label="Recordings">
        <span class="cmp-label">Recordings</span>
        <button v-for="e in shown" :key="e.file" type="button" class="cmp-chip" :aria-pressed="e.file === pick" @click="choose(e)">{{ title(e) }}</button>
      </div>
      <div class="cmp-request">
        <span class="cmp-label">Request</span>
        <p>{{ rec?.request ?? "Loading…" }}</p>
      </div>
      <div class="cmp-row cmp-controls">
        <button v-if="!playing" type="button" class="cmp-primary" :disabled="!rec" @click="play">{{ now >= end && now > 0 ? "Play again" : "Play" }}</button>
        <button v-else type="button" class="cmp-primary" @click="pause">Pause</button>
        <button type="button" class="cmp-secondary" :disabled="!rec" @click="restart">Start over</button>
        <label class="cmp-scrub">
          <span>Replay position</span>
          <input type="range" min="0" :max="end" step="any" :value="now" :disabled="!rec" @input="scrub">
        </label>
        <span class="cmp-time" aria-live="off">{{ seconds }} s</span>
      </div>
    </section>

    <section class="cmp-panes" aria-label="The three answers">
      <article class="cmp-pane">
        <div class="cmp-pane-head">
          <div class="cmp-pane-title"><h2>SayShape</h2><span :class="['cmp-pill', status.sayshape.kind]">{{ status.sayshape.label }}</span></div>
          <p class="cmp-who">Open source · works inside MCP Apps</p>
          <p class="cmp-what">Lines of text. Each line is drawn the moment it arrives.</p>
        </div>
        <div class="cmp-stage">
          <div class="loom-canvas-wrap"><canvas ref="canvas" aria-label="The SayShape answer, drawn by the engine"></canvas></div>
        </div>
        <div class="cmp-pane-foot">
          <button type="button" class="cmp-secondary" :aria-expanded="open.sayshape" @click="toggle('sayshape')">{{ open.sayshape ? "Hide" : "Show" }} what the model sent</button>
          <pre v-if="open.sayshape" class="cmp-source" tabindex="0">{{ texts.sayshape }}</pre>
        </div>
      </article>

      <article class="cmp-pane">
        <div class="cmp-pane-head">
          <div class="cmp-pane-title"><h2>HTML</h2><span :class="['cmp-pill', status.html.kind]">{{ status.html.label }}</span></div>
          <p class="cmp-who">The approach behind MCP Apps in Claude and ChatGPT</p>
          <p class="cmp-what">Code in a sandboxed iframe, refreshed as markup arrives. Scripts run when they arrive.</p>
        </div>
        <div class="cmp-stage">
          <iframe v-if="srcdoc" class="cmp-frame" sandbox="allow-scripts" :srcdoc="srcdoc" title="The HTML answer, in a sandboxed frame"></iframe>
          <p v-else class="cmp-empty">Nothing to show yet.</p>
        </div>
        <div class="cmp-pane-foot">
          <button type="button" class="cmp-secondary" :aria-expanded="open.html" @click="toggle('html')">{{ open.html ? "Hide" : "Show" }} what the model sent</button>
          <pre v-if="open.html" class="cmp-source" tabindex="0">{{ texts.html }}</pre>
        </div>
      </article>

      <article class="cmp-pane">
        <div class="cmp-pane-head">
          <div class="cmp-pane-title"><h2>A2UI</h2><span :class="['cmp-pill', status.a2ui.kind]">{{ status.a2ui.label }}</span></div>
          <p class="cmp-who">Google's standard, used in Gemini Enterprise and Opal</p>
          <p class="cmp-what">JSON messages drawn by A2UI's own renderer, each once it is complete.</p>
        </div>
        <div class="cmp-stage">
          <p v-if="a2Failed" class="cmp-error">The A2UI renderer couldn't start: {{ a2Failed }}</p>
          <div v-else-if="surface" class="cmp-a2ui"><a2ui-surface :surface.prop="surface"></a2ui-surface></div>
          <p v-else class="cmp-empty">Nothing to show yet.</p>
          <ul v-if="a2Problems.length" class="cmp-problems" aria-label="Messages the renderer refused">
            <li v-for="p in a2Problems" :key="p">{{ p }}</li>
          </ul>
        </div>
        <div class="cmp-pane-foot">
          <button type="button" class="cmp-secondary" :aria-expanded="open.a2ui" @click="toggle('a2ui')">{{ open.a2ui ? "Hide" : "Show" }} what the model sent</button>
          <pre v-if="open.a2ui" class="cmp-source" tabindex="0">{{ texts.a2ui }}</pre>
        </div>
      </article>
    </section>

    <footer v-if="rec" class="cmp-foot">
      <p>All three panes show {{ rec.model }} answering the same request on {{ recordedOn }}; the labels say who uses each format, not which app answered. These are first tries, played back at the speed they arrived and shown as they came, broken or not.</p>
      <p><a :href="withBase(`/compare/${pick}`)">The raw recording</a> · <a href="https://github.com/premmannava/sayshape/blob/main/scripts/record.ts">Record your own</a></p>
    </footer>
  </div>
</template>

<style scoped>
.cmp { max-width: 1360px; margin: 0 auto; padding: 32px 24px 64px; display: flex; flex-direction: column; gap: 24px; }
.cmp-head h1 { margin: 0 0 10px; font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; }
.cmp-head p { margin: 0; max-width: 780px; font-size: 17px; line-height: 1.55; color: var(--vp-c-text-2); }
.cmp-card { background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
.cmp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cmp-label { font-size: 14px; font-weight: 600; color: var(--vp-c-text-2); margin-right: 4px; }
.cmp-chip { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg); color: var(--vp-c-text-1); font-size: 14px; cursor: pointer; }
.cmp-chip[aria-pressed="true"] { border-color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); font-weight: 600; }
.cmp-request p { margin: 6px 0 0; font-size: 16px; line-height: 1.5; }
.cmp-controls { gap: 12px; }
.cmp-primary, .cmp-secondary { min-height: 44px; padding: 0 18px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
.cmp-primary { border: 0; background: var(--vp-c-brand-1); color: var(--vp-c-white); }
.cmp-secondary { border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg); color: var(--vp-c-text-1); font-weight: 500; }
.cmp-primary:disabled, .cmp-secondary:disabled { opacity: 0.5; cursor: default; }
.cmp-scrub { flex: 1 1 240px; display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--vp-c-text-2); min-width: 0; }
.cmp-scrub input { flex: 1; min-width: 0; accent-color: var(--vp-c-brand-1); height: 44px; }
.cmp-time { font-family: var(--vp-font-family-mono); font-size: 14px; color: var(--vp-c-text-2); min-width: 4.5em; text-align: right; }
.cmp-panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; align-items: start; }
.cmp-pane { border: 1px solid var(--vp-c-divider); border-radius: 14px; background: var(--vp-c-bg); display: flex; flex-direction: column; overflow: hidden; }
.cmp-pane-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--vp-c-divider); display: flex; flex-direction: column; gap: 6px; }
.cmp-pane-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cmp-pane-title h2 { margin: 0; padding: 0; border: 0; font-size: 20px; }
.cmp-who { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--vp-c-brand-1); }
.cmp-what { margin: 0; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2); }
.cmp-pill { padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 500; white-space: nowrap; background: var(--vp-c-default-soft); color: var(--vp-c-text-2); }
.cmp-pill.live { background: var(--vp-c-warning-soft); color: var(--vp-c-warning-1); }
.cmp-pill.done { background: var(--vp-c-success-soft); color: var(--vp-c-success-1); }
.cmp-pill.failed { background: var(--vp-c-danger-soft); color: var(--vp-c-danger-1); }
.cmp-stage { padding: 14px; min-height: 360px; background: var(--vp-c-bg-alt); display: flex; flex-direction: column; gap: 10px; }
.cmp-frame { width: 100%; height: 520px; border: 1px solid var(--vp-c-divider); border-radius: 10px; background: var(--vp-c-bg); }
.cmp-a2ui { background: var(--vp-c-bg); border: 1px solid var(--vp-c-divider); border-radius: 10px; padding: 12px; overflow: auto; max-height: 640px; }
.cmp-empty { margin: auto; color: var(--vp-c-text-2); font-size: 15px; }
.cmp-error { margin: 0; color: var(--vp-c-danger-1); font-size: 14px; }
.cmp-problems { margin: 0; padding-left: 18px; font-size: 13px; color: var(--vp-c-danger-1); }
.cmp-pane-foot { padding: 10px 18px 16px; border-top: 1px solid var(--vp-c-divider); display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.cmp-source { margin: 0; width: 100%; box-sizing: border-box; max-height: 360px; overflow: auto; padding: 12px; border-radius: 10px; background: var(--vp-code-block-bg); font: 12.5px/1.55 var(--vp-font-family-mono); white-space: pre; }
.cmp-foot { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--vp-c-text-2); border-top: 1px solid var(--vp-c-divider); padding-top: 16px; }
.cmp-foot p { margin: 0; line-height: 1.55; max-width: 900px; }
@media (max-width: 640px) { .cmp-head h1 { font-size: 30px; } .cmp { padding: 20px 16px 48px; } }
</style>
