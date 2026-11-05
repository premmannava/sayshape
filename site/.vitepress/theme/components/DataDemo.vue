<script setup lang="ts">
/**
 * The landing page's demo: pick a sample spreadsheet or drop your own, ask a
 * question, and see the answer drawn by SayShape.
 *
 * A sample spreadsheet's suggested questions replay saved answers, with no
 * model, and can be compared with the paragraph a plain chatbot would write.
 * Anything else (a typed question, or any question about your own file) is
 * answered live through the model proxy (worker/): the page sends only the
 * question, the column names and three sample rows, and the engine draws the
 * answer with every row, handed to it as host data. The file is read here,
 * in the browser, and never uploaded.
 */
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { demo, wordCount } from "../../../examples/data-demo";
import { payload, sampleRows, SAMPLE_ROWS, suggestQuestions, tableFromRows, type Table } from "../../../examples/spreadsheet";
import { highlightLine } from "../sayshape/highlight";
import { useSayShape } from "../sayshape/useSayShape";
import { prefersReducedMotion } from "../sayshape/runtime";
import type { SayShape } from "../sayshape/runtime";
import { ask, generationAvailable, humanCheck, MAX_QUESTION_CHARS, needsHumanCheck, type GenerateEvent } from "../sayshape/generate";
import { FileProblem, MAX_FILE_BYTES, readSpreadsheet } from "../sayshape/readFile";

/** The name live answers read the spreadsheet by (worker/src/answer.ts). */
const LIVE_NAME = "data";

interface OwnFile { name: string; table: Table; notes: string[] }
type Source = { kind: "sample"; index: number } | { kind: "file" };
type Answer = { kind: "saved"; index: number } | { kind: "live"; text: string };

const source = ref<Source>({ kind: "sample", index: 0 });
const answer = ref<Answer>({ kind: "saved", index: 0 });
const own = shallowRef<OwnFile | null>(null);
const mode = ref<"with" | "without">("with");
const draft = ref("");
const shown = ref("");
const writing = ref(false);
const reading = ref<string | null>(null);
const fileError = ref<string | null>(null);
const dragging = ref(false);

/** A live answer as it happens. */
const live = ref<{ phase: string; error: string | null; ms?: number; model?: string; tokens?: { in: number; out: number }; repaired?: boolean } | null>(null);

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const checkEl = ref<HTMLElement | null>(null);
let check: ReturnType<typeof humanCheck> | null = null;
let replay = { cancelled: false };
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

const group = (n: number) => n.toLocaleString("en-US");
const sampleTables = demo.map((e) => tableFromRows(e.dataset.rows as never));

const entry = computed(() => (source.value.kind === "sample" ? demo[source.value.index]! : null));
const table = computed<Table>(() => (source.value.kind === "sample" ? sampleTables[source.value.index]! : own.value!.table));
const sourceName = computed(() => (entry.value ? entry.value.dataset.name : own.value!.name));
const rest = computed(() => Math.max(0, table.value.rows.length - SAMPLE_ROWS));
const preview = computed(() => sampleRows(table.value).map((r) => table.value.columns.map((c) => (r[c.name] === null ? "" : String(r[c.name])))));
const saved = computed(() => (answer.value.kind === "saved" && entry.value ? entry.value.questions[answer.value.index]! : null));
const questionText = computed(() => (answer.value.kind === "live" ? answer.value.text : saved.value?.text ?? ""));
const isLive = computed(() => answer.value.kind === "live");

/** Questions to click: a sample's saved ones (instant), or ones worked out from your file's columns (live). */
const chips = computed(() =>
  entry.value
    ? entry.value.questions.map((x, i) => ({ text: x.text, pressed: answer.value.kind === "saved" && answer.value.index === i, pick: () => chooseSaved(i) }))
    : suggestQuestions(table.value).map((text) => ({ text, pressed: answer.value.kind === "live" && answer.value.text === text, pick: () => void askLive(text) })),
);

const lines = computed(() => {
  const all = shown.value ? shown.value.split("\n") : [];
  if (all.at(-1) === "") all.pop();
  return all.map((l, i) => ({ html: highlightLine(l), hot: writing.value && i === all.length - 1 }));
});

