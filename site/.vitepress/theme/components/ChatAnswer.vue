<script setup lang="ts">
/**
 * One answer in the chat thread: its own engine, drawn straight on the page
 * as the model streams, and live after it finishes (its tabs, sliders and
 * buttons keep their own state). Under it, a quiet footer: the spec the model
 * wrote, Copy text, the model and its time, and the actions the answer sent.
 * The engine is destroyed with the component, which is how "New chat" frees it.
 */
import { computed, ref, shallowRef, watch } from "vue";
import type { Diagnostic } from "@sayshape/index";
import type { Theme } from "../sayshape/runtime";
import { useSayShape } from "../sayshape/useSayShape";
import { onHostEvents } from "../sayshape/events";
import { highlightLine } from "../sayshape/highlight";
import { isBusy, PHASE_TEXT, summary, type Turn } from "../sayshape/chat";

const props = defineProps<{ turn: Turn; theme: Theme; latest: boolean }>();
const emit = defineEmits<{ retry: [] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const showSpec = ref(false);
const copied = ref("");
const actions = ref<string[]>([]);
const diagnostics = shallowRef<Diagnostic[]>([]);
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

const { sayshape } = useSayShape(canvas, (l) => {
  l.setTheme(props.theme);
  const offs = [
    l.on("diagnostics", (d) => { diagnostics.value = d; }),
    // Nothing is listening for emit: actions on this page. Say what an app would receive, as the landing page does.
    onHostEvents(l, (e) => { if (e.kind === "emit") actions.value = [e.text, ...actions.value].slice(0, 2); }),
  ];
  sync();
  return () => offs.forEach((off) => off());
}, { followSiteTheme: () => false, padding: 6 });

/** Bring the engine up to date with the turn: a new attempt, new lines, the end. */
function sync() {
  const l = sayshape.value;
  if (!l) return;
  const t = props.turn;
  if (t.resets !== resets) {
    resets = t.resets;
    pushed = 0;
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
    <div v-if="busy && !drawn" class="ca-wait" aria-hidden="true">
      <span class="ca-ghost" style="width: 46%"></span>
      <span class="ca-ghost" style="width: 78%"></span>
      <span class="ca-ghost short" style="width: 30%"></span>
    </div>
    <div v-show="drawn" class="sayshape-canvas-wrap ca-canvas">
      <canvas ref="canvas" :aria-label="`Answer to “${turn.question}”, drawn by SayShape`"></canvas>
    </div>

    <p v-if="busy" class="ca-phase" role="status">
      <span class="ca-dot" aria-hidden="true"></span>{{ phase }}
    </p>

    <div v-if="turn.failure" class="ca-failure" role="alert">
      <p>{{ turn.failure.message }}</p>
      <button v-if="turn.failure.retry && latest" type="button" class="sayshape-btn quiet small" @click="emit('retry')">Try again</button>
    </div>
    <p v-else-if="turn.status === 'stopped'" class="ca-note">Stopped. Ask again, or ask something else.</p>

    <div v-if="turn.status === 'done' || (turn.status === 'stopped' && drawn)" class="ca-foot">
      <button type="button" class="ca-link" :aria-expanded="showSpec" :aria-controls="specId" @click="showSpec = !showSpec">
        {{ showSpec ? "Hide spec" : "Spec" }}<span v-if="turn.spec"> · {{ specLines.length }} lines</span>
      </button>
      <button type="button" class="ca-link" :disabled="!sayshape" @click="copy('text')">Copy text</button>
      <button v-if="problems" type="button" class="ca-link ca-warn" :aria-controls="specId" @click="showSpec = true">
        {{ problems }} {{ problems === 1 ? "problem" : "problems" }} SayShape worked around
      </button>
      <span class="ca-meta">{{ summary(turn) }}</span>
      <span class="ca-copied" role="status">{{ copied }}</span>
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

.ca-wait { display: grid; gap: 10px; padding: 6px 0 2px }
.ca-ghost {
  display: block;
  height: 14px;
  border-radius: 7px;
  background: linear-gradient(90deg, var(--vp-c-divider) 0%, var(--vp-c-bg-alt) 50%, var(--vp-c-divider) 100%);
  background-size: 200% 100%;
  animation: ca-sweep 1.4s ease-in-out infinite;
}
.ca-ghost.short { height: 40px; border-radius: 12px }
@keyframes ca-sweep { from { background-position: 100% 0 } to { background-position: -100% 0 } }

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
