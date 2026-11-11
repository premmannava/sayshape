<script setup lang="ts">
/**
 * One answer in the chat thread: its own engine, drawn straight on the page
 * as the model streams, and live after it finishes (its tabs, sliders and
 * buttons keep their own state). Above it, the model's thinking, live while it
 * thinks and folded into one line once it writes, on a bar that also holds
 * Save image and Copy text where they're seen. Under it: the spec the model
 * wrote, how long the answer took as one bar split by stage (waiting,
 * thinking, writing) with SayShape's own drawing time beside it, and the
 * actions the answer sent.
 * The engine is destroyed with the component, which is how "New chat" frees it.
 */
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import type { Diagnostic } from "@sayshape/index";
import type { Theme } from "../sayshape/runtime";
import { useSayShape } from "../sayshape/useSayShape";
import { onHostEvents } from "../sayshape/events";
import { highlightLine } from "../sayshape/highlight";
import { duration, isBusy, PHASE_TEXT, stages, summary, type Turn } from "../sayshape/chat";

const props = defineProps<{ turn: Turn; theme: Theme; latest: boolean }>();
const emit = defineEmits<{ retry: [] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const showSpec = ref(false);
const copied = ref("");
const actions = ref<string[]>([]);
const diagnostics = shallowRef<Diagnostic[]>([]);
const thoughtEl = ref<HTMLElement | null>(null);
const showThought = ref(false);
/** The engine's own time on this answer: parse, layout and paint of every frame until it's finished. */
const drawMs = ref(0);
let counting = true;
let pushed = 0;
let resets = -1;
let streaming = false;

const busy = computed(() => isBusy(props.turn));
/** Something to draw: a line has arrived, or the answer is done. */
const drawn = computed(() => props.turn.text.includes("\n") || !!props.turn.spec);
const phase = computed(() => PHASE_TEXT[props.turn.phase] ?? PHASE_TEXT.waiting);
/** Lines SayShape skipped (errors) or drew without a part it couldn't use (warnings), for the spec view. */
const marked = computed(() => {
  const m = new Map<number, "error" | "warning">();
  for (const d of diagnostics.value) if (m.get(d.line) !== "error") m.set(d.line, d.severity === "error" ? "error" : "warning");
  return m;
});
const problems = computed(() => diagnostics.value.length);
const specLines = computed(() => (props.turn.spec || props.turn.text).replace(/\n$/, "").split("\n"));
const specId = computed(() => `chat-spec-${props.turn.id}`);
const thoughtId = computed(() => `chat-thought-${props.turn.id}`);
/** Thinking, shown live until the first line arrives. */
const thinkingLive = computed(() => busy.value && !drawn.value && !!props.turn.thought);
const times = computed(() => stages({ ...props.turn, drawMs: drawMs.value }));
/** The stages that add up to the total, in order, for the bar; drawing overlaps writing, so it's told apart. */
const spans = computed(() => times.value.filter((s) => s.label !== "Total" && s.label !== "Drew").map((s) => ({ ...s, key: s.label.split(" ")[0]!.toLowerCase() })));
const total = computed(() => times.value.find((s) => s.label === "Total")?.ms);
const drew = computed(() => times.value.find((s) => s.label === "Drew")?.ms);
const finished = computed(() => props.turn.status === "done" || (props.turn.status === "stopped" && drawn.value));
const thoughtFor = computed(() => {
  const t = times.value.find((s) => s.label === "Thought");
  return t ? `Thought for ${duration(t.ms)}` : "Thinking";
});

// Keep the live thinking scrolled to its newest line.
watch(() => props.turn.thought, () => nextTick(() => {
  const el = thoughtEl.value;
  if (el && thinkingLive.value) el.scrollTop = el.scrollHeight;
}));

const { sayshape } = useSayShape(canvas, (l) => {
  l.setTheme(props.theme);
  const offs = [
    l.on("diagnostics", (d) => { diagnostics.value = d; }),
    l.on("render", (m) => {
      if (!counting) return;
      drawMs.value += m.parseMs + m.layoutMs + m.paintMs;
      // The first frame after the answer ends is its last to count; later ones are people using it.
      if (!isBusy(props.turn)) counting = false;
    }),
    // Nothing is listening for emit: actions on this page. Say what an app would receive, as the landing page does.
    onHostEvents(l, (e) => { if (e.kind === "emit") actions.value = [e.text, ...actions.value].slice(0, 2); }),
  ];
  sync();
  return () => offs.forEach((off) => off());
// The elements the model proxy teaches for chat answers: the core set, drawings (scene) and the world map.
}, { followSiteTheme: () => false, padding: 6, scene: true, map: true });

/** Bring the engine up to date with the turn: a new attempt, new lines, the end. */
function sync() {
  const l = sayshape.value;
  if (!l) return;
  const t = props.turn;
  if (t.resets !== resets) {
    resets = t.resets;
    pushed = 0;
    drawMs.value = 0;
    counting = true;
    l.beginStream();
    streaming = true;
  }
  if (t.text.length > pushed) {
    l.push(t.text.slice(pushed));
    pushed = t.text.length;
  }
  if (!isBusy(t) && streaming) {
    l.endStream();
    streaming = false;
    // The worker's final spec, when it differs from what streamed (a repair that came out worse is dropped).
    if (t.spec && l.spec !== t.spec) l.setSpec(t.spec);
    diagnostics.value = l.diagnostics;
  }
}
watch(() => [props.turn.text, props.turn.resets, props.turn.status], sync, { flush: "sync" });
watch(() => props.theme, (th) => sayshape.value?.setTheme(th));

const problemAt = (line: number) => diagnostics.value.filter((d) => d.line === line).map((d) => d.message).join("\n") || undefined;

const fileName = () => (props.turn.question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer") + ".png";

/** The answer as a PNG, drawn again at twice the resolution (SayShape.picture), saved as a download. */
async function saveImage() {
  const l = sayshape.value;
  if (!l) return;
  try {
    const pic = await l.picture();
    const blob = await new Promise<Blob | null>((r) => pic.toBlob(r, "image/png"));
    if (!blob) throw new Error("no image");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    copied.value = "Image saved";
  } catch {
    copied.value = "Couldn't save the image";
  }
  setTimeout(() => { copied.value = ""; }, 2000);
}

async function copy(what: "text" | "spec") {
  const l = sayshape.value;
  if (!l) return;
  const value = what === "text" ? l.copyText() : props.turn.spec;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = what === "text" ? "Text copied" : "Spec copied";
  } catch {
    copied.value = "Couldn't copy";
  }
  setTimeout(() => { copied.value = ""; }, 2000);
}
</script>

<template>
  <div class="ca" :class="{ busy, failed: turn.status === 'failed' }">
    <!-- The model's thinking: free text, shown as text, never drawn. Live while it thinks, then one line to open it. -->
    <div v-if="thinkingLive" class="ca-think live">
      <p class="ca-think-label" role="status"><span class="ca-dot" aria-hidden="true"></span>Thinking</p>
      <div ref="thoughtEl" class="ca-think-text" aria-label="The model's thinking so far">{{ turn.thought }}</div>
    </div>
    <!-- Once it draws: the thinking folded to one line, and what can be done with the answer. The buttons hold their place while it's still writing, so nothing moves when it ends. -->
    <div v-else-if="drawn" class="ca-think">
      <div class="ca-bar">
        <button v-if="turn.thought" type="button" class="ca-link ca-think-toggle" :aria-expanded="showThought" :aria-controls="thoughtId" @click="showThought = !showThought">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" :class="{ open: showThought }"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {{ thoughtFor }}
        </button>
        <span class="ca-copied" role="status">{{ copied }}</span>
        <div class="ca-acts">
          <button type="button" class="ca-act" :disabled="!sayshape || !finished" @click="saveImage">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            Save image
          </button>
          <button type="button" class="ca-act" :disabled="!sayshape || !finished" @click="copy('text')">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            Copy text
          </button>
        </div>
      </div>
      <div v-if="showThought && turn.thought" :id="thoughtId" class="ca-think-text full" tabindex="0" aria-label="The model's thinking">{{ turn.thought }}</div>
    </div>

    <div v-show="drawn" class="sayshape-canvas-wrap ca-canvas">
      <canvas ref="canvas" :aria-label="`Answer to “${turn.question}”, drawn by SayShape`"></canvas>
    </div>

    <p v-if="busy && !thinkingLive" class="ca-phase" role="status">
      <span class="ca-dot" aria-hidden="true"></span>{{ phase }}
    </p>

    <div v-if="turn.failure" class="ca-failure" role="alert">
      <p>{{ turn.failure.message }}</p>
      <button v-if="turn.failure.retry && latest" type="button" class="sayshape-btn quiet small" @click="emit('retry')">Try again</button>
    </div>
    <p v-else-if="turn.status === 'stopped'" class="ca-note">Stopped. Ask again, or ask something else.</p>

    <!-- How long it took: one number, then a bar split by where the time went. -->
    <div v-if="turn.status === 'done' && total !== undefined" class="ca-time">
      <p class="ca-time-head">
        <strong>Answered in {{ duration(total) }}</strong>
        <span v-if="drew !== undefined">SayShape drew it in {{ duration(drew) }}</span>
      </p>
      <div class="ca-time-bar" aria-hidden="true">
        <span v-for="s in spans" :key="s.label" :class="s.key" :style="{ flexGrow: Math.max(s.ms, 1) }"></span>
      </div>
      <ul class="ca-time-key">
        <li v-for="s in spans" :key="s.label"><i :class="s.key" aria-hidden="true"></i>{{ s.label }} <b>{{ duration(s.ms) }}</b></li>
      </ul>
    </div>
    <div v-if="finished" class="ca-foot">
      <button type="button" class="ca-link" :aria-expanded="showSpec" :aria-controls="specId" @click="showSpec = !showSpec">
        {{ showSpec ? "Hide spec" : "Spec" }}<span v-if="turn.spec"> · {{ specLines.length }} lines</span>
      </button>
      <button v-if="problems" type="button" class="ca-link ca-warn" :aria-controls="specId" @click="showSpec = true">
        {{ problems }} {{ problems === 1 ? "problem" : "problems" }} SayShape worked around
      </button>
      <span v-if="turn.status === 'done'" class="ca-meta">{{ summary(turn) }}</span>
    </div>
    <p v-for="(a, i) in actions" :key="i + a" class="ca-action">
      <span class="ca-action-label">Your app would receive</span> <code>{{ a }}</code>
    </p>

    <div v-if="showSpec" :id="specId" class="ca-spec">
      <div class="ca-spec-head">
        <span>What the model wrote</span>
        <button type="button" class="ca-link" @click="copy('spec')">Copy spec</button>
      </div>
      <pre class="spec-view numbered" tabindex="0" aria-label="The SayShape spec the model wrote"><span
        v-for="(line, i) in specLines" :key="i" class="line" :class="marked.get(i + 1)" :title="problemAt(i + 1)" v-html="highlightLine(line)"></span></pre>
      <ul v-if="problems" class="ca-problems">
        <li v-for="(d, i) in diagnostics" :key="i" :class="d.severity"><span class="ln">Line {{ d.line }}</span> {{ d.message }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.ca { display: flex; flex-direction: column; gap: 10px; min-width: 0 }
/* The engine draws on the page's own paper: no frame, no stage. A little padding keeps card shadows whole; the margin lines its content up with the thread. */
.ca-canvas { width: calc(100% + 12px); margin: 0 -6px }
.ca-canvas canvas { display: block }
.ca-canvas canvas:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; border-radius: 8px }

.ca-think { display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.ca-think-label { display: flex; align-items: center; gap: 8px; margin: 0; font: 500 12px var(--vp-font-family-mono); letter-spacing: 0.04em; color: var(--vp-c-text-2) }
.ca-think-text {
  max-height: 7.5em;
  overflow: auto;
  padding: 2px 0 2px 14px;
  border-left: 2px solid var(--vp-c-divider);
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Live, the oldest lines fade out at the top as new ones arrive. */
.ca-think.live .ca-think-text { mask-image: linear-gradient(to bottom, transparent, #000 2.2em); scrollbar-width: none }
.ca-think-text.full { max-height: 320px }
.ca-think-text:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; border-radius: 2px }
.ca-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; min-height: 34px }
.ca-acts { display: flex; gap: 8px; margin-left: auto }
/* Save image and Copy text: real buttons, at the top of the answer where they're seen. */
.ca-act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 13px 0 10px;
  border: 1.5px solid var(--vp-c-border);
  border-radius: 999px;
  background: var(--ss-card);
  font: 600 13px var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ca-act:hover:not([disabled]) { border-color: var(--vp-c-text-1); box-shadow: var(--ss-lift-sm) }
.ca-act:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px }
.ca-act[disabled] { color: var(--vp-c-text-3); border-color: var(--vp-c-divider); background: none; cursor: default }
.ca-think-toggle { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; color: var(--vp-c-text-2); text-decoration: none }
.ca-think-toggle svg { transition: transform 0.15s }
.ca-think-toggle svg.open { transform: rotate(90deg) }

.ca-phase { display: flex; align-items: center; gap: 8px; margin: 0; font: 500 12px var(--vp-font-family-mono); letter-spacing: 0.04em; color: var(--vp-c-text-2) }
.ca-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--chat-fill); animation: ca-pulse 1.2s ease-in-out infinite }
@keyframes ca-pulse { 50% { opacity: 0.25 } }