const status = computed(() => {
  const l = live.value;
  if (!isLive.value || !l) return "";
  if (l.error) return "";
  const phase: Record<string, string> = { waiting: "Waiting for the model…", thinking: "The model is thinking…", writing: "Writing…", repairing: "Fixing a problem…" };
  return writing.value ? phase[l.phase] ?? "Working…" : "";
});

const metrics = computed(() => {
  const t = table.value;
  if (isLive.value) {
    const l = live.value;
    return [
      { label: "Sent to the model", value: `${t.columns.length} columns, ${Math.min(SAMPLE_ROWS, t.rows.length)} rows`, tone: "good" },
      { label: "Stayed in your browser", value: `${group(rest.value)} rows`, tone: "good" },
      { label: "Time", value: l?.ms !== undefined ? `${(l.ms / 1000).toFixed(1)} s` : writing.value ? "…" : "—", tone: "" },
      { label: "Tokens", value: l?.tokens ? `${group(l.tokens.in)} in · ${group(l.tokens.out)} out` : writing.value ? "…" : "Not reported", tone: "" },
    ];
  }
  const s = saved.value!;
  return mode.value === "with"
    ? [
        { label: "Sent to the model", value: `${SAMPLE_ROWS} sample rows`, tone: "good" },
        { label: "Stayed in your browser", value: `${group(rest.value)} rows`, tone: "good" },
        { label: "The AI wrote", value: `${s.spec.split("\n").filter(Boolean).length} lines`, tone: "" },
      ]
    : [
        { label: "Sent to the model", value: `All ${group(t.rows.length)} rows`, tone: "bad" },
        { label: "Stayed in your browser", value: "None", tone: "bad" },
        { label: "The AI wrote", value: `${wordCount(s.plain)} words`, tone: "" },
      ];
});

const { sayshape, failed } = useSayShape(canvas, () => { playSaved(!prefersReducedMotion()); }, { lazy: root });

function stop() {
  replay.cancelled = true;
  if (timer) { clearTimeout(timer); timer = null; }
  controller?.abort();
  controller = null;
}

/** Start a fresh answer with the spreadsheet in the engine's state. A stream starts with empty state, so the data goes in after. */
function begin(l: SayShape, name: string) {
  l.beginStream();
  l.state.set(name, table.value.rows as unknown as Parameters<SayShape["state"]["set"]>[1]);
}

/** Replay a sample's saved answer a few characters at a time, like a model's tokens. */
function playSaved(animate = true) {
  const l = sayshape.value;
  const e = entry.value;
  if (!l || !e || answer.value.kind !== "saved") return;
  stop();
  live.value = null;
  const mine = (replay = { cancelled: false });
  const spec = e.questions[answer.value.index]!.spec;
  begin(l, e.dataset.state);
  if (!animate) {
    l.push(spec);
    l.endStream();
    shown.value = spec;
    writing.value = false;
    return;
  }
  writing.value = true;
  shown.value = "";
  let i = 0;
  const tick = () => {
    if (mine.cancelled) return;
    const n = Math.min(spec.length, i + 3 + Math.floor(Math.random() * 6));
    l.push(spec.slice(i, n));
    i = n;
    shown.value = spec.slice(0, i);
    if (i < spec.length) timer = setTimeout(tick, 18);
    else { l.endStream(); writing.value = false; timer = null; }
  };
  tick();
}

function startCheck() {
  if (!needsHumanCheck || check || !checkEl.value) return;
  check = humanCheck(checkEl.value);
  void check.start().catch(() => {});
}

