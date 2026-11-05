<script setup lang="ts">
/**
 * The landing page. Show, don't explain: the live hero, three reasons in one
 * line each, six examples running live, and one way to start. Anything
 * longer lives in the build-along and the docs.
 */
import { withBase } from "vitepress";
import { exampleById, type Example } from "../../../examples/catalog";
import Hero from "./Hero.vue";
import ExampleLive from "./ExampleLive.vue";

const reasons = [
  { title: "Safe", text: "Nothing in it can run code." },
  { title: "Private", text: "It draws in the browser. Your data stays with your AI." },
  { title: "Instant", text: "The screen appears while the AI is still writing." },
];

const picks = ["sales-this-week", "book-a-cabin", "trip-planner", "pick-a-laptop", "coffee-order", "order-tracking"]
  .map((id) => exampleById(id))
  .filter((e): e is Example => !!e);

const href = (p: string) => withBase(p);
</script>

<template>
  <div class="landing">
    <Hero />

    <section class="why" aria-label="Why SayShape">
      <div v-for="r in reasons" :key="r.title" class="why-item">
        <h2>{{ r.title }}</h2>
        <p>{{ r.text }}</p>
      </div>
    </section>

    <section class="build" aria-labelledby="build">
      <div class="build-head">
        <h2 id="build">What you can build</h2>
        <a :href="href('/examples/')">All examples →</a>
      </div>
      <div class="build-grid">
        <a v-for="e in picks" :key="e.id" class="build-card" :class="{ dark: e.look.scheme === 'dark' }" :href="href(`/examples/#${e.id}`)" :aria-label="`${e.title}: open the example`">
          <div class="build-live" inert><ExampleLive :example="e" /></div>
          <span class="build-title">{{ e.title }}</span>
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

.why { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 40px; padding: 32px 0; border-top: 2px solid var(--ss-rule) }
.why h2 { margin: 0; font: 800 clamp(28px, 3.2vw, 40px)/1 var(--sayshape-display); letter-spacing: -0.035em }
.why p { margin: 10px 0 0; font-size: 18px; line-height: 1.45; color: var(--vp-c-text-2) }

.build { padding: 40px 0 8px; border-top: 2px solid var(--ss-rule) }
.build-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 20px }
.build-head h2 { margin: 0; font: 800 clamp(32px, 4vw, 52px)/1 var(--sayshape-display); letter-spacing: -0.04em }
.build-head a { flex: none; white-space: nowrap; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none }
.build-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px }
.build-card { color: var(--vp-c-text-1); display: flex; flex-direction: column; border: 1.5px solid var(--vp-c-divider); border-radius: 18px; overflow: hidden; background: var(--ss-card); text-decoration: none; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s }
.build-card:hover, .build-card:focus-visible { border-color: var(--ss-rule); box-shadow: 5px 5px 0 var(--ss-shadow); transform: translate(-2px, -2px) }
/* A preview, not a control: the card itself is the link, so the canvas inside ignores the pointer. */
.build-live { height: 300px; overflow: hidden; pointer-events: none; -webkit-mask-image: linear-gradient(#000 78%, transparent); mask-image: linear-gradient(#000 78%, transparent) }
.build-title { padding: 12px 16px 14px; font: 800 20px/1.2 var(--sayshape-display); letter-spacing: -0.02em; border-top: 1px solid var(--vp-c-divider) }

.start { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px 40px; margin-top: 56px; padding-top: 36px; border-top: 2px solid var(--ss-rule) }
.start h2 { margin: 0; font: 800 clamp(34px, 4.6vw, 60px)/1 var(--sayshape-display); letter-spacing: -0.045em }
.start-links { display: flex; flex-wrap: wrap; gap: 10px }

@media (max-width: 960px) {
  .landing { padding: 28px 20px 56px }
  .why, .build-grid { grid-template-columns: minmax(0, 1fr) }
  .build-live { height: 240px }
}
@media (prefers-reduced-motion: reduce) { .build-card { transition: none } .build-card:hover { transform: none } }
</style>
