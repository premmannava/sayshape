<script setup lang="ts">
/**
 * The element atlas: every element SayShape has, running live, grouped by
 * category. Generated from the component definitions (elements.json), so a
 * new component appears here without anyone writing about it.
 */
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import data from "../../../.generated/elements.json";
import AtlasCard from "./AtlasCard.vue";

const group = ref<string>("all");
const query = ref("");

const matches = (e: (typeof data.elements)[number]) => {
  const q = query.value.trim().toLowerCase();
  return !q || e.type.includes(q) || e.description.toLowerCase().includes(q);
};
const sections = computed(() =>
  data.categories
    .filter((c) => group.value === "all" || group.value === c.id)
    .map((c) => ({ ...c, items: data.elements.filter((e) => e.category === c.id && e.example && matches(e)) }))
    .filter((c) => c.items.length),
);
const count = (id: string) => data.elements.filter((e) => e.category === id).length;
const shown = computed(() => sections.value.reduce((n, s) => n + s.items.length, 0));
const binds = (e: (typeof data.elements)[number]) => e.props.some((p) => p.name === "bind");
</script>

<template>
  <div class="atlas">
    <header class="at-head">
      <p class="ss-eyebrow">Element atlas</p>
      <h1>{{ data.elements.length }} elements. <span class="ss-mark">Poke any of them.</span></h1>
      <p class="at-lede">Every card below is the real engine running that element's example. Press, drag and type, then flip a card to see the lines that draw it.</p>
      <div class="at-controls">
        <div class="at-chips" role="group" aria-label="Show a category">
          <button type="button" :aria-pressed="group === 'all'" @click="group = 'all'">All <span>{{ data.elements.length }}</span></button>
          <button v-for="c in data.categories" :key="c.id" type="button" :aria-pressed="group === c.id" @click="group = c.id">{{ c.title }} <span>{{ count(c.id) }}</span></button>
        </div>
        <label class="at-search">
          <span class="sr-only">Filter elements</span>
          <input v-model="query" type="search" placeholder="Filter: chart, date, list…">
        </label>
      </div>
    </header>

    <p v-if="!shown" class="at-empty">No element matches “{{ query }}”. <button type="button" class="loom-btn-text" @click="query = ''">Clear the filter</button></p>

    <section v-for="s in sections" :key="s.id" class="at-section" :aria-labelledby="`at-${s.id}`">
      <div class="at-sec-head">
        <h2 :id="`at-${s.id}`">{{ s.title }}</h2>
        <p>{{ s.intro.replace(/`/g, "") }}</p>
        <a :href="withBase(`/docs/components/${s.id}.html`)">All on one page →</a>
      </div>
      <div class="at-wall">
        <AtlasCard v-for="e in s.items" :key="e.type" :type="e.type" :description="e.description" :example="e.example" :live="e.live" :binds-state="binds(e)" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.atlas { max-width: 1320px; margin: 0 auto; padding: 48px 24px 96px }
.at-head { display: grid; gap: 14px; margin-bottom: 24px }
.at-head h1 { margin: 0; font: 800 clamp(40px, 6vw, 72px)/0.98 var(--loom-display); letter-spacing: -0.045em; text-wrap: balance }
.at-lede { margin: 0; max-width: 60ch; font-size: 18px; line-height: 1.5; color: var(--vp-c-text-2) }
.at-controls { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; justify-content: space-between; padding-top: 18px; margin-top: 8px; border-top: 2px solid var(--ss-rule) }
.at-chips { display: flex; flex-wrap: wrap; gap: 8px }
.at-chips button { height: 38px; padding: 0 14px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1) }
.at-chips button span { opacity: 0.55; font-weight: 500; margin-left: 4px }
.at-chips button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--ss-on-ink) }
.at-search input { width: 260px; max-width: 100%; height: 40px; padding: 0 14px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); font-size: 14px; color: var(--vp-c-text-1) }
.at-search input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px }
.at-empty { font-size: 16px; color: var(--vp-c-text-2) }
.at-section { margin-top: 40px }
.at-sec-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin-bottom: 16px }
.at-sec-head h2 { margin: 0; font: 800 32px/1.1 var(--loom-display); letter-spacing: -0.03em }
.at-sec-head p { margin: 0; flex: 1 1 320px; font-size: 15px; color: var(--vp-c-text-2) }
.at-sec-head a { font-size: 14px; font-weight: 600 }
.at-wall { columns: 3 340px; column-gap: 16px }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
@media (max-width: 640px) { .at-search, .at-search input { width: 100% } }
</style>
