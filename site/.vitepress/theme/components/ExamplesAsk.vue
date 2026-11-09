<script setup lang="ts">
/**
 * Prototype: the examples page as a small, scripted version of the product.
 * Pick a question and it types into the prompt box, then its saved answer
 * streams into the real engine line by line, with the spec writing itself
 * alongside. Below, the other answers sit in a row of pictures to browse.
 * No model runs here: every answer is a saved example, replayed.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { examples, exampleById, type Category, type Example } from "../../../examples/catalog";
import { resolveTheme } from "../../../../playground/appearance/presets";
import { useSayShape } from "../sayshape/useSayShape";
import { prefersReducedMotion } from "../sayshape/runtime";
import { highlightLine } from "../sayshape/highlight";
import { onHostEvents, type HostEvent } from "../sayshape/events";

const SUGGESTED = ["sales-this-week", "pick-a-laptop", "org-chart", "trip-planner", "tip-calculator"];
const CATEGORIES: (Category | "All")[] = ["All", "Money", "Shopping", "Dashboards", "Plans"];
const suggested = SUGGESTED.map((id) => exampleById(id)!).filter(Boolean);

const current = ref<Example>(suggested[0]!);
const typed = ref("");
const shown = ref(0);
const phase = ref<"idle" | "asking" | "writing" | "done">("idle");
const events = ref<HostEvent[]>([]);
const specOpen = ref(true);
const filter = ref<Category | "All">("All");
const more = computed(() => examples.filter((e) => filter.value === "All" || e.category === filter.value));

const lines = computed(() => current.value.spec.split("\n"));
const specLines = computed(() => lines.value.slice(0, shown.value).map(highlightLine));
const status = computed(() =>
  phase.value === "asking" ? "Reading the question…"
  : phase.value === "writing" ? `Writing the screen · ${shown.value} of ${lines.value.length} lines`
  : phase.value === "done" ? `Done in ${lines.value.length} lines. Try it: everything on the screen works.` : "");

const canvas = ref<HTMLCanvasElement | null>(null);
const resultEl = ref<HTMLElement | null>(null);
const specEl = ref<HTMLElement | null>(null);
const stage = computed(() => {
  const t = resolveTheme(current.value.look.preset, current.value.look.scheme, current.value.look.accent ?? null).theme;
  return { background: t.colors.surface, "--dot": t.colors.line };
});

let run = { cancelled: false };
const wait = (ms: number, mine: { cancelled: boolean }) => new Promise<boolean>((r) => setTimeout(() => r(!mine.cancelled), ms));

async function ask(e: Example, scroll = false) {
  const ui = sayshape.value;
  current.value = e;
  events.value = [];
  history.replaceState(null, "", `#${e.id}`);
  if (scroll) resultEl.value?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  if (!ui) return;
  run.cancelled = true;
  const mine = (run = { cancelled: false });
  const still = prefersReducedMotion();
  ui.setTheme(resolveTheme(e.look.preset, e.look.scheme, e.look.accent ?? null).theme);
  ui.setSpec("", { resetState: true });
  shown.value = 0;
  phase.value = "asking";
  if (still) typed.value = e.prompt;
  else {
    for (let n = 0; n <= e.prompt.length; n += 2) {
      typed.value = e.prompt.slice(0, n);
      if (!(await wait(14, mine))) return;
    }
    typed.value = e.prompt;
    if (!(await wait(220, mine))) return;
  }
  phase.value = "writing";
  ui.beginStream();
  const all = e.spec.split("\n");
  for (const [i, line] of all.entries()) {
    ui.push(line + "\n");
    shown.value = i + 1;
    await nextTick();
    if (specEl.value) specEl.value.scrollTop = specEl.value.scrollHeight;
    if (!still && !(await wait(all.length > 30 ? 28 : 45, mine))) return;
  }
  ui.endStream();
  phase.value = "done";
}

const { sayshape } = useSayShape(canvas, (ui) => {
  const off = onHostEvents(ui, (e) => (events.value = [e, ...events.value].slice(0, 3)));
  const fromHash = exampleById(location.hash.slice(1));
  void ask(fromHash ?? current.value);
  return off;
}, { followSiteTheme: () => false, map: true, today: "2026-10-21", padding: "auto" });

function onHash() { const e = exampleById(location.hash.slice(1)); if (e && e.id !== current.value.id) void ask(e); }
onMounted(() => {
  if (matchMedia("(max-width: 860px)").matches) specOpen.value = false;
  window.addEventListener("hashchange", onHash);
});
onBeforeUnmount(() => { run.cancelled = true; window.removeEventListener("hashchange", onHash); });
</script>

<template>
  <div class="ak">
    <section class="ak-hero">
      <p class="ak-eyebrow">Examples</p>
      <h1>What do you want to <em>see</em>?</h1>
      <div class="ak-prompt" role="group" aria-label="The question">
        <span class="ak-spark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z" /></svg></span>
        <p class="ak-typed" aria-live="polite">{{ typed }}<i v-if="phase === 'asking'" class="ak-caret" aria-hidden="true"></i><span v-if="!typed" class="ak-placeholder">Pick a question below</span></p>
        <button type="button" class="ak-go" :aria-label="`Ask again: ${current.prompt}`" @click="ask(current)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
      </div>
      <div class="ak-chips" role="group" aria-label="Try a question">
        <button v-for="e in suggested" :key="e.id" type="button" class="ak-chip" :aria-pressed="current.id === e.id" @click="ask(e)">{{ e.prompt }}</button>
      </div>
      <p class="ak-note">Saved answers, replayed on the real SayShape engine. No model runs on this page.</p>
    </section>

    <section ref="resultEl" class="ak-result" :class="{ 'spec-open': specOpen }" aria-label="The answer">
      <header class="ak-bar">
        <span class="ak-status"><span class="ak-dot" :class="phase" aria-hidden="true"></span>{{ status }}</span>
        <span class="ak-bar-actions">
          <button type="button" class="ak-btn" :aria-expanded="specOpen" @click="specOpen = !specOpen">{{ specOpen ? "Hide spec" : `Spec · ${lines.length} lines` }}</button>
          <a class="ak-btn" :href="withBase(`/playground.html?example=${current.id}`)">Remix →</a>
        </span>
      </header>
      <div class="ak-split">
        <div class="ak-stage" :style="stage">
          <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`${current.title}, drawn live by SayShape`"></canvas></div>
        </div>
        <aside v-show="specOpen" class="ak-spec" aria-label="The spec the answer is drawn from">
          <p class="ak-spec-title">{{ shown }} / {{ lines.length }} lines</p>
          <pre ref="specEl" tabindex="0"><code><span v-for="(l, i) in specLines" :key="i" class="ak-line" v-html="l + '\n'"></span></code></pre>
        </aside>
      </div>
      <footer class="ak-log" aria-live="polite">
        <span class="ak-log-title">Sent to your app</span>
        <code v-if="events.length">{{ events[0]!.text }}</code>
        <span v-else>{{ current.simulated ?? "Press a button on the screen to see the action it sends." }}</span>
      </footer>
    </section>

    <section class="ak-more" aria-labelledby="ak-more-title">
      <div class="ak-more-head">
        <h2 id="ak-more-title">More answers</h2>
        <div class="ak-filters" role="group" aria-label="Show">
          <button v-for="c in CATEGORIES" :key="c" type="button" :aria-pressed="filter === c" @click="filter = c">{{ c }}</button>
        </div>
      </div>
      <div class="ak-row">
        <button v-for="e in more" :key="e.id" type="button" class="ak-card" :aria-current="current.id === e.id ? 'true' : undefined" @click="ask(e, true)">
          <span class="ak-thumb" :class="{ dark: e.look.scheme === 'dark' }"><img :src="withBase(`/examples-thumbs/${e.id}.png`)" alt="" loading="lazy" /></span>
          <span class="ak-card-ask">“{{ e.prompt }}”</span>
          <span class="ak-card-meta">{{ e.category }} · {{ e.spec.split("\n").length }} lines</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ak { max-width: 1280px; margin: 0 auto; padding: 56px 24px 96px }
.ak-hero { max-width: 860px; margin: 0 auto 36px; text-align: center }
.ak-eyebrow { margin: 0 0 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-coral-ink) }
.ak-hero h1 { margin: 0 0 26px; font: 600 clamp(40px, 6vw, 72px)/1 var(--sayshape-display); letter-spacing: -0.035em }
.ak-hero h1 em { color: var(--ss-coral); font-style: italic }
.ak-prompt { display: flex; align-items: center; gap: 12px; min-height: 68px; padding: 10px 10px 10px 20px; border: 1px solid var(--vp-c-divider); border-radius: 22px; background: var(--ss-card); box-shadow: var(--ss-lift); text-align: left }
.ak-spark { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none; border-radius: 10px; background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.ak-typed { flex: 1; min-width: 0; margin: 0; font-size: 19px; line-height: 1.4; color: var(--vp-c-text-1) }
.ak-placeholder { color: var(--vp-c-text-3) }
.ak-caret { display: inline-block; width: 2px; height: 1.1em; margin-left: 2px; vertical-align: -0.15em; background: var(--ss-coral); animation: ak-blink 1s steps(1) infinite }
.ak-go { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; flex: none; border-radius: 14px; background: var(--ss-coral-strong, var(--ss-coral)); color: #fff }
.ak-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px }
.ak-chip { min-height: 40px; padding: 0 16px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font-size: 14px; font-weight: 500; cursor: pointer; transition: border-color 0.15s, background 0.15s }
.ak-chip:hover { border-color: var(--vp-c-text-3) }
.ak-chip[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }
.ak-note { margin: 14px 0 0; font-size: 13px; color: var(--vp-c-text-3) }

.ak-result { scroll-margin-top: calc(var(--vp-nav-height) + 16px); border: 1px solid var(--vp-c-divider); border-radius: 24px; background: var(--vp-c-bg-soft); box-shadow: var(--ss-lift); overflow: hidden }
.ak-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 12px 10px 20px; border-bottom: 1px solid var(--vp-c-divider) }
.ak-status { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--vp-c-text-2) }
.ak-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vp-c-text-3) }
.ak-dot.writing, .ak-dot.asking { background: var(--ss-coral); animation: ak-pulse 1s ease-in-out infinite }
.ak-dot.done { background: var(--vp-c-brand-1) }
.ak-bar-actions { display: inline-flex; gap: 8px }
.ak-btn { display: inline-flex; align-items: center; min-height: 40px; padding: 0 14px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font-size: 13px; font-weight: 600; text-decoration: none }
.ak-split { display: grid; grid-template-columns: minmax(0, 1fr); }
.ak-result.spec-open .ak-split { grid-template-columns: minmax(0, 1fr) 360px }
.ak-stage { min-width: 0; min-height: 420px; padding: clamp(10px, 2vw, 24px); background-image: radial-gradient(color-mix(in srgb, var(--dot) 70%, transparent) 1px, transparent 1px); background-size: 14px 14px; transition: background-color 0.3s }
.ak-stage canvas { display: block; border-radius: 12px }
.ak-spec { min-width: 0; border-left: 1px solid var(--vp-c-divider); background: var(--ss-code-bg); display: flex; flex-direction: column }
.ak-spec-title { margin: 0; padding: 10px 16px; font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-code-com); border-bottom: 1px solid rgba(255, 255, 255, 0.06) }
.ak-spec pre { flex: 1; margin: 0; padding: 12px 16px; max-height: 640px; overflow: auto; font: 12px/1.7 var(--vp-font-family-mono); color: var(--ss-code-ink); white-space: pre }
.ak-line { animation: ak-in 0.25s ease-out }
.ak-spec :deep(.tk-tag) { color: var(--ss-code-tag) }
.ak-spec :deep(.tk-kw) { color: var(--ss-code-kw) }
.ak-spec :deep(.tk-str) { color: var(--ss-code-str) }
.ak-spec :deep(.tk-expr) { color: var(--ss-code-expr) }
.ak-spec :deep(.tk-com) { color: var(--ss-code-com) }
.ak-log { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 12px 20px; border-top: 1px solid var(--vp-c-divider); font-size: 13px; color: var(--vp-c-text-2) }
.ak-log-title { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--vp-c-text-3) }
.ak-log code { background: none; padding: 0; color: var(--vp-c-brand-1) }

.ak-more { margin-top: 56px }
.ak-more-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; margin-bottom: 18px }
.ak-more h2 { margin: 0; padding: 0; border: 0; font: 600 34px/1.05 var(--sayshape-display); letter-spacing: -0.02em }
.ak-filters { display: flex; flex-wrap: wrap; gap: 6px }
.ak-filters button { min-height: 38px; padding: 0 14px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font-size: 13px; font-weight: 600 }
.ak-filters button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }
.ak-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(260px, 300px); gap: 16px; overflow-x: auto; padding: 4px 4px 18px; scroll-snap-type: x mandatory; scrollbar-width: thin }
.ak-card { display: grid; gap: 8px; align-content: start; padding: 10px 10px 14px; border: 1px solid var(--vp-c-divider); border-radius: 18px; background: var(--ss-card); color: var(--vp-c-text-1); text-align: left; cursor: pointer; scroll-snap-align: start; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s }
.ak-card:hover { transform: translateY(-3px); box-shadow: var(--ss-lift-sm) }
.ak-card[aria-current="true"] { border-color: var(--vp-c-text-1) }
.ak-thumb { display: block; height: 170px; overflow: hidden; border-radius: 12px; background: var(--vp-c-bg-alt) }
.ak-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left }
.ak-card-ask { padding: 0 4px; font-size: 15px; font-weight: 500; line-height: 1.4 }
.ak-card-meta { padding: 0 4px; font-size: 12px; color: var(--vp-c-text-3) }

@keyframes ak-blink { 50% { opacity: 0 } }
@keyframes ak-pulse { 50% { opacity: 0.35 } }
@keyframes ak-in { from { opacity: 0; transform: translateX(-4px) } }

@media (max-width: 860px) {
  .ak { padding: 32px 16px 64px }
  .ak-result.spec-open .ak-split { grid-template-columns: minmax(0, 1fr) }
  .ak-spec { border-left: 0; border-top: 1px solid var(--vp-c-divider) }
  .ak-spec pre { max-height: 280px }
  .ak-stage { min-height: 300px }
}
@media (max-width: 560px) {
  .ak-hero { text-align: left }
  .ak-hero h1 { font-size: 40px; margin-bottom: 18px }
  .ak-prompt { min-height: 60px; padding: 8px 8px 8px 12px; border-radius: 18px }
  .ak-typed { font-size: 16px }
  .ak-chips { justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; margin: 14px -16px 0; padding: 0 16px 4px; scrollbar-width: none }
  .ak-chip { flex: none }
  .ak-bar { padding: 8px 8px 8px 14px }
  .ak-stage { padding: 8px }
  .ak-row { grid-auto-columns: 78%; margin: 0 -16px; padding: 4px 16px 18px; scroll-padding: 16px }
  .ak-more h2 { font-size: 28px }
}
@media (prefers-reduced-motion: reduce) {
  .ak-caret, .ak-dot, .ak-line { animation: none }
  .ak-card { transition: none }
  .ak-card:hover { transform: none }
}
</style>
