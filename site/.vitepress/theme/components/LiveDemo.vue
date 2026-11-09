<script setup lang="ts">
/**
 * One spec running live on the real engine, in one of SayShape's looks (a
 * playground preset, optionally with a brand accent). The look follows the
 * site's light/dark switch unless it pins a scheme. Changing the spec starts
 * it fresh, so nothing typed or chosen in one example leaks into the next.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { loadThemeFonts, resolveTheme } from "../../../../playground/appearance/presets";
import type { Look } from "../../../examples/home";
import { useSayShape } from "../sayshape/useSayShape";
import { isSiteDark, type SayShape } from "../sayshape/runtime";

const props = defineProps<{ spec: string; look: Look; label: string; map?: boolean; eager?: boolean }>();
const emit = defineEmits<{ ready: [ui: SayShape]; action: [name: string, value: unknown]; change: [key: string] }>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const dark = ref(false);
const theme = computed(() => resolveTheme(props.look.preset, props.look.scheme ?? (dark.value ? "dark" : "light"), props.look.accent ?? null).theme);
/** The surface behind the canvas takes the look's own page color, so a dark look sits on dark. */
const surface = computed(() => theme.value.colors.surface);

let observer: MutationObserver | null = null;
onMounted(() => {
  dark.value = isSiteDark();
  observer = new MutationObserver(() => { dark.value = isSiteDark(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});
onBeforeUnmount(() => observer?.disconnect());

function applyTheme(ui: SayShape) {
  const t = theme.value;
  ui.setTheme(t);
  // Studio draws with Inter; redraw once it has loaded so the first frame's fallback doesn't stay.
  loadThemeFonts(t, () => { if (sayshape.value === ui) ui.setTheme(t); });
}

const { sayshape, failed } = useSayShape(canvas, (ui) => {
  applyTheme(ui);
  ui.setSpec(props.spec);
  const offs = [
    ui.on("action", ({ name, value }) => emit("action", name, value)),
    ui.on("change", ({ key }) => emit("change", key)),
  ];
  emit("ready", ui);
  return () => offs.forEach((off) => off());
}, { lazy: props.eager ? undefined : root, followSiteTheme: () => false, map: props.map });

watch(theme, () => { if (sayshape.value) applyTheme(sayshape.value); });
watch(() => props.spec, (spec) => sayshape.value?.setSpec(spec, { resetState: true }));

defineExpose({ sayshape, reset: () => sayshape.value?.setSpec(props.spec, { resetState: true }) });
</script>

<template>
  <div ref="root" class="live" :style="{ background: surface }">
    <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="label"></canvas></div>
    <p v-if="failed" class="live-failed">This demo couldn't start: {{ failed }}</p>
  </div>
</template>

<style scoped>
.live { border-radius: inherit; padding: clamp(14px, 2.2vw, 24px); transition: background 0.3s }
.live canvas { display: block }
.live canvas:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 4px; border-radius: 6px }
.live-failed { margin: 0; padding: 12px; font-size: 14px; color: var(--sayshape-bad) }
</style>
