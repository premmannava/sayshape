<script setup lang="ts">
/**
 * The landing page's hero: "Say it. See it." A prompt types itself, the
 * matching saved spec streams in line by line (the line being written is
 * highlighted), and the real engine draws each line as it lands. Nothing is
 * generated: the specs are the gallery's saved examples, replayed the way a
 * model's response would arrive. Prompt chips replay the others.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { withBase } from "vitepress";
import { heroExamples } from "../../../examples/catalog";
import { highlightLine } from "../loom/highlight";
import { useLoom } from "../loom/useLoom";
import { prefersReducedMotion, replayStream } from "../loom/runtime";

const active = ref(0);
const typed = ref("");
const shown = ref("");
const phase = ref<"typing" | "writing" | "done">("done");
const canvas = ref<HTMLCanvasElement | null>(null);
let signal = { cancelled: false };
let typer: ReturnType<typeof setTimeout> | null = null;
/** Resolves the prompt-typing wait, so a cancelled play() finishes instead of waiting forever. */
let finishTyping: (() => void) | null = null;
const problems = ref(0);

const current = computed(() => heroExamples[active.value]!);
const total = computed(() => current.value.example.spec.split("\n").length);
const lines = computed(() => {
  const all = shown.value ? shown.value.split("\n") : [];
  // Only whole lines render while streaming, so the last partial line is the one being written.
  return all.map((l, i) => ({ html: highlightLine(l), hot: phase.value === "writing" && i === all.length - 1 }));
});
const status = computed(() =>
  phase.value === "typing" ? "thinking…" : phase.value === "writing" ? `line ${lines.value.length} of ${total.value}` : `${total.value} lines · ${problems.value === 1 ? "1 problem" : `${problems.value} problems`}`,
);

const motion = () => !prefersReducedMotion();
const { loom } = useLoom(canvas, (l) => {
  const off = l.on("diagnostics", (d) => { problems.value = d.length; });
  void play(active.value, motion());
  return off;
});

function stop() {
  signal.cancelled = true;
  if (typer) { clearTimeout(typer); typer = null; }
  finishTyping?.();
  finishTyping = null;
}

async function play(i: number, animate = true) {
  // Before the engine has loaded, remember the choice; it plays once the engine starts.
  active.value = i;
  const l = loom.value;
  if (!l) return;
  stop();
  signal = { cancelled: false };
  const mine = signal;
  active.value = i;
  const { prompt, example } = heroExamples[i]!;
  if (!animate) {
    typed.value = prompt;
    phase.value = "done";
    await replayStream(l, example.spec, { signal: mine, instant: true, onProgress: (s) => { shown.value = s; } });
    return;
  }
  shown.value = "";
  typed.value = "";
  phase.value = "typing";
  l.setSpec("");
  await new Promise<void>((done) => {
    finishTyping = done;
    let n = 0;
    const tick = () => {
      if (mine.cancelled) return done();
      typed.value = prompt.slice(0, ++n);
      if (n < prompt.length) typer = setTimeout(tick, 28);
      else typer = setTimeout(done, 350);
    };
    tick();
  });
  if (mine.cancelled) return;
  phase.value = "writing";
  const finished = await replayStream(l, example.spec, { signal: mine, onProgress: (s) => { shown.value = s; } });
  if (finished) phase.value = "done";
}

function reset() { loom.value?.setSpec(current.value.example.spec, { resetState: true }); }

onBeforeUnmount(stop);
</script>