.ca-failure { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 14px; border-left: 3px solid var(--sayshape-bad); background: var(--vp-c-bg-alt); border-radius: 0 10px 10px 0 }
.ca-failure p { margin: 0; flex: 1 1 260px; font-size: 14.5px; line-height: 1.5; color: var(--vp-c-text-1) }
.ca-note { margin: 0; font-size: 14px; color: var(--vp-c-text-2) }

.ca-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; font-size: 13px; color: var(--vp-c-text-2) }
.ca-link {
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  font: 600 13px var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  text-decoration: underline;
  text-decoration-color: var(--vp-c-border);
  text-underline-offset: 4px;
  cursor: pointer;
}
.ca-link:hover { text-decoration-color: currentColor }
.ca-link:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 3px; border-radius: 4px }
.ca-link[disabled] { color: var(--vp-c-text-3); cursor: default }
.ca-link.ca-warn { color: var(--sayshape-warn); text-decoration-color: currentColor }
.ca-meta { font: 12px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.ca-time { display: grid; gap: 7px; max-width: 560px; margin-top: 2px }
.ca-time-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; margin: 0; font-size: 13px; color: var(--vp-c-text-2) }
.ca-time-head strong { font: 600 14.5px var(--vp-font-family-base); color: var(--vp-c-text-1) }
/* One bar for the whole wait, split by stage: the model's thinking is usually most of it. */
.ca-time-bar { display: flex; gap: 2px; height: 6px }
.ca-time-bar span { flex: 0 1 0; min-width: 3px; border-radius: 3px }
.ca-time-key { display: flex; flex-wrap: wrap; gap: 2px 16px; margin: 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--vp-c-text-2) }
.ca-time-key li { display: inline-flex; align-items: center; gap: 6px }
.ca-time-key i { width: 8px; height: 8px; border-radius: 2px }
.ca-time-key b { font-weight: 600; color: var(--vp-c-text-1) }
.ca-time .waited { background: var(--vp-c-border) }
.ca-time .thought { background: var(--vp-c-text-3) }
.ca-time .wrote { background: var(--chat-fill) }
.ca-copied { font-weight: 600; color: var(--vp-c-text-1) }
.ca-copied:empty { display: none }
.ca-action { margin: 0; font-size: 12.5px; color: var(--vp-c-text-2); overflow-wrap: anywhere }
.ca-action-label::after { content: " →" }
.ca-action code { font: 12px var(--vp-font-family-mono); color: var(--vp-c-text-1); background: none; padding: 0 }

.ca-spec { border: 1px solid var(--vp-c-divider); border-radius: 12px; background: var(--sayshape-code-bg); overflow: hidden }
.ca-spec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 14px; border-bottom: 1px solid var(--vp-c-divider) }
.ca-spec-head span { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--vp-c-text-2) }
.ca-spec pre { padding: 10px 0; max-height: 420px; overflow: auto; font-size: 12.5px }
.ca-spec pre:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: -2px }
.ca-spec .line.error { background: var(--ss-coral-soft); box-shadow: inset 3px 0 0 var(--sayshape-bad) }
.ca-spec .line.warning { box-shadow: inset 3px 0 0 var(--sayshape-warn) }
.ca-problems { margin: 0; padding: 8px 14px 10px; list-style: none; border-top: 1px solid var(--vp-c-divider); font-size: 13px; line-height: 1.5 }
.ca-problems li { margin: 2px 0 }
.ca-problems .ln { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); margin-right: 6px }
.ca-problems .error { color: var(--sayshape-bad) }
.ca-problems .warning { color: var(--vp-c-text-1) }
</style>
