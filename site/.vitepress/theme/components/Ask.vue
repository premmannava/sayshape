<script setup lang="ts">
/**
 * "Ask the docs", in the nav on every page. A question is matched to a
 * curated answer (site/ask/answers.ts) and the answer is shown as a working
 * interface, its spec and where to read more. No model is called.
 */
import { computed, nextTick, ref, watch } from "vue";
import { withBase } from "vitepress";
import { match, suggestions, type Answer } from "../../../ask/answers";
import { highlightSpec } from "../loom/highlight";
import { createLoom, loomModules, toBase64Url, watchSiteTheme, type SayShape } from "../loom/runtime";

const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const question = ref("");
const asked = ref("");
const results = ref<Answer[]>([]);
const picked = ref(0);
const failed = ref("");

const answer = computed(() => results.value[picked.value] ?? null);
const others = computed(() => results.value.filter((_, i) => i !== picked.value));
const specHtml = computed(() => (answer.value ? highlightSpec(answer.value.spec) : ""));
const playgroundHref = computed(() => (answer.value ? withBase("/playground.html") + "#spec=" + toBase64Url(answer.value.spec) : ""));
const linkHref = (href: string) => withBase(href.endsWith("/") ? href : href + ".html");

let loom: SayShape | null = null;
let stopTheme: (() => void) | null = null;

async function open() {
  dialog.value?.showModal();
  await nextTick();
  input.value?.focus();
}
function close() { dialog.value?.close(); }
function onClose() {
  stopTheme?.(); stopTheme = null;
  loom?.destroy(); loom = null;
}

function ask(q = question.value) {
  question.value = q;
  asked.value = q.trim();
  results.value = asked.value ? match(asked.value) : [];
  picked.value = 0;
}

