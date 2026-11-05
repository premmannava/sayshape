<script setup lang="ts">
/**
 * The landing page's demo: pick a sample spreadsheet, ask one of its
 * questions, and see the answer drawn by SayShape or written out as a plain
 * chatbot would.
 *
 * Nothing is generated yet: each answer is a saved spec, replayed the way a
 * model's response arrives, and drawn by the real engine. The spreadsheet's
 * rows are handed to the engine as host data, the way a company's chatbot
 * would, so the spec only names them; the model would only ever see the
 * column names and the sample rows shown here. Questions typed by visitors
 * and files of their own come later, on the chat page.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { demo, SAMPLE_ROWS, wordCount } from "../../../examples/data-demo";
import { highlightLine } from "../sayshape/highlight";
import { useSayShape } from "../sayshape/useSayShape";
import { prefersReducedMotion } from "../sayshape/runtime";
import type { SayShape } from "../sayshape/runtime";

const ds = ref(0);
const q = ref(0);
const mode = ref<"with" | "without">("with");
const shown = ref("");
const writing = ref(false);
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
let signal = { cancelled: false };
let timer: ReturnType<typeof setTimeout> | null = null;

const entry = computed(() => demo[ds.value]!);
const dataset = computed(() => entry.value.dataset);
const question = computed(() => entry.value.questions[q.value]!);
const rest = computed(() => dataset.value.rows.length - SAMPLE_ROWS);
const sample = computed(() => dataset.value.rows.slice(0, SAMPLE_ROWS).map((r) => dataset.value.columns.map((c) => String(r[c]))));
const specLines = computed(() => question.value.spec.split("\n").length);
const group = (n: number) => n.toLocaleString("en-US");

const lines = computed(() => {
  const all = shown.value ? shown.value.split("\n") : [];
  return all.map((l, i) => ({ html: highlightLine(l), hot: writing.value && i === all.length - 1 }));
});

const metrics = computed(() =>
  mode.value === "with"
    ? [
        { label: "Sent to the model", value: `${SAMPLE_ROWS} sample rows`, tone: "good" },
        { label: "Stayed in your browser", value: `${group(rest.value)} rows`, tone: "good" },
        { label: "The AI wrote", value: `${specLines.value} lines`, tone: "" },
      ]
    : [
        { label: "Sent to the model", value: `All ${group(dataset.value.rows.length)} rows`, tone: "bad" },
        { label: "Stayed in your browser", value: "None", tone: "bad" },
        { label: "The AI wrote", value: `${wordCount(question.value.plain)} words`, tone: "" },
      ],
);

const { sayshape, failed } = useSayShape(canvas, () => { play(!prefersReducedMotion()); }, { lazy: root });

function stop() {
  signal.cancelled = true;
  if (timer) { clearTimeout(timer); timer = null; }
}

/**
 * Stream the answer in a few characters at a time, like a model's tokens,
 * with the spreadsheet already in the engine's state as host data.
 */
