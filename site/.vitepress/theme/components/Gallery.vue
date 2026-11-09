<script setup lang="ts">
/**
 * The examples gallery: every example running live in its own look, as a
 * grid of cards. Each card shows what someone would ask for; opening one
 * shows it large with its spec. #id links open that example.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { withBase } from "vitepress";
import { examples, exampleById, type Category, type Example } from "../../../examples/catalog";
import { highlightSpec } from "../sayshape/highlight";
import type { HostEvent } from "../sayshape/events";
import ExampleLive from "./ExampleLive.vue";

const CATEGORIES: Category[] = ["Money", "Shopping", "Dashboards", "Plans"];
const filter = ref<Category | "All">("All");
const shown = computed(() => examples.filter((e) => filter.value === "All" || e.category === filter.value));

const dialog = ref<HTMLDialogElement | null>(null);
const open = shallowRef<Example | null>(null);
const live = ref<InstanceType<typeof ExampleLive> | null>(null);
const events = ref<HostEvent[]>([]);
const copied = ref(false);
const specHtml = computed(() => (open.value ? highlightSpec(open.value.spec) : ""));
const lines = computed(() => (open.value ? open.value.spec.split("\n").length : 0));

async function show(e: Example) {
  open.value = e;
  events.value = [];
  copied.value = false;
  history.replaceState(null, "", `#${e.id}`);
  await nextTick();
  if (!dialog.value?.open) dialog.value?.showModal();
}
function close() { dialog.value?.close(); }
function onClose() {
  open.value = null;
  history.replaceState(null, "", location.pathname + location.search);
}
async function copy() {
  if (!open.value) return;
  try { await navigator.clipboard.writeText(open.value.spec); copied.value = true; } catch { copied.value = false; }
}
function fromHash() {
  const e = exampleById(location.hash.slice(1));
  if (e && open.value?.id !== e.id) void show(e);
}

onMounted(() => {
  fromHash();
  window.addEventListener("hashchange", fromHash);
});
onBeforeUnmount(() => window.removeEventListener("hashchange", fromHash));
</script>

<template>
  <div class="gallery">
    <header class="g-head">
      <h1>Examples</h1>
      <p>Real screens, running live. Each one is a few lines of SayShape.</p>
      <div class="g-chips" role="group" aria-label="Show">
        <button type="button" :aria-pressed="filter === 'All'" @click="filter = 'All'">All</button>
        <button v-for="c in CATEGORIES" :key="c" type="button" :aria-pressed="filter === c" @click="filter = c">{{ c }}</button>
      </div>
    </header>

    <div class="g-grid">
      <!-- A dark example takes the site's dark tokens, so its whole card reads as one dark piece. -->
      <article v-for="e in shown" :id="e.id" :key="e.id" class="g-card" :class="{ dark: e.look.scheme === 'dark' }">
        <ExampleLive :example="e" />
        <div class="g-meta">
          <div class="g-text">
            <h2>{{ e.title }}</h2>
            <p>“{{ e.prompt }}”</p>
          </div>
          <button type="button" class="g-open" :aria-label="`Open ${e.title} with its spec`" @click="show(e)">Open</button>
        </div>
      </article>
    </div>

    <p class="g-foot">Want to change one? Open it and press <strong>Remix</strong>. Names and numbers are made up.</p>

    <dialog ref="dialog" class="g-dialog" :aria-label="open?.title" @close="onClose" @click.self="close">
      <div v-if="open" class="g-view">
        <header class="g-view-head">
          <div>
            <p class="ss-eyebrow">{{ open.category }}</p>
            <h2>{{ open.title }}</h2>
            <p class="g-prompt">“{{ open.prompt }}”</p>
          </div>
          <button type="button" class="g-x" aria-label="Close" @click="close">×</button>
        </header>
        <div class="g-split">
          <div class="g-live ss-card">
            <ExampleLive ref="live" :key="open.id" :example="open" eager @event="(e) => (events = [e, ...events].slice(0, 2))" />
          </div>
          <div class="g-spec">
            <div class="g-spec-bar">
              <span class="ss-eyebrow">{{ lines }} lines of SayShape</span>
              <span class="g-actions">
                <button type="button" class="sayshape-btn-text" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
                <button type="button" class="sayshape-btn-text" @click="live?.reset()">Reset</button>
              </span>
            </div>
            <pre class="spec-view numbered g-pre" tabindex="0" :aria-label="`Spec for ${open.title}`"><code v-html="specHtml"></code></pre>
          </div>
        </div>
        <footer class="g-view-foot">
          <a class="sayshape-btn primary" :href="withBase(`/playground.html?example=${open.id}`)">Remix in playground →</a>
          <span v-if="events.length" class="g-event" aria-live="polite">{{ events[0]!.text }}</span>
          <span v-else-if="open.simulated" class="g-event">{{ open.simulated }}</span>
        </footer>
      </div>
    </dialog>
  </div>
</template>

<style scoped>
.gallery { max-width: 1320px; margin: 0 auto; padding: 48px 24px 96px }
.g-head { display: grid; gap: 12px; padding-bottom: 22px; margin-bottom: 28px; border-bottom: 1px solid var(--vp-c-divider) }
.g-head h1 { margin: 0; font: 800 clamp(48px, 7vw, 88px)/0.95 var(--sayshape-display); letter-spacing: -0.05em }
.g-head p { margin: 0; font-size: 19px; color: var(--vp-c-text-2) }
.g-chips { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 6px }
.g-chips button { height: 38px; padding: 0 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1) }
.g-chips button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--ss-on-ink) }

.g-grid { columns: 3 380px; column-gap: 20px }
.g-card { color: var(--vp-c-text-1); break-inside: avoid; margin: 0 0 20px; border: 1.5px solid var(--vp-c-divider); border-radius: 18px; overflow: hidden; background: var(--ss-card); transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s }
.g-card:hover, .g-card:focus-within { border-color: var(--ss-rule); box-shadow: var(--ss-lift-sm); transform: translate(-2px, -2px) }
.g-meta { display: flex; align-items: center; gap: 14px; padding: 14px 16px 16px; border-top: 1px solid var(--vp-c-divider) }
.g-text { flex: 1; min-width: 0 }
.g-text h2 { margin: 0; font: 800 21px/1.15 var(--sayshape-display); letter-spacing: -0.02em }
.g-text p { margin: 4px 0 0; font-size: 14.5px; color: var(--vp-c-text-2) }
.g-open { flex: none; height: 38px; padding: 0 16px; border: 1.5px solid var(--ss-rule); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1) }
.g-open:hover { background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.g-foot { margin: 16px 0 0; font-size: 15px; color: var(--vp-c-text-3) }

.g-dialog { box-sizing: border-box; width: min(1180px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--vp-c-border); border-radius: 22px; background: var(--vp-c-bg); color: var(--vp-c-text-1); box-shadow: var(--ss-lift-sm); overflow-x: hidden }
.g-dialog::backdrop { background: rgba(15, 26, 23, 0.5) }
.g-view { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 22px 26px 24px }
.g-view-head { display: flex; align-items: flex-start; gap: 16px; justify-content: space-between }
.g-view-head h2 { margin: 2px 0 0; font: 800 clamp(30px, 4vw, 44px)/1 var(--sayshape-display); letter-spacing: -0.035em }
.g-prompt { margin: 8px 0 0; font-size: 17px; color: var(--vp-c-text-2) }
.g-x { width: 42px; height: 42px; flex: none; border-radius: 999px; border: 1.5px solid var(--vp-c-divider); font-size: 22px; color: var(--vp-c-text-1) }
.g-split { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 18px; align-items: start }
.g-live { overflow: hidden }
.g-spec { min-width: 0; border: 1.5px solid var(--vp-c-divider); border-radius: 14px; background: var(--ss-card); overflow: hidden }
.g-spec-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px 8px }
.g-actions { display: inline-flex; gap: 14px }
.g-pre { margin: 0; padding: 0 14px 14px; max-height: 60vh; overflow: auto; font-size: 12.5px }
.g-pre :deep(.line) { white-space: pre-wrap; word-break: break-word }
.g-view-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px }
.g-event { font: 13px var(--vp-font-family-mono); color: var(--vp-c-text-3) }

@media (max-width: 860px) {
  .g-split { grid-template-columns: minmax(0, 1fr) }
  .g-view { padding: 18px 16px 20px }
  .g-pre { max-height: 40vh }
}
@media (prefers-reduced-motion: reduce) { .g-card { transition: none } .g-card:hover { transform: none } }
</style>
