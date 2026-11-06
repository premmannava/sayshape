<script setup lang="ts">
/**
 * The landing page's hero demo: a chat where three different requests get
 * three different working screens. Each request types itself, the agent's
 * saved answer streams in the way a model's would and the real engine draws
 * it, then a cursor presses parts of it through the engine's own pointer
 * handling, so what you see changing is the screen working, not a video.
 * The refund form's Submit sends its answer back, and the agent replies.
 *
 * Nothing is generated: the specs are in site/examples/hero-scenes.ts.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { heroScenes, type Tap } from "../../../examples/hero-scenes";
import { useSayShape } from "../sayshape/useSayShape";
import { prefersReducedMotion, replayStream, type SayShape } from "../sayshape/runtime";

const active = ref(0);
const typed = ref("");
const phase = ref<"asking" | "writing" | "using" | "done">("asking");
const lines = ref(0);
const reply = ref("");
const cursor = ref<{ x: number; y: number; on: boolean; pressing: boolean }>({ x: 0, y: 0, on: false, pressing: false });
const root = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const scene = computed(() => heroScenes[active.value]!);
let run = { cancelled: false };
let auto = true;

const wait = (ms: number, mine: { cancelled: boolean }) =>
  new Promise<boolean>((done) => setTimeout(() => done(!mine.cancelled), ms));

const { sayshape } = useSayShape(
  canvas,
  (l) => {
    const off = l.on("action", (e) => {
      const s = scene.value;
      if (s.reply && e.name !== "save_plan") setTimeout(() => { if (scene.value === s) reply.value = s.reply!; }, 450);
    });
    void play(0);
    return off;
  },
  { lazy: root },
);

/** Where a part of an element is, in the stage's coordinates, from the engine's own hit regions. */
function target(l: SayShape, t: Tap): { x: number; y: number } | null {
  const regions = l.hitRegions.filter((h) => h.box.node.type === t.type);
  const ids = [...new Set(regions.map((h) => h.box.node.id))];
  const id = ids[t.nth ?? 0];
  const hit = regions.find((h) => h.box.node.id === id && (t.detail === undefined || h.detail === t.detail));
  if (!hit || !canvas.value || !stage.value) return null;
  const c = canvas.value.getBoundingClientRect();
  const s = stage.value.getBoundingClientRect();
  return { x: c.left - s.left + hit.box.x + hit.box.w / 2, y: c.top - s.top + hit.box.y + hit.box.h / 2 };
}

/** Press a point on the canvas through the same pointer events a mouse sends. */
function press(x: number, y: number) {
  const c = canvas.value;
  const s = stage.value;
  if (!c || !s) return;
  const r = s.getBoundingClientRect();
  const at = { clientX: r.left + x, clientY: r.top + y, pointerId: 1, bubbles: true, isPrimary: true, pointerType: "mouse" };
  c.dispatchEvent(new PointerEvent("pointerdown", at));
  c.dispatchEvent(new PointerEvent("pointerup", at));
}

async function play(i: number) {
  const l = sayshape.value;
  if (!l) return;
  run.cancelled = true;
  const mine = (run = { cancelled: false });
  active.value = i;
  const s = heroScenes[i]!;
  const still = prefersReducedMotion();
  reply.value = "";
  cursor.value = { ...cursor.value, on: false, pressing: false };
  lines.value = 0;

  // 1 · The person asks.
  phase.value = "asking";
  l.setSpec("", { resetState: true });
  if (still) typed.value = s.ask;
  else {
    typed.value = "";
    for (let n = 1; n <= s.ask.length; n++) {
      typed.value = s.ask.slice(0, n);
      if (!(await wait(26, mine))) return;
    }
    if (!(await wait(380, mine))) return;
  }

  // 2 · The agent writes; the engine draws each line as it lands.
  phase.value = "writing";
  const ok = await replayStream(l, s.spec, { signal: mine, instant: still, onProgress: (shown) => { lines.value = shown.split("\n").length - (shown.endsWith("\n") ? 1 : 0); } });
  if (!ok) return;
  lines.value = s.spec.split("\n").length;

  // 3 · Someone uses it: the cursor presses real parts of the screen.
  phase.value = "using";
  if (!still) {
    if (!(await wait(700, mine))) return;
    for (const t of s.taps) {
      const p = target(l, t);
      if (!p) break;
      cursor.value = { x: p.x, y: p.y, on: true, pressing: false };
      if (!(await wait(720, mine))) return;
      cursor.value = { ...cursor.value, pressing: true };
      press(p.x, p.y);
      if (!(await wait(260, mine))) return;
      cursor.value = { ...cursor.value, pressing: false };
      if (!(await wait(620, mine))) return;
    }
    if (!(await wait(s.reply ? 900 : 300, mine))) return;
    cursor.value = { ...cursor.value, on: false };
  }
  phase.value = "done";
  if (!still && auto && (await wait(s.reply ? 2600 : 2200, mine))) void play((i + 1) % heroScenes.length);
}

function choose(i: number) {
  auto = false;
  void play(i);
}

onBeforeUnmount(() => { run.cancelled = true; });
</script>

