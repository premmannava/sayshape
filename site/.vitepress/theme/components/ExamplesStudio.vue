<script setup lang="ts">
/**
 * Prototype: the examples as questions beside one large live screen.
 * The list leads with what someone would ask; picking one draws its screen
 * at full width with the real engine, with its spec and the actions it
 * sends a tab away. On phones the list comes first and a question opens
 * its screen, with Back to return.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { examples, exampleById, type Category, type Example } from "../../../examples/catalog";
import { highlightSpec } from "../sayshape/highlight";
import type { HostEvent } from "../sayshape/events";
import ExampleLive from "./ExampleLive.vue";

const CATEGORIES: Category[] = ["Money", "Shopping", "Dashboards", "Plans"];
/** Elements worth naming on a list row: the ones that make an answer more than a form. */
const NOTABLE: Record<string, string> = {
  chart: "chart", table: "table", map: "map", tree: "org chart", flow: "flow", schedule: "timeline", board: "board",
  compare: "compare", meter: "meter", slider: "sliders", "date-picker": "dates", select: "picker", timeline: "steps",
};

const filter = ref<Category | "All">("All");
const groups = computed(() =>
  CATEGORIES.filter((c) => filter.value === "All" || filter.value === c)
    .map((c) => ({ name: c, items: examples.filter((e) => e.category === c) }))
    .filter((g) => g.items.length));

const current = ref<Example | null>(null);
const tab = ref<"screen" | "spec">("screen");
const events = ref<HostEvent[]>([]);
const copied = ref(false);
const live = ref<InstanceType<typeof ExampleLive> | null>(null);
const stageEl = ref<HTMLElement | null>(null);

const lines = (e: Example) => e.spec.split("\n").length;
function tags(e: Example) {
  const seen = new Set<string>();
  for (const l of e.spec.split("\n")) {
    const t = NOTABLE[l.trim().split(/\s/)[0] ?? ""];
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 3);
}
const specHtml = computed(() => (current.value ? highlightSpec(current.value.spec) : ""));

async function pick(e: Example, scroll = true) {
  current.value = e;
  tab.value = "screen";
  events.value = [];
  copied.value = false;
  history.replaceState(null, "", `#${e.id}`);
  await nextTick();
  if (scroll && matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0 });
}
function back() {
  current.value = null;
  history.replaceState(null, "", location.pathname + location.search);
}
async function copy() {
  if (!current.value) return;
  try { await navigator.clipboard.writeText(current.value.spec); copied.value = true; } catch { copied.value = false; }
}
function fromHash() {
  const e = exampleById(location.hash.slice(1));
  if (e) void pick(e, false);
  else if (!matchMedia("(max-width: 860px)").matches) void pick(examples[0]!, false);
}
onMounted(() => { fromHash(); window.addEventListener("hashchange", fromHash); });
onBeforeUnmount(() => window.removeEventListener("hashchange", fromHash));
</script>

<template>
  <div class="st" :class="{ picked: current }">
    <header class="st-head">
      <h1>Examples</h1>
      <p>Ask a question, get a screen that works. Each one is a few lines of SayShape, running live.</p>
      <div class="st-chips" role="group" aria-label="Show">
        <button type="button" :aria-pressed="filter === 'All'" @click="filter = 'All'">All</button>
        <button v-for="c in CATEGORIES" :key="c" type="button" :aria-pressed="filter === c" @click="filter = c">{{ c }}</button>
      </div>
    </header>

    <div class="st-body">
      <nav class="st-list" aria-label="Example questions">
        <section v-for="g in groups" :key="g.name">
          <h2 class="st-group">{{ g.name }}</h2>
          <button v-for="e in g.items" :key="e.id" type="button" class="st-q" :aria-current="current?.id === e.id ? 'true' : undefined" @click="pick(e)">
            <span class="st-q-ask">“{{ e.prompt }}”</span>
            <span class="st-q-meta"><span>{{ lines(e) }} lines</span><span v-for="t in tags(e)" :key="t" class="st-tag">{{ t }}</span></span>
          </button>
        </section>
      </nav>

      <section v-if="current" ref="stageEl" class="st-stage" :class="{ dark: current.look.scheme === 'dark' }" aria-live="polite">
        <button type="button" class="st-back" @click="back">← All examples</button>
        <div class="st-stage-head">
          <div>
            <p class="st-eyebrow">{{ current.category }} · {{ lines(current) }} lines of SayShape</p>
            <h2>{{ current.title }}</h2>
            <p class="st-ask">“{{ current.prompt }}”</p>
          </div>
          <div class="st-tabs" role="tablist" aria-label="View">
            <button type="button" role="tab" :aria-selected="tab === 'screen'" @click="tab = 'screen'">Screen</button>
            <button type="button" role="tab" :aria-selected="tab === 'spec'" @click="tab = 'spec'">Spec</button>
          </div>
        </div>
        <div v-show="tab === 'screen'" class="st-live">
          <ExampleLive ref="live" :key="current.id" :example="current" eager @event="(e) => (events = [e, ...events].slice(0, 3))" />
        </div>
        <div v-if="tab === 'spec'" class="st-spec">
          <pre class="spec-view numbered" tabindex="0" :aria-label="`Spec for ${current.title}`"><code v-html="specHtml"></code></pre>
        </div>
        <footer class="st-foot">
          <div class="st-log">
            <span class="st-log-title">Sent to your app</span>
            <code v-if="events.length">{{ events[0]!.text }}</code>
            <span v-else class="st-log-empty">{{ current.simulated ?? "Press a button on the screen to see the action it sends." }}</span>
          </div>
          <div class="st-actions">
            <button type="button" class="st-btn" @click="copy">{{ copied ? "Copied" : "Copy spec" }}</button>
            <button type="button" class="st-btn" @click="live?.reset()">Reset</button>
            <a class="st-btn primary" :href="withBase(`/playground.html?example=${current.id}`)">Remix in playground →</a>
          </div>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.st { max-width: 1320px; margin: 0 auto; padding: 48px 24px 96px }