/** Ask the model through the proxy: the question, the columns and three rows go; the rows stay here. */
async function askLive(text: string) {
  const question = text.trim().slice(0, MAX_QUESTION_CHARS);
  const l = sayshape.value;
  if (!question || !l || !generationAvailable) return;
  stop();
  mode.value = "with";
  answer.value = { kind: "live", text: question };
  live.value = { phase: "waiting", error: null };
  shown.value = "";
  writing.value = true;
  begin(l, LIVE_NAME);
  const mine = (controller = new AbortController());
  const fail = (message: string) => {
    if (controller !== mine) return;
    l.endStream();
    writing.value = false;
    live.value = { ...live.value!, error: message };
  };
  try {
    let token: string | undefined;
    if (needsHumanCheck) {
      startCheck();
      token = await check!.take();
      if (controller !== mine) return;
    }
    await ask(payload(table.value, question), {
      token,
      signal: mine.signal,
      onEvent: (e: GenerateEvent) => {
        if (controller !== mine) return;
        if (e.t === "phase") live.value = { ...live.value!, phase: e.v };
        else if (e.t === "text") { l.push(e.v); shown.value += e.v; }
        else if (e.t === "reset") { begin(l, LIVE_NAME); shown.value = ""; }
        else if (e.t === "done") {
          l.endStream();
          writing.value = false;
          live.value = { ...live.value!, phase: "done", ms: e.ms, model: e.model, tokens: e.tokens, repaired: e.repaired };
        } else if (e.t === "error") fail(e.message);
      },
    });
    if (controller === mine && writing.value) fail("The answer stopped before it was finished. Try again.");
  } catch (e) {
    if (mine.signal.aborted) return;
    fail(e instanceof Error && e.message ? `Couldn't reach the model: ${e.message}` : "Couldn't reach the model. Check your connection and try again.");
  }
}

function chooseSample(i: number) {
  if (source.value.kind === "sample" && source.value.index === i) return;
  source.value = { kind: "sample", index: i };
  answer.value = { kind: "saved", index: 0 };
  fileError.value = null;
  playSaved(!prefersReducedMotion());
}

function chooseSaved(i: number) {
  answer.value = { kind: "saved", index: i };
  playSaved(!prefersReducedMotion());
}

/** Switch to your own file and answer its first suggested question. */
function chooseOwn(again = false) {
  if (!own.value || (source.value.kind === "file" && !again)) return;
  source.value = { kind: "file" };
  fileError.value = null;
  const first = suggestQuestions(own.value.table)[0];
  if (first) void askLive(first);
}

function submit() {
  if (draft.value.trim()) void askLive(draft.value);
}

async function takeFile(file: File | undefined) {
  if (!file) return;
  fileError.value = null;
  reading.value = file.name;
  try {
    const { table: t, sheet } = await readSpreadsheet(file);
    own.value = { name: file.name, table: t, notes: [...(sheet ? [sheet] : []), ...t.notes] };
    chooseOwn(true);
  } catch (e) {
    fileError.value = e instanceof FileProblem ? e.message : "This file couldn't be read. Try saving it again, or as .csv.";
  } finally {
    reading.value = null;
  }
}

function onPick(ev: Event) {
  const input = ev.target as HTMLInputElement;
  void takeFile(input.files?.[0]);
  input.value = "";
}
function onDrop(ev: DragEvent) {
  dragging.value = false;
  void takeFile(ev.dataTransfer?.files?.[0]);
}
function removeOwn() {
  own.value = null;
  if (source.value.kind === "file") chooseSample(0);
}

onBeforeUnmount(() => {
  stop();
  check?.destroy();
});
</script>

