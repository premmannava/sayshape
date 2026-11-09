<script setup lang="ts">
/**
 * "One question. A whole new way to answer." Four saved answers to four
 * different questions, each drawn live by the engine in its own look. Picking
 * another question starts its screen fresh; the spec behind each one is a
 * click away.
 */
import { computed, nextTick, ref } from "vue";
import { showcases } from "../../../examples/home";
import { highlightSpec } from "../sayshape/highlight";
import LiveDemo from "./LiveDemo.vue";

const active = ref(0);
const specOpen = ref(false);
const lastAction = ref("");
const tabs = ref<HTMLButtonElement[]>([]);
const current = computed(() => showcases[active.value]!);
const lineCount = computed(() => current.value.spec.split("\n").length);
const html = computed(() => highlightSpec(current.value.spec));

function pick(i: number) {
  if (i === active.value) return;
  active.value = i;
  specOpen.value = false;
  lastAction.value = "";
}

/** Arrow keys, Home and End move between the tabs, as a tab list should. */
async function onKey(e: KeyboardEvent, i: number) {
  const n = showcases.length;
  const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n
    : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n
    : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  pick(to);
  await nextTick();
  tabs.value[to]?.focus();
}

/** What a real app might do with each action; this page only shows that it arrived. */
const NEXT: Record<string, string> = {
  choose: "A real app would start the sign-up from here.",
  email: "A real app would send the emails; this demo sends nothing.",
};
function onAction(name: string) {
  lastAction.value = `The screen sent “${name}” to the page. ${NEXT[name] ?? "Your code decides what that does."}`;
}
</script>

<template>
  <div class="sc">
    <div class="sc-tabs" role="tablist" aria-label="Example questions">
      <button
        v-for="(s, i) in showcases"
        :id="`sc-tab-${s.id}`"
        :key="s.id"
        ref="tabs"
        type="button"
        role="tab"
        :aria-selected="i === active"
        :aria-controls="`sc-panel`"
        :tabindex="i === active ? 0 : -1"
        class="sc-tab"
        @click="pick(i)"
        @keydown="onKey($event, i)"
      >
        <span class="sc-kind"><span class="sc-dot" :class="s.id" aria-hidden="true"></span>{{ s.kind }}</span>
        <span class="sc-ask">“{{ s.ask }}”</span>
      </button>
    </div>

    <div id="sc-panel" class="sc-panel" role="tabpanel" :aria-labelledby="`sc-tab-${current.id}`">
      <div class="sc-meta">
        <span><strong>{{ current.lookName }}</strong> look · {{ lineCount }} lines of SayShape · <span class="sc-sample">Sample data</span></span>
        <button type="button" class="sc-spec-btn" :aria-expanded="specOpen" aria-controls="sc-spec" @click="specOpen = !specOpen">{{ specOpen ? "Hide the spec" : "See the spec" }}</button>
      </div>
      <div v-if="specOpen" id="sc-spec" class="sc-spec" tabindex="0" role="region" aria-label="The spec behind this screen"><pre><code v-html="html"></code></pre></div>
      <LiveDemo class="sc-live" :spec="current.spec" :look="current.look" :label="`The answer to “${current.ask}”, drawn by SayShape`" map @action="onAction" />
      <p class="sc-note" aria-live="polite">{{ lastAction || "Every control works. The numbers are worked out on the screen, from the spec’s own data." }}</p>
    </div>
  </div>
</template>

<style scoped>
.sc { display: flex; flex-direction: column; gap: 16px }
.sc-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px }
.sc-tab { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-height: 44px; padding: 14px 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 16px; background: var(--ss-card); color: var(--vp-c-text-1); text-align: left; cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s, background 0.2s }
.sc-tab:hover { border-color: var(--vp-c-text-3) }
.sc-tab[aria-selected="true"] { border-color: var(--vp-c-text-1); background: var(--vp-c-bg); box-shadow: var(--ss-lift-sm) }
.sc-tab:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.sc-kind { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vp-c-text-2) }
.sc-tab[aria-selected="true"] .sc-kind { color: var(--vp-c-text-1) }
.sc-dot { width: 8px; height: 8px; border-radius: 50% }
.sc-dot.insurance { background: #1d4ed8 }
.sc-dot.latency { background: #8f8cff }
.sc-dot.trip { background: #6d28d9 }
.sc-dot.orders { background: #374151 }
.dark .sc-dot.orders { background: #d1d5db }
.sc-ask { font-size: 15px; line-height: 1.4; font-weight: 500 }

.sc-panel { border: 1px solid var(--vp-c-divider); border-radius: 24px; background: var(--vp-c-bg-soft); overflow: hidden }
.sc-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 14px 10px 20px; border-bottom: 1px solid var(--vp-c-divider); font-size: 13px; color: var(--vp-c-text-2) }
.sc-meta strong { color: var(--vp-c-text-1); font-weight: 600 }
.sc-sample { padding: 2px 8px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card) }
.sc-spec-btn { min-height: 44px; padding: 0 16px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font: 500 13px var(--vp-font-family-base); cursor: pointer }
.sc-spec-btn:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.sc-spec { margin: 14px 14px 0; max-height: 320px; overflow: auto; border-radius: 14px; background: var(--ss-code-bg) }
.sc-spec:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.sc-spec pre { margin: 0; padding: 14px 16px; font: 12.5px/1.7 var(--vp-font-family-mono); color: var(--ss-code-ink); white-space: pre }
.sc-spec :deep(.tk-tag) { color: var(--ss-code-tag) }
.sc-spec :deep(.tk-kw) { color: var(--ss-code-kw) }
.sc-spec :deep(.tk-prop) { color: var(--ss-code-ink) }
.sc-spec :deep(.tk-str) { color: var(--ss-code-str) }
.sc-spec :deep(.tk-expr) { color: var(--ss-code-expr) }
.sc-spec :deep(.tk-com) { color: var(--ss-code-com) }
.sc-live { margin: 14px; border-radius: 18px; border: 1px solid var(--vp-c-divider) }
.sc-note { margin: 0 20px 16px; font-size: 13px; color: var(--vp-c-text-2) }

@media (max-width: 860px) {
  .sc-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px }
  .sc-tab { padding: 12px 14px; gap: 6px }
  .sc-ask { font-size: 14px }
}
@media (max-width: 560px) {
  .sc-meta { padding: 8px 10px 8px 14px }
  .sc-live { margin: 6px; border-radius: 14px }
  .sc-spec { margin: 8px 8px 0 }
  .sc-note { margin: 0 14px 12px }
  .sc-panel { border-radius: 18px }
}
@media (prefers-reduced-motion: reduce) { .sc-tab { transition: none } }
</style>