.st-head { display: grid; gap: 12px; padding-bottom: 22px; margin-bottom: 24px; border-bottom: 1px solid var(--vp-c-divider) }
.st-head h1 { margin: 0; font: 600 clamp(48px, 7vw, 88px)/0.95 var(--sayshape-display); letter-spacing: -0.04em }
.st-head p { margin: 0; font-size: 19px; color: var(--vp-c-text-2) }
.st-chips { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px }
.st-chips button { height: 40px; padding: 0 16px; border: 1px solid var(--vp-c-divider); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1); background: var(--ss-card) }
.st-chips button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }

.st-body { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 24px; align-items: start }
.st-list { position: sticky; top: calc(var(--vp-nav-height) + 16px); max-height: calc(100vh - var(--vp-nav-height) - 32px); overflow: auto; padding-right: 4px }
.st-group { margin: 18px 0 8px; font: 700 12px var(--vp-font-family-base); letter-spacing: 0.08em; text-transform: uppercase; color: var(--vp-c-text-2) }
.st-list section:first-child .st-group { margin-top: 0 }
.st-q { display: grid; gap: 8px; width: 100%; margin-bottom: 8px; padding: 14px 16px; border: 1px solid var(--vp-c-divider); border-radius: 14px; background: var(--ss-card); color: var(--vp-c-text-1); text-align: left; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s }
.st-q:hover { border-color: var(--vp-c-text-3) }
.st-q[aria-current="true"] { border-color: var(--vp-c-text-1); box-shadow: var(--ss-lift-sm); background: var(--vp-c-bg) }
.st-q:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.st-q-ask { font-size: 15px; line-height: 1.4; font-weight: 500 }
.st-q-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--vp-c-text-2) }
.st-tag { padding: 2px 8px; border-radius: 999px; background: var(--vp-c-bg-alt) }

.st-stage { min-width: 0; border: 1px solid var(--vp-c-divider); border-radius: 22px; background: var(--vp-c-bg-soft); overflow: hidden }
.st-back { display: none }
.st-stage-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px 20px; padding: 20px 22px 16px; border-bottom: 1px solid var(--vp-c-divider) }
.st-eyebrow { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-coral-ink) }
.st-stage-head h2 { margin: 6px 0 0; padding: 0; border: 0; font: 600 34px/1.05 var(--sayshape-display); letter-spacing: -0.02em }
.st-ask { margin: 6px 0 0; font-size: 16px; color: var(--vp-c-text-2) }
.st-tabs { display: inline-flex; padding: 3px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card) }
.st-tabs button { min-height: 38px; padding: 0 16px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-2) }
.st-tabs button[aria-selected="true"] { background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.st-live { margin: 16px; border-radius: 16px; overflow: hidden; border: 1px solid var(--vp-c-divider) }
.st-spec { margin: 16px; border-radius: 16px; background: var(--ss-card); border: 1px solid var(--vp-c-divider); max-height: 70vh; overflow: auto }
.st-spec pre { margin: 0; padding: 14px 16px; font-size: 12.5px }
.st-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px 16px }
.st-log { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 44px; padding: 8px 14px; border-radius: 12px; background: var(--ss-code-bg); color: var(--ss-code-ink); font-size: 13px; flex: 1 1 320px }
.st-log-title { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-code-com) }
.st-log code { background: none; padding: 0; color: var(--ss-code-str); font-size: 13px }
.st-actions { display: flex; flex-wrap: wrap; gap: 8px }
.st-btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font-weight: 600; font-size: 14px; text-decoration: none }
.st-btn.primary { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }

@media (max-width: 860px) {
  .st { padding: 28px 16px 64px }
  .st-body { grid-template-columns: minmax(0, 1fr) }
  .st-list { position: static; max-height: none; overflow: visible }
  .st.picked .st-list, .st.picked .st-head { display: none }
  .st-back { display: inline-flex; align-items: center; min-height: 44px; margin: 8px 8px 0; padding: 0 12px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1) }
  .st-stage { border-radius: 18px }
  .st-stage-head { padding: 8px 14px 14px }
  .st-stage-head h2 { font-size: 28px }
  .st-live, .st-spec { margin: 8px }
  .st-foot { padding: 0 8px 10px }
  .st-actions .st-btn { flex: 1 1 auto; justify-content: center }
}
</style>
