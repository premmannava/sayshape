<script setup lang="ts">
/**
 * The build-along: chapters scroll on the left while one live SayShape
 * instance stays pinned on the right. As a chapter becomes the current one,
 * the panel switches to that chapter's spec (keeping values people changed
 * where the declarations match) and marks the lines it added.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { withBase } from "vitepress";
import { chapters, newLines } from "../../../learn/chapters";
import { highlightLine } from "../loom/highlight";
import { useLoom } from "../loom/useLoom";
import { onHostEvents, type HostEvent } from "../loom/events";
import { toBase64Url } from "../loom/runtime";

const current = ref(0);
const canvas = ref<HTMLCanvasElement | null>(null);
const sections = ref<HTMLElement[]>([]);
const events = ref<HostEvent[]>([]);
const stateView = shallowRef<Array<[string, string]>>([]);

const chapter = computed(() => chapters[current.value]!);
const lines = computed(() => {
  // Chapter 1 is all new, so marking every line would mark nothing.
  const fresh = current.value === 0 ? new Set<number>() : newLines(current.value);
  return chapter.value.spec.split("\n").map((l, i) => ({ html: highlightLine(l), fresh: fresh.has(i) }));
});
const playgroundHref = computed(() => withBase("/playground.html") + "#spec=" + toBase64Url(chapter.value.spec));

function readState() {
  const s = loom.value?.state.snapshot() ?? {};
  stateView.value = Object.entries(s).map(([k, v]) => [k, JSON.stringify(v).replace(/"(\w+)":/g, "$1: ").slice(0, 80)]);
}

const { loom, failed } = useLoom(canvas, (l) => {
  const offEvents = onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 2); });
  const offChange = l.on("change", readState);
  l.setSpec(chapter.value.spec);
  readState();
  return () => { offEvents(); offChange(); };
});

function show(i: number) {
  if (i === current.value) return;
  current.value = i;
  loom.value?.setSpec(chapters[i]!.spec);
  events.value = [];
  readState();
}
function go(i: number) {
  sections.value[i]?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  show(i);
}
function restart() {
  loom.value?.setSpec(chapter.value.spec, { resetState: true });
  events.value = [];
  readState();
}

let observer: IntersectionObserver | null = null;
onMounted(() => {
  // The chapter whose top crosses the upper third of the screen becomes current.
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) show(Number((e.target as HTMLElement).dataset.index));
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.value.forEach((s) => observer!.observe(s));
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="learn">
    <header class="ln-head">
      <p class="ss-eyebrow">Build-along · 5 chapters · about 10 minutes</p>
      <h1>Build a store, <span class="ss-mark">one line at a time.</span></h1>
      <p class="ln-lede">Scroll the chapters. The panel on the right is the real engine running the spec as it grows, so every idea lands on screen the moment you read it.</p>
    </header>

    <div class="ln-grid">
      <div class="ln-chapters">
        <nav class="ln-rail" aria-label="Chapters">
          <button v-for="(c, i) in chapters" :key="c.id" type="button" :aria-current="i === current ? 'step' : undefined" :class="{ done: i < current }" :aria-label="`Chapter ${i + 1}: ${c.title}`" @click="go(i)">{{ i + 1 }}</button>
        </nav>
        <section v-for="(c, i) in chapters" :id="c.id" :key="c.id" ref="sections" :data-index="i" class="ln-ch" :class="{ on: i === current }" :aria-labelledby="`ch-${c.id}`">
          <p class="ln-num">Chapter {{ i + 1 }} of {{ chapters.length }}</p>
          <h2 :id="`ch-${c.id}`">{{ c.title }}</h2>
          <p class="ln-body">{{ c.body }}</p>
          <ul class="ln-adds" aria-label="Adds">
            <li v-for="a in c.adds" :key="a"><code>{{ a }}</code></li>
          </ul>
          <p class="ln-try"><strong>Try it:</strong> {{ c.tryIt }}</p>
          <p class="ln-more">Go deeper: <template v-for="(m, k) in c.more" :key="m.link"><a :href="withBase(m.link + '.html').replace('/.html', '/')">{{ m.text }}</a><span v-if="k < c.more.length - 1"> · </span></template></p>
        </section>
        <section class="ln-end" aria-label="What's next">
          <h2>That's a store in {{ chapters[chapters.length - 1]!.spec.split("\n").length }} lines.</h2>
          <p>A model writes lines like these from a plain request, and SayShape draws each one as it arrives.</p>
          <div class="ln-end-links">
            <a class="loom-btn primary" :href="withBase('/docs/elements/')">Browse all 48 elements</a>
            <a class="loom-btn quiet" :href="withBase('/examples/')">See bigger examples</a>
          </div>
        </section>
      </div>

      <aside class="ln-panel" aria-label="Live result">
        <div class="ln-spec ss-card">
          <div class="ln-bar">
            <span class="ss-eyebrow">Spec so far · {{ lines.length }} lines</span>
            <span class="ln-key"><span class="sw" aria-hidden="true"></span>new in this chapter</span>
          </div>
          <pre class="spec-view numbered ln-pre" tabindex="0" :aria-label="`Spec for chapter ${current + 1}`"><code><span v-for="(l, i) in lines" :key="`${current}-${i}`" class="line" :class="{ fresh: l.fresh }" v-html="l.html"></span></code></pre>
        </div>
        <div class="ln-live">
          <div class="ln-bar">
            <span class="ss-eyebrow">Result · chapter {{ current + 1 }}</span>
            <span class="ln-actions">
              <button type="button" class="loom-btn-text" :disabled="!loom" @click="restart">Start over</button>
              <a class="loom-btn-text" :href="playgroundHref">Open in playground</a>
            </span>
          </div>
          <div class="loom-stage ln-stage">
            <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`The store after chapter ${current + 1}, drawn on a canvas`"></canvas></div>
            <p v-if="failed" class="loom-live__failed">The preview couldn't start: {{ failed }}</p>
          </div>
          <dl class="ln-state" aria-label="State right now">
            <div v-for="[k, v] in stateView" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></div>
          </dl>
          <ol v-if="events.length" class="loom-events" aria-live="polite" aria-label="Events">
            <li v-for="e in events" :key="e.id"><code>{{ e.text }}</code></li>
          </ol>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.learn { max-width: 1360px; margin: 0 auto; padding: 48px 24px 120px }
.ln-head { display: grid; gap: 14px; max-width: 900px; padding-bottom: 28px; border-bottom: 2px solid var(--ss-rule) }
.ln-head h1 { margin: 0; font: 800 clamp(40px, 6vw, 76px)/0.98 var(--loom-display); letter-spacing: -0.045em; text-wrap: balance }
.ln-lede { margin: 0; max-width: 58ch; font-size: 18px; line-height: 1.55; color: var(--vp-c-text-2) }

.ln-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 48px; align-items: start }
.ln-chapters { position: relative; padding-left: 64px }
.ln-rail { position: sticky; top: calc(var(--vp-nav-height) + 40px); float: left; margin-left: -64px; display: grid; gap: 10px; padding-top: 52px }
.ln-rail button { width: 36px; height: 36px; border-radius: 999px; border: 1.5px solid var(--vp-c-divider); font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-1) }
.ln-rail button.done { background: var(--ss-mark-soft); border-color: transparent }
.ln-rail button[aria-current="step"] { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: var(--vp-button-brand-text) }

.ln-ch { min-height: 78vh; padding: 52px 0 24px; display: grid; gap: 14px; align-content: start; opacity: 0.38; transition: opacity 0.3s }
.ln-ch.on { opacity: 1 }
.ln-num { margin: 0; font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-3) }
.ln-ch h2 { margin: 0; font: 800 clamp(30px, 3.4vw, 44px)/1.04 var(--loom-display); letter-spacing: -0.035em; text-wrap: balance }
.ln-body { margin: 0; font-size: 18px; line-height: 1.6; color: var(--vp-c-text-2); max-width: 46ch }
.ln-adds { list-style: none; margin: 0; padding: 4px 0 4px 14px; border-left: 3px solid var(--ss-mark); display: grid; gap: 4px }
.ln-adds code { background: none; padding: 0; font-size: 14px; color: var(--vp-c-brand-1) }
.ln-try { margin: 0; font-size: 16px; color: var(--vp-c-text-1) }
.ln-more { margin: 0; font-size: 14px; color: var(--vp-c-text-3) }
.ln-more a { font-weight: 600 }
.ln-end { padding: 60px 0 0; display: grid; gap: 14px }
.ln-end h2 { margin: 0; font: 800 36px/1.05 var(--loom-display); letter-spacing: -0.03em }
.ln-end p { margin: 0; font-size: 17px; color: var(--vp-c-text-2); max-width: 46ch }
.ln-end-links { display: flex; flex-wrap: wrap; gap: 12px; padding-top: 8px }

.ln-panel { position: sticky; top: calc(var(--vp-nav-height) + 24px); display: grid; gap: 16px; padding-top: 40px; max-height: calc(100vh - var(--vp-nav-height) - 32px); overflow-y: auto }
.ln-spec { overflow: hidden }
.ln-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 16px 8px }
.ln-key { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vp-c-text-3) }
.ln-key .sw { width: 14px; height: 10px; border-radius: 3px; background: var(--ss-mark-soft); box-shadow: inset 0 0 0 1px var(--ss-mark) }
.ln-pre { padding: 0 16px 14px; overflow-x: auto; font-size: 12.5px }
.ln-pre :deep(.line) { white-space: pre-wrap; word-break: break-word; padding-left: 3.7em; text-indent: -3.7em; border-radius: 3px }
.ln-pre .fresh { background: var(--ss-mark-soft); animation: glow 0.9s ease-out }
@keyframes glow { from { background: var(--ss-mark) } }
.ln-live { border: 1.5px solid var(--vp-c-divider); border-radius: 16px; overflow: hidden; background: var(--ss-card) }
.ln-actions { display: inline-flex; gap: 16px }
.ln-stage { min-height: 200px }
.ln-state { margin: 0; padding: 10px 16px 12px; display: grid; gap: 4px; font: 12px var(--vp-font-family-mono); border-top: 1px solid var(--vp-c-divider) }
.ln-state div { display: flex; gap: 8px; min-width: 0 }
.ln-state dt { color: var(--vp-c-text-3); flex: none }
.ln-state dd { margin: 0; color: var(--vp-c-brand-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

@media (max-width: 900px) {
  .ln-grid { grid-template-columns: 1fr; gap: 0 }
  /* On a phone the result is pinned to the bottom of the screen, under the chapter being read. */
  .ln-panel { top: auto; bottom: 0; z-index: 5; padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--vp-c-bg); max-height: 46vh; border-top: 2px solid var(--ss-rule) }
  .ln-live .ln-state, .ln-live .loom-events { display: none }
  .ln-spec { display: none }
  .ln-chapters { padding-left: 0 }
  .ln-rail { display: none }
  .ln-ch { min-height: 60vh; padding-top: 32px }
}
@media (prefers-reduced-motion: reduce) { .ln-ch, .ln-pre .fresh { transition: none; animation: none } }
</style>