// Draw the chosen answer with the real engine. The canvas is only in the
// page while there is an answer, so the instance is made on first use.
watch(answer, async (a) => {
  if (!a) return;
  await nextTick();
  if (!canvas.value) return;
  try {
    if (!loom || loom.canvas !== canvas.value) {
      loom?.destroy(); stopTheme?.();
      loom = await createLoom(canvas.value, { today: "2026-10-21" });
      const mods = await loomModules();
      stopTheme = watchSiteTheme(loom, { light: mods.lightTheme, dark: mods.darkTheme });
    }
    loom.setSpec(a.spec, { resetState: true });
    failed.value = "";
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <button type="button" class="ask-trigger" aria-haspopup="dialog" @click="open">
    <span class="ask-trigger-k">Ask</span><span class="ask-trigger-t">how do I…</span>
  </button>

  <dialog ref="dialog" class="ask" aria-labelledby="ask-title" @close="onClose" @click.self="close">
    <div class="ask-panel">
      <form class="ask-form" @submit.prevent="ask()">
        <label id="ask-title" class="ss-eyebrow" for="ask-q">Ask the docs</label>
        <div class="ask-row">
          <input id="ask-q" ref="input" v-model="question" type="text" autocomplete="off" placeholder="how do I let people pick a quantity?" maxlength="160">
          <button type="submit" class="loom-btn primary small">Show me</button>
          <button type="button" class="ask-close" aria-label="Close" @click="close">×</button>
        </div>
      </form>

      <div v-if="!asked" class="ask-start">
        <p>Describe what you want on screen. You'll get a working answer, not a list of links.</p>
        <div class="ask-chips"><button v-for="s in suggestions" :key="s" type="button" @click="ask(s)">{{ s }}</button></div>
      </div>

      <div v-else-if="!answer" class="ask-start" role="status">
        <p>No answer for “{{ asked }}” yet. Try different words, or one of these:</p>
        <div class="ask-chips"><button v-for="s in suggestions" :key="s" type="button" @click="ask(s)">{{ s }}</button></div>
        <p class="ask-alt">Or browse <a :href="withBase('/docs/elements/')">all 48 elements</a>.</p>
      </div>

      <section v-else class="ask-answer" aria-live="polite">
        <h2>{{ answer.title }}</h2>
        <div class="ask-split">
          <pre class="spec-view ask-spec" tabindex="0" aria-label="Spec"><code v-html="specHtml"></code></pre>
          <div class="loom-stage ask-stage">
            <div class="loom-canvas-wrap"><canvas ref="canvas" :aria-label="`Live example: ${answer.title}`"></canvas></div>
            <p v-if="failed" class="loom-live__failed">The preview couldn't start: {{ failed }}</p>
          </div>
        </div>
        <p class="ask-note">{{ answer.note }}</p>
        <div class="ask-links">
          <a :href="linkHref(answer.link.href)" @click="close">Read more: {{ answer.link.text }} →</a>
          <a :href="playgroundHref" @click="close">Open in playground →</a>
        </div>
        <div v-if="others.length" class="ask-others">
          <span>Also close:</span>
          <button v-for="o in others" :key="o.id" type="button" @click="picked = results.indexOf(o)">{{ o.title }}</button>
        </div>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.ask-trigger { display: inline-flex; align-items: center; gap: 8px; height: 36px; margin-right: 12px; padding: 0 14px 0 6px; border: 1.5px solid var(--ss-rule); border-radius: 999px; font-size: 14px; color: var(--vp-c-text-1); background: var(--ss-card) }
.ask-trigger:hover { box-shadow: 3px 3px 0 var(--ss-shadow) }
.ask-trigger-k { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 8px; border-radius: 999px; background: var(--vp-c-brand-1); color: var(--vp-button-brand-text) }
.ask-trigger-t { color: var(--vp-c-text-2) }
@media (max-width: 1100px) { .ask-trigger-t { display: none } .ask-trigger { padding-right: 6px } }

.ask { box-sizing: border-box; width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 64px); overflow-x: hidden; padding: 0; border: 2px solid var(--ss-rule); border-radius: 20px; background: var(--ss-card); color: var(--vp-c-text-1); box-shadow: 6px 6px 0 var(--ss-shadow) }
.ask::backdrop { background: rgba(15, 26, 23, 0.45) }
.ask-panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 22px 24px 24px }
.ask-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0 }
.ask-row { display: flex; gap: 10px; align-items: center }
.ask-row input { flex: 1; min-width: 0; height: 46px; padding: 0 16px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; background: var(--vp-c-bg); font-size: 16px; color: var(--vp-c-text-1) }
.ask-row input:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: transparent }
.ask-close { width: 40px; height: 40px; flex: none; border-radius: 999px; border: 1.5px solid var(--vp-c-divider); font-size: 20px; color: var(--vp-c-text-1) }
.ask-start { display: grid; gap: 12px }
.ask-start p { margin: 0; color: var(--vp-c-text-2) }
.ask-chips { display: flex; flex-wrap: wrap; gap: 8px }
.ask-chips button, .ask-others button { padding: 8px 12px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font-size: 14px; color: var(--vp-c-text-1); background: var(--vp-c-bg); text-align: left }
.ask-chips button:hover, .ask-others button:hover { border-color: var(--ss-rule) }
.ask-alt a { font-weight: 600 }
.ask-answer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; min-width: 0 }
.ask-answer h2 { margin: 0; font: 800 28px/1.1 var(--loom-display); letter-spacing: -0.03em }
.ask-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start }
.ask-spec { margin: 0; padding: 12px 14px; background: var(--vp-c-bg); border-radius: 12px; overflow-x: auto; font-size: 12.5px }
.ask-spec :deep(.line) { white-space: pre-wrap; word-break: break-word }
.ask-stage { border-radius: 12px; min-height: 120px }
.ask-note { margin: 0; font-size: 15px; color: var(--vp-c-text-2) }
.ask-links { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 14px; font-weight: 600 }
.ask-others { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--vp-c-divider); font-size: 13px; color: var(--vp-c-text-3) }
@media (max-width: 680px) {
  .ask-split { grid-template-columns: minmax(0, 1fr) }
  .ask-panel { padding: 18px 16px 20px }
  .ask-row .loom-btn { padding: 0 12px }
}
</style>
