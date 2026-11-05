<script setup lang="ts">
/**
 * One example running live in its own look (a playground appearance preset,
 * light or dark), whatever the site's own theme is: the same spec can wear
 * any brand. Used by the gallery's cards and its open view.
 */
import { computed, ref } from "vue";
import type { Example } from "../../../examples/catalog";
import { resolveTheme } from "../../../../playground/appearance/presets";
import { useSayShape } from "../sayshape/useSayShape";
import { usesMap } from "../sayshape/runtime";
import { onHostEvents, type HostEvent } from "../sayshape/events";

const props = defineProps<{ example: Example; eager?: boolean }>();
const emit = defineEmits<{ event: [e: HostEvent] }>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const theme = computed(() => resolveTheme(props.example.look.preset, props.example.look.scheme, props.example.look.accent ?? null).theme);
// The stage takes the example's own page color, so a dark example sits on dark.
const stage = computed(() => ({ background: theme.value.colors.surface, "--dot": theme.value.colors.line }));

const { sayshape, failed } = useSayShape(canvas, (l) => {
  l.setTheme(theme.value);
  const off = onHostEvents(l, (e) => emit("event", e));
  l.setSpec(props.example.spec);
  return off;
}, { lazy: props.eager ? undefined : root, followSiteTheme: () => false, map: usesMap(props.example.spec), today: "2026-10-21" });

defineExpose({ reset: () => sayshape.value?.setSpec(props.example.spec, { resetState: true }) });
</script>

<template>
  <div ref="root" class="xl" :style="stage">
    <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`${example.title}, running live on a canvas`"></canvas></div>
    <p v-if="failed" class="sayshape-live__failed">Couldn't start: {{ failed }}</p>
  </div>
</template>

<style scoped>
.xl { padding: 14px; background-image: radial-gradient(color-mix(in srgb, var(--dot) 70%, transparent) 1px, transparent 1px); background-size: 14px 14px }
.xl canvas { display: block; border-radius: 10px }
</style>