function play(animate = true) {
  const l: SayShape | null = sayshape.value;
  if (!l) return;
  stop();
  const mine = (signal = { cancelled: false });
  const spec = question.value.spec;
  l.beginStream();
  // Host data: the store copies the rows in. The spec only names them.
  l.state.set(dataset.value.state, dataset.value.rows as unknown as Parameters<SayShape["state"]["set"]>[1]);
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

function chooseDataset(i: number) {
  if (i === ds.value) return;
  ds.value = i;
  q.value = 0;
  play(!prefersReducedMotion());
}
function chooseQuestion(i: number) {
  q.value = i;
  play(!prefersReducedMotion());
}

onBeforeUnmount(stop);
</script>

<template>
  <section id="demo" ref="root" class="dd" aria-label="Try it with a sample spreadsheet">
    <div class="dd-left">
      <div class="dd-step">
        <p class="dd-eyebrow">1 · Pick a spreadsheet</p>
        <div class="dd-sheets" role="group" aria-label="Sample spreadsheets">
          <button v-for="(e, i) in demo" :key="e.dataset.id" type="button" class="dd-sheet" :aria-pressed="i === ds" @click="chooseDataset(i)">
            <span class="dd-sheet-name">{{ e.dataset.name }} <span class="dd-tag">sample</span></span>
            <span class="dd-sheet-meta">{{ group(e.dataset.rows.length) }} rows · {{ e.dataset.columns.length }} columns</span>
          </button>
        </div>
        <div class="dd-own">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
          <span><strong>Your own file</strong><span>CSV or Excel. Coming soon.</span></span>
        </div>
      </div>

      <div class="dd-step">
        <p class="dd-note">The model only sees the column names and these rows:</p>
        <div class="dd-preview" tabindex="0" role="region" :aria-label="`Sample rows from ${dataset.name}`">
          <table>
            <thead><tr><th v-for="c in dataset.columns" :key="c" scope="col">{{ c }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in sample" :key="i"><td v-for="(cell, j) in r" :key="j">{{ cell }}</td></tr>
              <tr class="dd-rest"><td :colspan="dataset.columns.length">+ {{ group(rest) }} more rows that stay in your browser</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="dd-step">
        <p class="dd-eyebrow">2 · Ask a question</p>
        <div class="dd-asks" role="group" aria-label="Questions">
          <button v-for="(x, i) in entry.questions" :key="x.text" type="button" class="dd-ask" :aria-pressed="i === q" @click="chooseQuestion(i)">{{ x.text }}</button>
        </div>
      </div>
    </div>

    <div class="dd-right">
      <div class="dd-head">
        <p class="dd-eyebrow">3 · See the answer</p>
        <div class="dd-seg" role="group" aria-label="Answer">
          <button type="button" :aria-pressed="mode === 'with'" @click="mode = 'with'">With SayShape</button>
          <button type="button" :aria-pressed="mode === 'without'" @click="mode = 'without'">Without</button>
        </div>
      </div>

      <p class="dd-question">“{{ question.text }}”</p>

      <div v-show="mode === 'with'" class="dd-stage sayshape-stage">
        <p v-if="failed" class="dd-failed">The demo couldn't start: {{ failed }}</p>
        <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`The answer to “${question.text}”, drawn by SayShape. The lines the AI wrote are below.`"></canvas></div>
      </div>

      <div v-if="mode === 'without'" class="dd-plain">
        <div class="dd-bubble">
          <span class="dd-avatar" aria-hidden="true">AI</span>
          <p>{{ question.plain }}</p>
        </div>
        <p class="dd-aside">A plain chatbot needs every row to answer, and you get a paragraph to read.</p>
      </div>

      <dl class="dd-metrics" aria-live="polite">
        <div v-for="m in metrics" :key="m.label" :class="['dd-metric', m.tone]">
          <dt>{{ m.label }}</dt>
          <dd>{{ m.value }}</dd>
        </div>
      </dl>

      <details v-show="mode === 'with'" class="dd-spec">
        <summary>What the AI wrote <span>({{ specLines }} lines{{ writing ? ", still writing" : "" }})</span></summary>
        <pre class="spec-view numbered" tabindex="0" :aria-label="`The SayShape answer to “${question.text}”`"><code><span v-for="(l, i) in lines" :key="i" class="line" :class="{ hot: l.hot }" v-html="l.html"></span></code></pre>
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

.dd-sheets { display: grid; gap: 8px }
.dd-sheet { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 56px; padding: 10px 14px; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: var(--ss-card); color: var(--vp-c-text-1); text-align: left; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s }
.dd-sheet:hover { border-color: var(--ss-rule) }
.dd-sheet[aria-pressed="true"] { border-color: var(--ss-rule); background: var(--ss-mark-soft); box-shadow: 3px 3px 0 var(--ss-shadow) }
.dd-sheet-name { font-weight: 600; font-size: 16px }
.dd-tag { margin-left: 6px; font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vp-c-text-2) }
.dd-sheet-meta { font-size: 13px; color: var(--vp-c-text-2) }
.dd-own { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 14px; border: 1.5px dashed var(--vp-c-text-3); border-radius: 12px; color: var(--vp-c-text-2) }
.dd-own svg { flex: none }
.dd-own > span { display: flex; flex-direction: column; font-size: 13px }
.dd-own strong { font-size: 15px; color: var(--vp-c-text-1) }

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

.dd-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px }
.dd-seg { display: inline-flex; gap: 4px; padding: 4px; border: 1.5px solid var(--ss-rule); border-radius: 999px; background: var(--ss-card) }
.dd-seg button { min-height: 40px; padding: 0 16px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1); cursor: pointer }
.dd-seg button[aria-pressed="true"] { background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.dd-question { margin: 0; font: 600 clamp(20px, 2vw, 26px)/1.25 var(--sayshape-display); letter-spacing: -0.02em; color: var(--vp-c-text-1) }

.dd-stage { min-height: 420px; border: 1.5px solid var(--vp-c-divider); border-radius: 16px }
.dd-failed { margin: 0; padding: 16px; color: var(--sayshape-bad); font-size: 14px }

.dd-plain { display: flex; flex-direction: column; gap: 10px; min-height: 420px }
.dd-bubble { display: flex; gap: 12px; align-items: flex-start }
.dd-avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border: 1px solid var(--vp-c-divider); border-radius: 50%; background: var(--vp-c-bg-alt); font-weight: 700; font-size: 13px; color: var(--vp-c-text-2) }
.dd-bubble p { margin: 0; max-width: 640px; padding: 16px 18px; border-radius: 4px 16px 16px 16px; background: var(--vp-c-bg-alt); font-size: 16px; line-height: 1.6; color: var(--vp-c-text-1) }
.dd-aside { margin: 0 0 0 46px; font-size: 14px; color: var(--vp-c-text-2) }

.dd-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--vp-c-divider); border: 1.5px solid var(--vp-c-divider); border-radius: 14px; overflow: hidden }
.dd-metric { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--ss-card); min-width: 0 }
.dd-metric dt { font-size: 13px; color: var(--vp-c-text-2) }
.dd-metric dd { margin: 0; font: 800 22px/1.2 var(--sayshape-display); letter-spacing: -0.02em; color: var(--vp-c-text-1) }
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
@media (prefers-reduced-motion: reduce) { .dd-sheet { transition: none } }
</style>