<template>
  <section id="demo" ref="root" class="dd" aria-label="Ask a spreadsheet a question">
    <div class="dd-left">
      <div class="dd-step">
        <p class="dd-eyebrow">1 · Pick a spreadsheet</p>
        <div class="dd-sheets" role="group" aria-label="Spreadsheets">
          <button v-for="(e, i) in demo" :key="e.dataset.id" type="button" class="dd-sheet" :aria-pressed="source.kind === 'sample' && source.index === i" @click="chooseSample(i)">
            <span class="dd-sheet-name">{{ e.dataset.name }} <span class="dd-tag">sample</span></span>
            <span class="dd-sheet-meta">{{ group(e.dataset.rows.length) }} rows · {{ e.dataset.columns.length }} columns</span>
          </button>
          <div v-if="own" class="dd-own-row">
            <button type="button" class="dd-sheet" :aria-pressed="source.kind === 'file'" @click="chooseOwn()">
              <span class="dd-sheet-name">{{ own.name }} <span class="dd-tag">yours</span></span>
              <span class="dd-sheet-meta">{{ group(own.table.rows.length) }} rows · {{ own.table.columns.length }} columns · stays in this browser</span>
            </button>
            <button type="button" class="dd-remove" :aria-label="`Remove ${own.name}`" @click="removeOwn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <label v-if="generationAvailable" class="dd-drop" :class="{ over: dragging, busy: reading }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" class="dd-file" :disabled="!!reading" @change="onPick" @focus="startCheck">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <span>
            <strong>{{ reading ? `Reading ${reading}…` : own ? "Use another file" : "Use your own file" }}</strong>
            <span>Excel (.xlsx) or CSV, up to {{ MAX_FILE_BYTES / 1024 / 1024 }} MB. Read here; never uploaded.</span>
          </span>
        </label>
        <div v-else class="dd-drop off">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <span><strong>Your own file</strong><span>Live answers aren't switched on for this copy of the site.</span></span>
        </div>
        <p v-if="fileError" class="dd-error" role="alert">{{ fileError }}</p>
        <ul v-if="source.kind === 'file' && own?.notes.length" class="dd-notes">
          <li v-for="n in own.notes" :key="n">{{ n }}</li>
        </ul>
      </div>

      <div class="dd-step">
        <p class="dd-note">The model only sees the column names and these rows:</p>
        <div class="dd-preview" tabindex="0" role="region" :aria-label="`Sample rows from ${sourceName}`">
          <table>
            <thead><tr><th v-for="c in table.columns" :key="c.name" scope="col">{{ c.name }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in preview" :key="i"><td v-for="(cell, j) in r" :key="j">{{ cell }}</td></tr>
              <tr class="dd-rest"><td :colspan="table.columns.length">+ {{ group(rest) }} more rows that stay in your browser</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="dd-step">
        <p class="dd-eyebrow">2 · Ask a question</p>
        <div class="dd-asks" role="group" aria-label="Suggested questions">
          <button v-for="x in chips" :key="x.text" type="button" class="dd-ask" :aria-pressed="x.pressed" :disabled="!entry && !generationAvailable" @click="x.pick">{{ x.text }}</button>
        </div>
        <form v-if="generationAvailable" class="dd-form" @submit.prevent="submit">
          <label class="dd-visually-hidden" for="dd-question">Ask anything about {{ sourceName }}</label>
          <input id="dd-question" v-model="draft" type="text" :maxlength="MAX_QUESTION_CHARS" :placeholder="`Ask anything about ${source.kind === 'file' ? 'your file' : 'this spreadsheet'}…`" autocomplete="off" @focus="startCheck">
          <button type="submit" class="sayshape-btn primary small" :disabled="!draft.trim()">Ask</button>
        </form>
        <div ref="checkEl" class="dd-check"></div>
      </div>
    </div>

    <div class="dd-right">
      <div class="dd-head">
        <p class="dd-eyebrow">3 · See the answer</p>
        <span v-if="isLive" class="dd-live"><span class="dot" aria-hidden="true"></span>Live{{ live?.model ? ` · ${live.model}` : "" }}</span>
        <div v-else class="dd-seg" role="group" aria-label="Answer">
          <button type="button" :aria-pressed="mode === 'with'" @click="mode = 'with'">With SayShape</button>
          <button type="button" :aria-pressed="mode === 'without'" @click="mode = 'without'">Without</button>
        </div>
      </div>

      <p class="dd-question">“{{ questionText }}”</p>
      <p v-if="status" class="dd-status" aria-live="polite">{{ status }}</p>
      <p v-if="live?.error" class="dd-error dd-answer-error" role="alert">{{ live.error }}</p>

      <div v-show="mode === 'with' && !live?.error" class="dd-stage sayshape-stage">
        <p v-if="failed" class="dd-failed">The demo couldn't start: {{ failed }}</p>
        <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`The answer to “${questionText}”, drawn by SayShape. The lines the AI wrote are below.`"></canvas></div>
      </div>

      <div v-if="mode === 'without' && saved" class="dd-plain">
        <div class="dd-bubble">
          <span class="dd-avatar" aria-hidden="true">AI</span>
          <p>{{ saved.plain }}</p>
        </div>
        <p class="dd-aside">A plain chatbot needs every row to answer, and you get a paragraph to read.</p>
      </div>

      <dl class="dd-metrics" :class="{ four: metrics.length === 4 }" aria-live="polite">
        <div v-for="m in metrics" :key="m.label" :class="['dd-metric', m.tone]">
          <dt>{{ m.label }}</dt>
          <dd>{{ m.value }}</dd>
        </div>
      </dl>

      <details v-show="mode === 'with' && lines.length" class="dd-spec">
        <summary>What the AI wrote <span>({{ lines.length }} lines{{ writing ? ", still writing" : "" }}{{ live?.repaired ? ", after one fix" : "" }})</span></summary>
        <pre class="spec-view numbered" tabindex="0" :aria-label="`The SayShape answer to “${questionText}”`"><code><span v-for="(l, i) in lines" :key="i" class="line" :class="{ hot: l.hot }" v-html="l.html"></span></code></pre>
      </details>
    </div>
  </section>
</template>

<style scoped>
.dd { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); border: 2px solid var(--ss-rule); border-radius: 22px; background: var(--ss-card); box-shadow: 8px 8px 0 var(--ss-shadow); overflow: hidden; scroll-margin-top: 96px }
.dd-left { display: flex; flex-direction: column; gap: 22px; padding: 26px; background: var(--vp-c-bg-alt); border-right: 1.5px solid var(--vp-c-divider); min-width: 0 }
.dd-right { display: flex; flex-direction: column; gap: 16px; padding: 26px; min-width: 0 }
.dd-step { display: flex; flex-direction: column; gap: 10px; min-width: 0 }
.dd-eyebrow { margin: 0; font: 500 12px/1.4 var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--vp-c-text-2) }
.dd-note { margin: 0; font-size: 14px; color: var(--vp-c-text-2) }
.dd-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }

.dd-sheets { display: grid; gap: 8px }
.dd-sheet { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; min-height: 56px; padding: 10px 14px; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: var(--ss-card); color: var(--vp-c-text-1); text-align: left; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s }
.dd-sheet:hover { border-color: var(--ss-rule) }
.dd-sheet[aria-pressed="true"] { border-color: var(--ss-rule); background: var(--ss-mark-soft); box-shadow: 3px 3px 0 var(--ss-shadow) }
.dd-sheet-name { font-weight: 600; font-size: 16px; overflow-wrap: anywhere }
.dd-tag { margin-left: 6px; font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vp-c-text-2) }
.dd-sheet-meta { font-size: 13px; color: var(--vp-c-text-2) }
.dd-own-row { display: flex; gap: 8px; align-items: stretch }
.dd-own-row .dd-sheet { flex: 1 }
.dd-remove { flex: none; width: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: var(--ss-card); color: var(--vp-c-text-2); cursor: pointer }
.dd-remove:hover { border-color: var(--ss-rule); color: var(--vp-c-text-1) }

.dd-drop { position: relative; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 14px; border: 1.5px dashed var(--vp-c-text-3); border-radius: 12px; color: var(--vp-c-text-2); cursor: pointer; transition: border-color 0.15s, background 0.15s }
.dd-drop:hover, .dd-drop.over, .dd-drop:focus-within { border-color: var(--ss-rule); border-style: solid; background: var(--ss-card) }
.dd-drop:focus-within { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.dd-drop.busy { cursor: progress }
.dd-drop.off { cursor: default }
.dd-drop.off:hover { border-style: dashed; border-color: var(--vp-c-text-3); background: none }
.dd-drop svg { flex: none }
.dd-drop > span { display: flex; flex-direction: column; font-size: 13px }
.dd-drop strong { font-size: 15px; color: var(--vp-c-text-1) }
.dd-file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer }
.dd-error { margin: 0; color: var(--sayshape-bad); font-size: 14px }
.dd-notes { margin: 0; padding-left: 18px; font-size: 13px; color: var(--vp-c-text-2) }

.dd-preview { overflow-x: auto; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: var(--ss-card) }
.dd-preview:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.dd-preview table { display: table; width: 100%; margin: 0; border-collapse: collapse; font: 12.5px/1.4 var(--vp-font-family-mono) }
.dd-preview th, .dd-preview td { padding: 8px 12px; border: 0; border-bottom: 1px solid var(--vp-c-divider); text-align: left; white-space: nowrap; background: none }
.dd-preview tr { background: none !important; border: 0 }
.dd-preview th { font-weight: 600; color: var(--vp-c-text-2) }
.dd-preview .dd-rest td { border-bottom: 0; color: var(--vp-c-text-2) }

