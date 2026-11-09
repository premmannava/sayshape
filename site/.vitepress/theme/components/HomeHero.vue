<script setup lang="ts">
/**
 * The landing page's hero demo. A saved answer plays once: the question types
 * in, the spec streams line by line into the real engine (which draws each
 * line as it lands), then a cursor drags two sliders through the engine's own
 * pointer handling. Everything that changes after that is the screen working
 * on its own: no model runs on this site, and nothing is sent anywhere.
 *
 * Pause stops the clock wherever it is; Replay starts over; touching the
 * screen yourself ends the recording and leaves the finished screen to you.
 * With reduced motion the finished screen is shown at once.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { heroAsk, heroDrags, heroSpec } from "../../../examples/home";
import { useSayShape } from "../sayshape/useSayShape";
import { prefersReducedMotion, type SayShape } from "../sayshape/runtime";
import { highlightLine } from "../sayshape/highlight";

type Phase = "asking" | "writing" | "using" | "done";

const LINES = heroSpec.split("\n");
/** The state the sliders write; a change to any of them counts as one adjustment. */
const BUDGET = ["search", "social", "creators"];
const phase = ref<Phase>("asking");
const typed = ref("");
const shown = ref(0);
const paused = ref(false);
const changes = ref(0);
const specOpen = ref(false);
/** What the screen last sent the page, shown where the proof line is. */
const sent = ref("");
const cursor = ref({ x: 0, y: 0, on: false, pressing: false });

const root = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const status = computed(() =>
  phase.value === "asking" ? "Reading the question…"
  : phase.value === "writing" ? `Writing the screen · ${shown.value} of ${LINES.length} lines`
  : `Done in ${LINES.length} lines. The rest happens on the screen.`);
const step = computed(() => (phase.value === "asking" ? 0 : phase.value === "writing" ? 1 : 2));
const lines = computed(() => LINES.map((line, i) => ({ html: highlightLine(line), on: i < shown.value })));
const running = computed(() => phase.value !== "done" && !paused.value);
const proof = computed(() =>
  sent.value ? sent.value
  : changes.value === 0 ? "Try the sliders: the screen answers, not the AI."
  : `${changes.value} ${changes.value === 1 ? "change" : "changes"}, updated on the spot · 0 new AI messages`);

let run = { cancelled: false };
let lastChange = 0;

/** Wait, counting only the time the demo isn't paused. Resolves false if this run was cancelled. */
function wait(ms: number, mine: { cancelled: boolean }): Promise<boolean> {
  return new Promise((done) => {
    let left = ms;
    let last = performance.now();
    const tick = () => {
      if (mine.cancelled) return done(false);
      const now = performance.now();
      if (!paused.value) left -= now - last;
      last = now;
      if (left <= 0) return done(true);
      setTimeout(tick, Math.min(40, left));
    };
    tick();
  });
}

/** A slider's track, in stage coordinates, from the engine's own hit regions. */
function track(ui: SayShape, bind: string) {
  const hit = ui.hitRegions.find((h) => h.box.node.type === "slider" && h.box.node.props.bind === bind);
  if (!hit || !canvas.value || !stage.value) return null;
  const c = canvas.value.getBoundingClientRect();
  const s = stage.value.getBoundingClientRect();
  const min = Number(hit.box.node.props.min ?? 0), max = Number(hit.box.node.props.max ?? 100);
  // The handle travels between the track's ends, inset by its radius (see slider in src/components/input.ts).
  const left = c.left - s.left + hit.box.x + 9, width = hit.box.w - 18;
  return { xOf: (v: number) => left + ((v - min) / (max - min)) * width, y: c.top - s.top + hit.box.y + hit.box.h / 2 };
}

function pointer(type: string, x: number, y: number) {
  const s = stage.value?.getBoundingClientRect();
  if (!s || !canvas.value) return;
  canvas.value.dispatchEvent(new PointerEvent(type, { clientX: s.left + x, clientY: s.top + y, pointerId: 1, bubbles: true, isPrimary: true, pointerType: "mouse", buttons: type === "pointerup" ? 0 : 1 }));
}

