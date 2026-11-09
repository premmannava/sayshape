<script setup lang="ts">
/** One element on the atlas wall: its example running live, flippable to the spec that draws it. */
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import { useSayShape } from "../sayshape/useSayShape";
import { usesMap } from "../sayshape/runtime";
import { highlightSpec } from "../sayshape/highlight";

const props = defineProps<{ type: string; description: string; example: string; live: boolean; bindsState: boolean }>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
// Examples that load a photo point at a file this site doesn't ship: show their spec instead of drawing them.
const flipped = ref(!props.live);
const html = computed(() => highlightSpec(props.example));
const href = computed(() => withBase(`/docs/elements/${props.type}.html`));

const { sayshape, failed } = useSayShape(canvas, (l) => {
  l.setSpec(props.example);
}, { lazy: root, map: usesMap(props.example), today: "2026-10-21" });

function reset() { sayshape.value?.setSpec(props.example, { resetState: true }); }
</script>

<template>
  <article ref="root" class="ac">
    <header class="ac-head">
      <a :href="href" class="ac-name">{{ type }}</a>
      <span class="ac-actions">
        <button v-if="!flipped && sayshape" type="button" class="ac-btn" :aria-label="`Reset the ${type} example`" @click="reset">↺</button>
        <button v-if="live" type="button" class="ac-btn" :aria-pressed="flipped" :aria-label="flipped ? `Show the live ${type}` : `Show the spec for ${type}`" @click="flipped = !flipped">{{ flipped ? "Live" : "Spec" }}</button>
      </span>
    </header>
    <div v-show="!flipped" class="sayshape-stage ac-stage">
      <div v-if="live" class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`Live ${type} example`"></canvas></div>
      <p v-if="failed" class="sayshape-live__failed">Couldn't start: {{ failed }}</p>
    </div>
    <pre v-show="flipped" class="spec-view ac-spec" tabindex="0" :aria-label="`Spec for ${type}`"><code v-html="html"></code></pre>
    <footer class="ac-foot">
      <p>{{ description }}</p>
      <a :href="href" class="ac-open" :aria-label="`Open the ${type} page`">Open →</a>
    </footer>
  </article>
</template>

<style scoped>
.ac { break-inside: avoid; margin: 0 0 16px; display: flex; flex-direction: column; background: var(--ss-card); border: 1.5px solid var(--vp-c-divider); border-radius: 16px; overflow: hidden; transition: border-color 0.15s, box-shadow 0.15s }
.ac:hover, .ac:focus-within { border-color: var(--ss-rule); box-shadow: var(--ss-lift-sm) }
.ac-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px 10px }
.ac-name { font: 500 16px var(--vp-font-family-mono); color: var(--vp-c-brand-1); text-decoration: none }
.ac-name:hover { text-decoration: underline; text-underline-offset: 3px }
.ac-actions { display: inline-flex; gap: 6px }
.ac-btn { min-width: 36px; height: 30px; padding: 0 10px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font: 600 12px var(--vp-font-family-base); color: var(--vp-c-text-1) }
.ac-btn:hover, .ac-btn[aria-pressed="true"] { border-color: var(--ss-rule) }
.ac-stage { padding: 12px }
.ac-spec { margin: 0; padding: 12px 14px; background: var(--vp-c-bg); overflow-x: auto; max-height: 340px; font-size: 12.5px }
.ac-foot { display: flex; gap: 12px; align-items: flex-end; justify-content: space-between; padding: 10px 14px 14px; border-top: 1px solid var(--vp-c-divider) }
.ac-foot p { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--vp-c-text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.ac-open { flex: none; font-size: 13px; font-weight: 600; text-decoration: none }
</style>
