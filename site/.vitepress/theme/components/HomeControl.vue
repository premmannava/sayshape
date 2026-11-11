<script setup lang="ts">
/**
 * "Your app stays in control": the same spec redrawn in each of SayShape's
 * looks, or in a color the visitor picks, and the actions its button sends,
 * as the page receives them.
 */
import { computed, ref } from "vue";
import { normalizeHex } from "../../../../playground/appearance/color";
import { resolveTheme } from "../../../../playground/appearance/presets";
import { lookChoices, lookSpec, type Look } from "../../../examples/home";
import LiveDemo from "./LiveDemo.vue";

const chosen = ref(0);
/** The visitor's own color, laid over whichever look is chosen; null until they pick one. */
const accent = ref<string | null>(null);
const look = computed<Look>(() => ({ ...lookChoices[chosen.value]!.look, ...(accent.value ? { accent: accent.value } : {}) }));
/** What the picker shows before anything is picked: the chosen look's own accent. */
const swatch = computed(() => accent.value ?? normalizeHex(resolveTheme(lookChoices[chosen.value]!.look.preset, "light", null).theme.colors.accent) ?? "#0f766e");

function pick(ev: Event) {
  accent.value = normalizeHex((ev.target as HTMLInputElement).value);
}
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
    <div class="ct-color">
      <label class="ct-pick">
        <input type="color" :value="swatch" aria-describedby="ct-color-note" @input="pick">
        <span>{{ accent ? "Your color" : "Pick your brand color" }}</span>
        <code v-if="accent">{{ accent }}</code>
      </label>
      <button v-if="accent" type="button" class="ct-reset" @click="accent = null">Reset</button>
      <span id="ct-color-note" class="ct-note">The chart and the button take it. The spec doesn't change.</span>
    </div>
    <LiveDemo class="ct-live" :spec="lookSpec" :look="look" :label="`A booking card with a chart in the ${lookChoices[chosen]!.name} look${accent ? ` and the color ${accent}` : ''}, drawn by SayShape`" @action="onAction" />
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
.ct-color { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px }
.ct-pick { display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 14px 0 8px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font: 600 13px var(--vp-font-family-base); cursor: pointer }
.ct-pick input { width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; appearance: none; -webkit-appearance: none }
.ct-pick input::-webkit-color-swatch-wrapper { padding: 0 }
.ct-pick input::-webkit-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.ct-pick input::-moz-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.ct-pick:focus-within { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.ct-pick code { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); background: none; padding: 0 }
.ct-reset { min-height: 44px; padding: 0 10px; border: 0; background: none; color: var(--vp-c-text-2); font: 600 13px var(--vp-font-family-base); text-decoration: underline; cursor: pointer }
.ct-reset:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px; border-radius: 6px }
.ct-note { flex: 1 1 220px; font-size: 13px; line-height: 1.4; color: var(--vp-c-text-2) }
.ct-live { border-radius: 16px; border: 1px solid var(--vp-c-divider) }
.ct-log { display: flex; flex-direction: column; gap: 6px; min-height: 64px; padding: 12px 14px; border-radius: 14px; background: var(--ss-code-bg); color: var(--ss-code-ink); font-size: 13px }
.ct-log-title { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ss-code-com) }
.ct-empty { line-height: 1.5 }
.ct-log code { font: 13px var(--vp-font-family-mono); color: var(--ss-code-str); background: none; padding: 0 }
</style>