async function play() {
  const ui = sayshape.value;
  if (!ui) return;
  run.cancelled = true;
  const mine = (run = { cancelled: false });
  const still = prefersReducedMotion();
  paused.value = false;
  changes.value = 0;
  sent.value = "";
  cursor.value = { ...cursor.value, on: false, pressing: false };

  // 1 · The person asks.
  phase.value = "asking";
  shown.value = 0;
  ui.setSpec("", { resetState: true });
  if (still) typed.value = heroAsk;
  else {
    for (let n = 0; n <= heroAsk.length; n += 2) {
      typed.value = heroAsk.slice(0, n);
      if (!(await wait(16, mine))) return;
    }
    typed.value = heroAsk;
    if (!(await wait(250, mine))) return;
  }

  // 2 · The answer streams in; the engine draws each line as it lands.
  phase.value = "writing";
  ui.beginStream();
  if (still) {
    ui.push(heroSpec);
    shown.value = LINES.length;
  } else {
    for (const [i, line] of LINES.entries()) {
      ui.push(line + "\n");
      shown.value = i + 1;
      if (!(await wait(55, mine))) return;
    }
  }
  ui.endStream();
  phase.value = "using";
  if (still) { phase.value = "done"; return; }

  // 3 · Someone uses it: drag two sliders through the engine's pointer path.
  if (!(await wait(700, mine))) return;
  for (const d of heroDrags) {
    const t = track(ui, d.bind);
    if (!t) break;
    const from = Number(ui.state.get(d.bind));
    const x0 = t.xOf(from), x1 = t.xOf(d.to);
    cursor.value = { x: x0, y: t.y, on: true, pressing: false };
    if (!(await wait(750, mine))) return;
    cursor.value = { ...cursor.value, pressing: true };
    pointer("pointermove", x0, t.y);
    pointer("pointerdown", x0, t.y);
    const steps = 18;
    for (let k = 1; k <= steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps;
      pointer("pointermove", x, t.y);
      cursor.value = { ...cursor.value, x };
      if (!(await wait(45, mine))) { pointer("pointerup", x, t.y); return; }
    }
    pointer("pointerup", x1, t.y);
    cursor.value = { ...cursor.value, pressing: false };
    if (!(await wait(1100, mine))) return;
  }
  cursor.value = { ...cursor.value, on: false };
  phase.value = "done";
}

/** Someone touched the screen themselves: stop the recording and hand them the finished screen. */
function takeOver(e: Event) {
  if (!e.isTrusted || phase.value === "done") return;
  const ui = sayshape.value;
  run.cancelled = true;
  cursor.value = { ...cursor.value, on: false, pressing: false };
  typed.value = heroAsk;
  if (ui && shown.value < LINES.length) {
    ui.setSpec(heroSpec);
    shown.value = LINES.length;
  }
  paused.value = false;
  phase.value = "done";
}

function togglePause() {
  if (phase.value === "done") { void play(); return; }
  paused.value = !paused.value;
}

const { sayshape } = useSayShape(canvas, (ui) => {
  const off = ui.on("change", ({ key }) => {
    if ((phase.value !== "using" && phase.value !== "done") || !BUDGET.includes(key)) return;
    const now = performance.now();
    if (now - lastChange > 500) changes.value++;
    lastChange = now;
    sent.value = "";
  });
  // "Share the plan" can only send a named action; on a real site the app would share it.
  const offAction = ui.on("action", ({ name }) => {
    sent.value = `The screen sent “${name}” to your app, which decides what sharing does. Nothing leaves this page.`;
  });
  const c = canvas.value!;
  c.addEventListener("pointerdown", takeOver);
  c.addEventListener("keydown", takeOver);
  void play();
  return () => { off(); offAction(); c.removeEventListener("pointerdown", takeOver); c.removeEventListener("keydown", takeOver); };
}, { lazy: root, padding: "auto" });

onBeforeUnmount(() => { run.cancelled = true; });
</script>