<template>
  <div ref="root" class="sh">
    <div class="sh-window">
      <div class="sh-bar">
        <span class="sh-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="sh-title">Your AI agent</span>
        <span class="sh-meta" aria-live="off">{{ phase === "asking" ? "" : `${lines} lines written` }}</span>
      </div>

      <div class="sh-chat">
        <p class="sh-ask"><span>{{ typed }}<i v-if="phase === 'asking'" class="sh-caret" aria-hidden="true"></i></span></p>

        <div ref="stage" class="sh-answer" :class="{ shown: phase !== 'asking' }">
          <span class="sh-avatar" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.9L19 9.7l-4.1 3.2 1.4 5.1L12 15.2 7.7 18l1.4-5.1L5 9.7l5.2-1.8z" /></svg>
          </span>
          <div class="sh-screen">
            <div class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`The agent's answer to “${scene.ask}”, drawn by SayShape`"></canvas></div>
          </div>
          <span class="sh-cursor" :class="{ on: cursor.on, pressing: cursor.pressing }" :style="{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="var(--vp-c-text-1)" stroke="var(--ss-card)" stroke-width="1.6" stroke-linejoin="round" /></svg>
          </span>
        </div>

        <transition name="sh-reply">
          <p v-if="reply" class="sh-reply" role="status">{{ reply }}</p>
        </transition>
      </div>
    </div>

    <div class="sh-scenes" role="group" aria-label="Examples">
      <button v-for="(s, i) in heroScenes" :key="s.id" type="button" :aria-pressed="i === active" @click="choose(i)">
        <span>Ask for {{ s.caption.ask }}</span>
        <strong>get {{ s.caption.get }}</strong>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sh { display: flex; flex-direction: column; gap: 14px; min-width: 0 }
.sh-window { border: 2px solid var(--ss-rule); border-radius: 22px; background: var(--ss-card); box-shadow: 10px 10px 0 var(--ss-shadow); overflow: hidden }
.sh-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1.5px solid var(--vp-c-divider) }
.sh-dots { display: inline-flex; gap: 6px }
.sh-dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--vp-c-divider) }
.sh-title { font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.sh-meta { margin-left: auto; font: 12px var(--vp-font-family-mono); color: var(--vp-c-text-3) }

.sh-chat { display: flex; flex-direction: column; gap: 14px; min-height: 500px; padding: 20px; background: var(--vp-c-bg-alt) }
.sh-ask { align-self: flex-end; max-width: 85%; margin: 0; min-height: 46px }
.sh-ask span { display: inline-block; padding: 11px 16px; border-radius: 18px 18px 4px 18px; background: var(--vp-c-text-1); color: var(--ss-on-ink); font-size: 16px; line-height: 1.4 }
.sh-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -2px; background: currentColor; animation: sh-blink 1s steps(1) infinite }

.sh-answer { position: relative; display: flex; gap: 10px; align-items: flex-start; opacity: 0; transform: translateY(8px); transition: opacity 0.35s, transform 0.35s }
.sh-answer.shown { opacity: 1; transform: none }
.sh-avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; background: var(--vp-c-brand-1); color: var(--ss-card) }
.sh-screen { flex: 1; min-width: 0; border: 1.5px solid var(--vp-c-divider); border-radius: 4px 18px 18px 18px; background: var(--sayshape-stage); overflow: hidden }

.sh-cursor { position: absolute; left: 0; top: 0; margin: -3px 0 0 -4px; pointer-events: none; opacity: 0; transition: transform 0.65s cubic-bezier(0.3, 0.7, 0.2, 1), opacity 0.25s }
.sh-cursor.on { opacity: 1 }
.sh-cursor::after { content: ""; position: absolute; left: -10px; top: -10px; width: 28px; height: 28px; border-radius: 50%; background: var(--vp-c-brand-1); opacity: 0; transform: scale(0.4) }
.sh-cursor.pressing::after { animation: sh-ripple 0.5s ease-out }
.sh-cursor svg { position: relative; display: block; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25)) }

.sh-reply { align-self: flex-start; max-width: 85%; margin: 0 0 0 42px; padding: 11px 16px; border-radius: 4px 18px 18px 18px; background: var(--ss-card); border: 1.5px solid var(--vp-c-divider); font-size: 15px }
.sh-reply-enter-active { transition: opacity 0.35s, transform 0.35s }
.sh-reply-enter-from { opacity: 0; transform: translateY(6px) }

.sh-scenes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px }
.sh-scenes button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-height: 52px; padding: 8px 12px; border: 1.5px solid var(--vp-c-divider); border-radius: 12px; background: transparent; color: var(--vp-c-text-2); font-size: 13px; text-align: left; cursor: pointer; transition: border-color 0.15s, background 0.15s }
.sh-scenes button strong { color: var(--vp-c-text-1); font-size: 15px }
.sh-scenes button:hover { border-color: var(--ss-rule) }
.sh-scenes button[aria-pressed="true"] { border-color: var(--ss-rule); background: var(--ss-mark-soft) }

@keyframes sh-blink { 50% { opacity: 0 } }
@keyframes sh-ripple { 0% { opacity: 0.45; transform: scale(0.4) } 100% { opacity: 0; transform: scale(1.4) } }
@media (max-width: 560px) {
  .sh-chat { min-height: 520px; padding: 14px }
  .sh-scenes { grid-template-columns: minmax(0, 1fr) }
  .sh-reply { margin-left: 0 }
  .sh-window { box-shadow: 6px 6px 0 var(--ss-shadow) }
}
@media (prefers-reduced-motion: reduce) {
  .sh-answer, .sh-cursor, .sh-scenes button { transition: none }
  .sh-caret, .sh-cursor.pressing::after { animation: none }
}
</style>