.dd-asks { display: flex; flex-wrap: wrap; gap: 8px }
.dd-ask { min-height: 44px; padding: 8px 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 22px; background: var(--ss-card); color: var(--vp-c-text-1); font-size: 15px; text-align: left; cursor: pointer }
.dd-ask:hover { border-color: var(--ss-rule) }
.dd-ask[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--ss-on-ink) }
.dd-ask[disabled] { opacity: 0.5; cursor: not-allowed }
.dd-form { display: flex; gap: 8px; align-items: center }
.dd-form input { flex: 1; min-width: 0; min-height: 44px; padding: 0 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 22px; background: var(--ss-card); color: var(--vp-c-text-1); font: inherit; font-size: 15px }
.dd-form input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: var(--ss-rule) }
.dd-form .sayshape-btn { height: 44px; flex: none }
.dd-check:empty { display: none }

.dd-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px }
.dd-seg { display: inline-flex; gap: 4px; padding: 4px; border: 1.5px solid var(--ss-rule); border-radius: 999px; background: var(--ss-card) }
.dd-seg button { min-height: 40px; padding: 0 16px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1); cursor: pointer }
.dd-seg button[aria-pressed="true"] { background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.dd-live { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-1) }
.dd-live .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sayshape-ok) }
.dd-question { margin: 0; font: 600 clamp(20px, 2vw, 26px)/1.25 var(--sayshape-display); letter-spacing: -0.02em; color: var(--vp-c-text-1); overflow-wrap: anywhere }
.dd-status { margin: -6px 0 0; font: 13px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.dd-answer-error { padding: 14px 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: var(--vp-c-bg-alt) }

.dd-stage { min-height: 420px; border: 1.5px solid var(--vp-c-divider); border-radius: 16px }
.dd-failed { margin: 0; padding: 16px; color: var(--sayshape-bad); font-size: 14px }

.dd-plain { display: flex; flex-direction: column; gap: 10px; min-height: 420px }
.dd-bubble { display: flex; gap: 12px; align-items: flex-start }
.dd-avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--vp-c-divider); border-radius: 50%; background: var(--vp-c-bg-alt); font-weight: 700; font-size: 13px; color: var(--vp-c-text-2) }
.dd-bubble p { margin: 0; max-width: 640px; padding: 16px 18px; border-radius: 4px 16px 16px 16px; background: var(--vp-c-bg-alt); font-size: 16px; line-height: 1.6; color: var(--vp-c-text-1) }
.dd-aside { margin: 0 0 0 46px; font-size: 14px; color: var(--vp-c-text-2) }

.dd-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--vp-c-divider); border: 1.5px solid var(--vp-c-divider); border-radius: 14px; overflow: hidden }
.dd-metrics.four { grid-template-columns: repeat(2, minmax(0, 1fr)) }
.dd-metric { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--ss-card); min-width: 0 }
.dd-metric dt { font-size: 13px; color: var(--vp-c-text-2) }
.dd-metric dd { margin: 0; font: 800 20px/1.2 var(--sayshape-display); letter-spacing: -0.02em; color: var(--vp-c-text-1); overflow-wrap: anywhere }
.dd-metric.good dd { color: var(--sayshape-ok) }
.dd-metric.bad dd { color: var(--sayshape-warn) }

.dd-spec { border-top: 1px solid var(--vp-c-divider); padding-top: 4px }
.dd-spec summary { display: flex; align-items: center; gap: 6px; min-height: 44px; font-weight: 600; cursor: pointer }
.dd-spec summary span { font-weight: 400; color: var(--vp-c-text-2) }
.dd-spec pre { margin: 6px 0 0; max-height: 360px; overflow: auto; font-size: 12.5px }
.dd-spec .hot { background: var(--ss-mark-soft); border-radius: 3px }

@media (max-width: 960px) {
  .dd { grid-template-columns: minmax(0, 1fr); box-shadow: 5px 5px 0 var(--ss-shadow) }
  .dd-left { border-right: 0; border-bottom: 1.5px solid var(--vp-c-divider); padding: 20px }
  .dd-right { padding: 20px }
  .dd-stage, .dd-plain { min-height: 0 }
}
@media (max-width: 560px) {
  .dd-metrics { grid-template-columns: minmax(0, 1fr) }
  .dd-aside { margin-left: 0 }
}
@media (prefers-reduced-motion: reduce) { .dd-sheet, .dd-drop { transition: none } }
</style>