<template>
  <div ref="root" class="hd">
    <div class="hd-bar">
      <span class="hd-who"><span class="hd-avatar" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z" /></svg></span>Your AI assistant</span>
      <span class="hd-label">Recorded demo · a saved answer, replayed</span>
      <span class="hd-controls">
        <button type="button" class="hd-btn" :aria-label="running ? 'Pause the demo' : phase === 'done' ? 'Play the demo again' : 'Resume the demo'" @click="togglePause">
          <svg v-if="running" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          <span class="hd-btn-text">{{ running ? "Pause" : phase === "done" ? "Play" : "Resume" }}</span>
        </button>
        <button type="button" class="hd-btn" aria-label="Replay the demo" @click="play"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4h4" /></svg><span class="hd-btn-text">Replay</span></button>
      </span>
    </div>

    <div class="hd-body">
      <div class="hd-rail">
        <div class="hd-rail-in">
        <p class="hd-ask"><span>{{ typed }}<i v-if="phase === 'asking'" class="hd-caret" aria-hidden="true"></i></span></p>
        <p class="hd-status" aria-live="polite"><span class="hd-dot" :class="phase" aria-hidden="true"></span>{{ status }}</p>
        <button type="button" class="hd-spec-toggle" :aria-expanded="specOpen" aria-controls="hero-spec" @click="specOpen = !specOpen">{{ specOpen ? "Hide the spec" : `View the spec · ${LINES.length} lines` }}</button>
        <div id="hero-spec" class="hd-spec" :class="{ open: specOpen, settled: phase === 'using' || phase === 'done' }" role="region" aria-label="The SayShape spec the AI wrote">
          <pre tabindex="0"><code><span v-for="(l, i) in lines" :key="i" class="hd-line" :class="{ on: l.on }" v-html="l.html + '\n'"></span></code></pre>
        </div>
        <button v-if="phase === 'using' || phase === 'done'" type="button" class="hd-spec-more" :aria-expanded="specOpen" aria-controls="hero-spec" @click="specOpen = !specOpen">{{ specOpen ? "Show less" : `Show all ${LINES.length} lines` }}</button>
        <p class="hd-hint">The AI wrote these lines; SayShape drew the screen from them and runs it on its own.</p>
        </div>
      </div>

      <div ref="stage" class="hd-stage">
        <div class="hd-screen" :class="{ shown: phase !== 'asking' }">
          <div class="sayshape-canvas-wrap"><canvas ref="canvas" aria-label="The AI's answer: an app launch budget planner, drawn by SayShape"></canvas></div>
        </div>
        <span class="hd-cursor" :class="{ on: cursor.on, pressing: cursor.pressing }" :style="{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }" aria-hidden="true">
          <svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l17 11-7.5 1.6L15 22.5l-3.4 1.5-3.6-8.1L2 21z" fill="#171B32" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round" /></svg>
        </span>
        <p class="hd-proof" :class="{ on: phase === 'using' || phase === 'done' }" aria-live="polite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{{ proof }}
        </p>
      </div>
    </div>

    <ol class="hd-flow" aria-label="How it works">
      <li v-for="(f, i) in [['Ask', 'A person asks in plain words.'], ['Generate', 'Their AI writes a short SayShape spec.'], ['Interact', 'SayShape draws a screen that works.']]" :key="f[0]" :class="{ on: step === i }" :aria-current="step === i ? 'step' : undefined">
        <span class="hd-n" aria-hidden="true">{{ i + 1 }}</span><strong>{{ f[0] }}</strong><span class="hd-flow-text">{{ f[1] }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.hd { border: 1px solid var(--vp-c-divider); border-radius: 28px; background: var(--ss-card); box-shadow: var(--ss-lift); overflow: hidden }
.hd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px 10px 18px; border-bottom: 1px solid var(--vp-c-divider) }
.hd-who { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px }
.hd-avatar { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.hd-label { padding: 4px 10px; border-radius: 999px; background: var(--vp-c-bg-alt); font-size: 12px; color: var(--vp-c-text-2) }
.hd-controls { display: inline-flex; gap: 6px; margin-left: auto }
.hd-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--vp-c-divider); border-radius: 12px; background: var(--ss-card); color: var(--vp-c-text-1); font: 500 13px var(--vp-font-family-base); cursor: pointer }
.hd-btn:hover { border-color: var(--vp-c-text-3) }
.hd-btn:focus-visible, .hd-spec-toggle:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }

.hd-body { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); background: var(--vp-c-bg-soft) }
.hd-rail { min-width: 0; padding: 22px; border-right: 1px solid var(--vp-c-divider) }
.hd-rail-in { position: sticky; top: calc(var(--vp-nav-height, 64px) + 20px); display: flex; flex-direction: column; gap: 12px }
.hd-spec-more { align-self: flex-start; min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--vp-c-text-1); font: 600 13px var(--vp-font-family-base); text-decoration: underline; text-underline-offset: 3px; cursor: pointer }
.hd-spec-more:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.hd-hint { margin: 0; font-size: 13px; line-height: 1.5; color: var(--vp-c-text-2) }
.hd-ask { margin: 0; display: flex; justify-content: flex-end; min-height: 46px }
.hd-ask span { padding: 11px 15px; border-radius: 18px 18px 6px 18px; background: var(--vp-c-text-1); color: var(--vp-c-bg); font-size: 15px; line-height: 1.45 }
.hd-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -2px; background: var(--ss-coral); animation: hd-blink 1s steps(1) infinite }
.hd-status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--vp-c-text-2) }
.hd-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ss-gold) }
.hd-dot.writing { background: var(--ss-coral) }
.hd-dot.using, .hd-dot.done { background: var(--vp-c-brand-1) }
.hd-spec-toggle { display: none; align-self: flex-start; min-height: 44px; padding: 0 14px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font: 500 13px var(--vp-font-family-base); cursor: pointer }

