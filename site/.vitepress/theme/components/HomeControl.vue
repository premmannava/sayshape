<script setup lang="ts">
/**
 * "Your app stays in control": the same spec redrawn in each of SayShape's
 * looks, and the actions its button sends, as the page receives them.
 */
import { computed, ref } from "vue";
import { lookChoices, lookSpec } from "../../../examples/home";
import LiveDemo from "./LiveDemo.vue";

const chosen = ref(0);
const look = computed(() => lookChoices[chosen.value]!.look);
const log = ref<string[]>([]);

function onAction(name: string) {
  log.value = [`action “${name}” received`, ...log.value].slice(0, 3);
}
</script>

<template>
  <div class="ct">
    <div class="ct-looks" role="group" aria-label="Look">
      <button v-for="(c, i) in lookChoices" :key="c.name" type="button" :aria-pressed="i === chosen" class="ct-look" @click="chosen = i">{{ c.name }}</button>
    </div>
    <LiveDemo class="ct-live" :spec="lookSpec" :look="look" :label="`A booking card in the ${lookChoices[chosen]!.name} look, drawn by SayShape`" @action="onAction" />
    <div class="ct-log" aria-live="polite">
      <span class="ct-log-title">Your app's event log</span>
      <span v-if="!log.length" class="ct-empty">Press “Book it”. The screen can only send a named action; your code decides what happens.</span>
      <code v-for="(l, i) in log" :key="i + l">{{ l }}</code>
    </div>
  </div>
</template>

<style scoped>
.ct { display: flex; flex-direction: column; gap: 12px }
.ct-looks { display: flex; flex-wrap: wrap; gap: 6px }
.ct-look { min-height: 44px; padding: 0 14px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font: 600 13px var(--vp-font-family-base); cursor: pointer }
.ct-look[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }
.ct-look:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.ct-live { border-radius: 16px; border: 1px solid var(--vp-c-divider) }
.ct-log { display: flex; flex-direction: column; gap: 6px; min-height: 64px; padding: 12px 14px; border-radius: 14px; background: var(--ss-code-bg); color: var(--ss-code-ink); font-size: 13px }
.ct-log-title { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-code-com) }
.ct-empty { line-height: 1.5 }
.ct-log code { font: 13px var(--vp-font-family-mono); color: var(--ss-code-str); background: none; padding: 0 }
</style>