<template>
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-top">
      <h1 id="hero-title" class="hero-title">Say it.<br><span class="ss-mark">See it.</span></h1>
      <div class="hero-side">
        <p class="hero-lede">Your AI writes a few lines. SayShape turns them into a working screen.</p>
        <div class="hero-cta">
          <a class="loom-btn primary" :href="withBase('/learn/')">Start the build-along →</a>
          <a class="loom-btn quiet" :href="withBase('/playground.html')">Open the playground</a>
        </div>
        <a class="hero-status" :href="withBase('/docs/architecture/limitations.html')">v0.1 · not screen-reader ready yet · Status</a>
      </div>
    </div>

    <div class="hero-demo" aria-label="Live demo">
      <div class="hd-left">
        <p class="ss-eyebrow">1 · You ask</p>
        <div class="hd-chips" role="group" aria-label="Pick a prompt">
          <button v-for="(h, i) in heroExamples" :key="h.example.id" type="button" :aria-pressed="i === active" @click="play(i, motion())">{{ h.label }}</button>
        </div>
        <p class="hd-prompt">“{{ typed }}<span v-if="phase === 'typing'" class="caret" aria-hidden="true"></span>”</p>
        <div class="hd-row">
          <p class="ss-eyebrow">2 · AI writes</p>
          <span class="hd-status" aria-live="polite">{{ status }}</span>
        </div>
        <pre class="spec-view hd-spec" tabindex="0" :aria-label="`The SayShape spec for ${current.example.title}`"><code><span v-for="(l, i) in lines" :key="i" class="line" :class="{ hot: l.hot }" v-html="l.html"></span></code></pre>
      </div>
      <div class="hd-right">
        <div class="hd-row">
          <p class="ss-eyebrow">3 · You get</p>
          <span class="hd-actions">
            <button type="button" class="loom-btn-text" :disabled="!loom" @click="play(active, motion())">Replay</button>
            <button type="button" class="loom-btn-text" :disabled="!loom || phase !== 'done'" @click="reset">Reset</button>
          </span>
        </div>
        <div class="ss-card hd-card">
          <div class="loom-stage hd-stage">
            <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`${current.example.title}, drawn by SayShape on a canvas. The spec beside it is the readable source.`"></canvas></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero { display: grid; gap: 28px; margin-bottom: 72px }
.hero-top { display: grid; grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); gap: 24px 48px; align-items: end }
.hero-title { margin: 0; font: 800 clamp(76px, 12vw, 168px)/0.84 var(--loom-display); letter-spacing: -0.055em; color: var(--vp-c-text-1) }
.hero-title .ss-mark { color: var(--vp-c-brand-1); background-size: 100% 0.16em; background-position: 0 84% }
.hero-side { display: grid; gap: 18px; padding-bottom: 12px }
.hero-lede { margin: 0; font-size: 19px; line-height: 1.5; color: var(--vp-c-text-2); text-wrap: pretty }
.hero-cta { display: flex; flex-wrap: wrap; gap: 10px }
.hero-status { justify-self: start; font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); text-decoration: none; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; padding: 6px 12px }
.hero-status:hover { border-color: var(--ss-rule); color: var(--vp-c-text-1) }

.hero-demo { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); border-top: 2px solid var(--ss-rule) }
.hd-left { display: flex; flex-direction: column; gap: 14px; padding: 22px 32px 0 0; border-right: 1px solid var(--vp-c-divider); min-width: 0 }
.hd-right { display: flex; flex-direction: column; gap: 14px; padding: 22px 0 0 32px; min-width: 0 }
.hd-chips { display: flex; flex-wrap: wrap; gap: 8px }
.hd-chips button { height: 38px; padding: 0 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1); background: var(--ss-card) }
.hd-chips button:hover { border-color: var(--ss-rule) }
.hd-chips button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--ss-on-ink) }
.hd-prompt { margin: 0; min-height: 2.4em; font: 500 clamp(20px, 2.1vw, 27px)/1.22 var(--loom-display); letter-spacing: -0.015em; color: var(--vp-c-text-1) }
.caret { display: inline-block; width: 3px; height: 0.95em; margin-left: 3px; vertical-align: -3px; background: var(--vp-c-text-1); animation: blink 1s steps(1) infinite }
@keyframes blink { 50% { opacity: 0 } }
.hd-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px }
.hd-row .ss-eyebrow { margin: 0 }
.hd-status { font: 12px var(--vp-font-family-mono); color: var(--vp-c-text-3) }
.hd-spec { margin: 0; min-height: 300px; max-height: 470px; overflow: auto; font-size: 12.5px }
.hd-spec :deep(.line) { white-space: pre-wrap; word-break: break-word; padding-left: 2ch; text-indent: -2ch }
.hd-spec .hot { background: var(--ss-mark-soft); border-radius: 3px }
.hd-actions { display: inline-flex; gap: 16px }
.hd-card { overflow: hidden }
.hd-stage { min-height: 340px }

@media (max-width: 960px) {
  .hero-top, .hero-demo { grid-template-columns: minmax(0, 1fr) }
  .hd-left { border-right: 0; padding-right: 0 }
  .hd-right { padding-left: 0; padding-top: 18px }
  .hd-spec { min-height: 0; max-height: 240px }
  .hd-stage { min-height: 200px }
}
@media (prefers-reduced-motion: reduce) { .caret { animation: none } }
</style>