/* The spec rail: readable while it streams, then it steps back so the screen leads. */
.hd-spec { position: relative; max-height: 560px; overflow: hidden; border-radius: 14px; background: var(--ss-code-bg); transition: max-height 0.6s ease }
.hd-spec.settled:not(.open) { max-height: 236px }
.hd-spec.settled:not(.open)::after { content: ""; position: absolute; inset: auto 0 0; height: 70px; background: linear-gradient(transparent, var(--ss-code-bg)); pointer-events: none }
.hd-spec pre:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px }
.hd-spec pre { margin: 0; padding: 12px 14px; font: 12px/1.75 var(--vp-font-family-mono); color: var(--ss-code-ink); white-space: pre; overflow-x: auto }
.hd-spec.open pre { max-height: 520px; overflow: auto }
.hd-line { opacity: 0.14; transition: opacity 0.2s }
.hd-line.on { opacity: 1 }
.hd-spec :deep(.tk-tag) { color: var(--ss-code-tag) }
.hd-spec :deep(.tk-kw) { color: var(--ss-code-kw) }
.hd-spec :deep(.tk-prop) { color: var(--ss-code-ink) }
.hd-spec :deep(.tk-str) { color: var(--ss-code-str) }
.hd-spec :deep(.tk-expr) { color: var(--ss-code-expr) }
.hd-spec :deep(.tk-com) { color: var(--ss-code-com) }

.hd-stage { position: relative; min-width: 0; padding: clamp(12px, 2vw, 24px) }
.hd-screen { min-height: 560px; border-radius: 18px; border: 1px solid var(--vp-c-divider); background: var(--sayshape-panel); padding: clamp(14px, 2vw, 22px); opacity: 0.35; transition: opacity 0.35s }
.hd-screen.shown { opacity: 1 }
.hd-screen canvas { display: block }
.hd-cursor { position: absolute; left: 0; top: 0; margin: -4px 0 0 -6px; z-index: 2; pointer-events: none; opacity: 0; transition: transform 0.55s cubic-bezier(0.3, 0.7, 0.2, 1), opacity 0.2s }
.hd-cursor.pressing { transition: transform 0.05s linear, opacity 0.2s }
.hd-cursor.on { opacity: 1 }
.hd-cursor svg { display: block; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25)) }
.hd-proof { display: flex; align-items: center; justify-content: center; gap: 8px; width: fit-content; max-width: 100%; margin: 14px auto 0; padding: 9px 16px; border-radius: 999px; background: var(--vp-c-text-1); color: var(--vp-c-bg); font-size: 14px; line-height: 1.4; text-align: center; opacity: 0; transform: translateY(6px); transition: opacity 0.35s, transform 0.35s }
.hd-proof.on { opacity: 1; transform: none }

.hd-flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--vp-c-divider) }
.hd-flow li { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 2px 10px; padding: 16px 22px; transition: background 0.3s }
.hd-flow li + li { border-left: 1px solid var(--vp-c-divider) }
.hd-flow li.on { background: var(--ss-coral-soft) }
.hd-n { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--vp-c-bg-alt); color: var(--vp-c-text-2); font-size: 12px; font-weight: 700; transition: background 0.3s, color 0.3s }
.hd-flow li.on .hd-n { background: var(--ss-coral-strong); color: #fff }
.hd-flow strong { font-size: 15px }
.hd-flow-text { grid-column: 2; font-size: 14px; color: var(--vp-c-text-2) }

@keyframes hd-blink { 50% { opacity: 0 } }

@media (max-width: 900px) {
  .hd-body { grid-template-columns: minmax(0, 1fr) }
  .hd-rail { padding: 16px 16px 0; border-right: 0 }
  .hd-rail-in { position: static }
  .hd-spec-more, .hd-hint { display: none }
  .hd-spec-toggle { display: inline-flex; align-items: center }
  .hd-spec { display: none }
  .hd-spec.open { display: block }
  .hd-screen { min-height: 0 }
}
@media (max-width: 560px) {
  .hd { border-radius: 20px }
  .hd-bar { padding: 8px 8px 8px 14px }
  .hd-label { order: 3; width: 100%; text-align: center }
  .hd-btn { min-width: 44px; padding: 0 12px; justify-content: center }
  .hd-btn-text { display: none }
  .hd-rail { padding: 12px 12px 0 }
  .hd-stage { padding: 10px }
  .hd-screen { padding: 8px; border-radius: 14px }
  .hd-flow li { padding: 12px 10px; grid-template-columns: 1fr; justify-items: start }
  .hd-flow-text { display: none }
}
@media (prefers-reduced-motion: reduce) {
  .hd-caret { animation: none }
  .hd-cursor, .hd-proof, .hd-screen, .hd-line, .hd-spec, .hd-flow li { transition: none }
}
</style>
