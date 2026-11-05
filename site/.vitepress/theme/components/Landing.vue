<script setup lang="ts">
/**
 * The landing page. Show, don't explain: ask a sample spreadsheet a question
 * and see the answer, with and without SayShape. Three reasons in one line
 * each, a pointer to the three-way comparison, and one way to start.
 * Anything longer lives in the build-along and the docs.
 */
import { withBase } from "vitepress";
import DataDemo from "./DataDemo.vue";
import { generationAvailable, MODEL_LABEL } from "../sayshape/generate";

const reasons = [
  { title: "Private", text: "Your AI sees column names and a few rows. The rest never leaves the browser." },
  { title: "Safe", text: "Nothing in it can run code." },
  { title: "Instant", text: "The answer appears while the AI is still writing." },
];

const formats = [
  { name: "SayShape", text: "Lines of text, drawn as each one arrives.", ours: true },
  { name: "HTML", text: "Code in a sandbox, shown as markup arrives.", ours: false },
  { name: "A2UI", text: "JSON messages, drawn once each is complete.", ours: false },
];

const href = (p: string) => withBase(p);
</script>

<template>
  <div class="landing">
    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" class="hero-title">Ask your data.<br><span class="ss-mark">See the answer.</span></h1>
      <div class="hero-side">
        <p class="hero-lede">Your AI writes a few lines. SayShape draws the answer in the browser. Your rows stay with you.</p>
        <div class="hero-cta">
          <a class="sayshape-btn primary" href="#demo">Try it below ↓</a>
          <a class="sayshape-btn quiet" :href="href('/learn/')">Start the build-along</a>
        </div>
        <a class="hero-status" :href="href('/docs/architecture/limitations.html')">v0.1 · not screen-reader ready yet · Status</a>
      </div>
    </section>

    <DataDemo />
    <p class="made-up">
      The sample spreadsheets are made up. Their suggested questions replay saved answers, drawn live by the engine.
      <template v-if="generationAvailable">Anything you type, and any question about your own file, is answered live by {{ MODEL_LABEL }}.</template>
    </p>

    <section class="why" aria-label="Why SayShape">
      <div v-for="r in reasons" :key="r.title" class="why-item">
        <h2>{{ r.title }}</h2>
        <p>{{ r.text }}</p>
      </div>
    </section>

    <section class="formats" aria-labelledby="formats">
      <div class="formats-head">
        <h2 id="formats">Same request. Three formats.</h2>
        <a :href="href('/compare')">Watch the comparison →</a>
      </div>
      <div class="formats-grid">
        <a v-for="f in formats" :key="f.name" class="format" :class="{ ours: f.ours }" :href="href('/compare')">
          <span class="format-name">{{ f.name }}</span>
          <span class="format-text">{{ f.text }}</span>
        </a>
      </div>
    </section>

    <section class="start" aria-labelledby="start">
      <h2 id="start">Try it in <span class="ss-mark">10 minutes.</span></h2>
      <div class="start-links">
        <a class="sayshape-btn primary" :href="href('/learn/')">Start the build-along →</a>
        <a class="sayshape-btn quiet" :href="href('/playground.html')">Open the playground</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing { max-width: 1320px; margin: 0 auto; padding: 40px 32px 72px }

.hero { display: grid; grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); gap: 24px 48px; align-items: end; margin-bottom: 40px }
.hero-title { margin: 0; font: 800 clamp(56px, 8.4vw, 120px)/0.9 var(--sayshape-display); letter-spacing: -0.055em; color: var(--vp-c-text-1) }
.hero-side { display: grid; gap: 18px; padding-bottom: 8px }
.hero-lede { margin: 0; font-size: 19px; line-height: 1.5; color: var(--vp-c-text-2); text-wrap: pretty }
.hero-cta { display: flex; flex-wrap: wrap; gap: 10px }
.hero-status { justify-self: start; font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); text-decoration: none; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; padding: 6px 12px }
.hero-status:hover { border-color: var(--ss-rule); color: var(--vp-c-text-1) }

.made-up { margin: 18px 0 0; font-size: 13px; color: var(--vp-c-text-2) }

.why { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 40px; margin-top: 48px; padding: 32px 0; border-top: 2px solid var(--ss-rule) }
.why h2 { margin: 0; padding: 0; border: 0; font: 800 clamp(28px, 3.2vw, 40px)/1 var(--sayshape-display); letter-spacing: -0.035em }
.why p { margin: 10px 0 0; font-size: 18px; line-height: 1.45; color: var(--vp-c-text-2) }

.formats { display: flex; flex-direction: column; gap: 20px; padding-top: 36px; border-top: 2px solid var(--ss-rule) }
.formats-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px 16px }
.formats-head h2 { margin: 0; padding: 0; border: 0; font: 800 clamp(32px, 4vw, 52px)/1 var(--sayshape-display); letter-spacing: -0.04em }
.formats-head a { flex: none; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none }
.formats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px }
.format { display: flex; flex-direction: column; gap: 6px; padding: 20px; border: 1.5px solid var(--vp-c-divider); border-radius: 16px; background: var(--ss-card); color: var(--vp-c-text-1); text-decoration: none; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s }
.format.ours { border: 2px solid var(--ss-rule); background: var(--ss-mark-soft) }
.format:hover, .format:focus-visible { border-color: var(--ss-rule); box-shadow: 5px 5px 0 var(--ss-shadow); transform: translate(-2px, -2px) }
.format-name { font: 800 26px/1.1 var(--sayshape-display); letter-spacing: -0.02em }
.format-text { color: var(--vp-c-text-2) }

.start { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px 40px; margin-top: 56px; padding-top: 36px; border-top: 2px solid var(--ss-rule) }
.start h2 { margin: 0; padding: 0; border: 0; font: 800 clamp(34px, 4.6vw, 60px)/1 var(--sayshape-display); letter-spacing: -0.045em }
.start-links { display: flex; flex-wrap: wrap; gap: 10px }

@media (max-width: 960px) {
  .landing { padding: 28px 20px 56px }
  .hero, .why, .formats-grid { grid-template-columns: minmax(0, 1fr) }
}
@media (prefers-reduced-motion: reduce) { .format { transition: none } .format:hover { transform: none } }
</style>
