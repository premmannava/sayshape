<script setup lang="ts">
/**
 * The chat page: a visitor asks, a live model answers in SayShape, and each
 * answer is drawn in the thread as it streams, then stays live. One brand
 * color recolors every answer and the chat around them, so the page reads as
 * the visitor's own assistant.
 *
 * Questions go to the model proxy in worker/ (chatClient.ts), which holds the
 * key and writes every message. A follow-up sends the first question, the
 * follow-ups since and the latest answer's spec (chat.ts); older answers'
 * specs never leave the page. Chats stop at MAX_ANSWERS answers.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { withBase } from "vitepress";
import type { RefineContext } from "@sayshape/model/context";
import { normalizeHex } from "../../../../playground/appearance/color";
import ChatAnswer from "./ChatAnswer.vue";
import { isSiteDark } from "../sayshape/runtime";
import {
  advance, applyEvent, canAsk, chatTheme, failure, frameColors, isBusy, MAX_ANSWERS, MAX_MESSAGE_CHARS, newTurn, requestBody, restart,
  SUGGESTIONS, type Failure, type PageColors, type Turn,
} from "../sayshape/chat";
import { configured, fetchStatus, humanCheck, MODEL_LABEL, needsHumanCheck, send } from "../sayshape/chatClient";

const turns = ref<Turn[]>([]);
const draft = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const checkEl = ref<HTMLElement | null>(null);
/** The visitor's brand color; null until they pick one. */
const accent = ref<string | null>(null);
const dark = ref(false);
const page = shallowRef<PageColors>({ bg: "#f9f7f2", card: "#ffffff" });
/** Why nothing can be asked right now (answers off, today's used up, no proxy), if anything. */
const blocked = ref<Failure | null>(configured ? null : failure("unconfigured"));
const model = ref(MODEL_LABEL);

let context: RefineContext | null = null;
/** Whether a good answer exists to follow up on (the context is plain data, so this mirrors it for the template). */
const following = ref(false);
let controller: AbortController | null = null;
let statusAsked = false;
let check: ReturnType<typeof humanCheck> | null = null;

const last = computed(() => turns.value[turns.value.length - 1]);
const busy = computed(() => isBusy(last.value));
const full = computed(() => !canAsk(turns.value));
const canSend = computed(() => !blocked.value && !busy.value && !full.value && !!draft.value.trim());

// ---------------------------------------------------------------- colors

const theme = computed(() => chatTheme(dark.value ? "dark" : "light", accent.value, page.value));
/** The chat frame takes the brand color once one is picked; until then it's the site's ink and teal. */
const frame = computed(() => {
  const f = frameColors(accent.value, page.value.bg);
  return f ? { "--chat-fill": f.fill, "--chat-on-fill": f.onFill, "--chat-focus": f.fill } : {};
});
const swatch = computed(() => accent.value ?? normalizeHex(theme.value.colors.accent) ?? "#176f69");
function pickAccent(e: Event) {
  accent.value = normalizeHex((e.target as HTMLInputElement).value);
}

function readPage() {
  dark.value = isSiteDark();
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  page.value = { bg: v("--vp-c-bg", dark.value ? "#11131c" : "#f9f7f2"), card: v("--ss-card", dark.value ? "#191c28" : "#ffffff") };
}
// ---------------------------------------------------------------- following the answer

/**
 * The page moves only when the answer needs room: as it grows past the
 * question box, the page scrolls just enough to keep its newest part in
 * sight, and stops once the question would leave the top. The header stays
 * put while there's room, and scrolling yourself stops the following.
 */
const threadEl = ref<HTMLElement | null>(null);
const dockEl = ref<HTMLElement | null>(null);
let tracking = false;

function keepAnswerInView() {
  const t = last.value;
  const dock = dockEl.value;
  const el = t && document.getElementById(`chat-turn-${t.id}`);
  if (!tracking || !el || !dock) return;
  const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vp-nav-height")) || 64;
  const box = el.getBoundingClientRect();
  const hidden = box.bottom - (dock.getBoundingClientRect().top - 8);
  // Never scroll the question itself out of sight above.
  const room = box.top - (nav + 12);
  const by = Math.min(hidden, room);
  if (by > 1) window.scrollBy({ top: by, behavior: "auto" });
  if (!isBusy(t)) tracking = false;
}

const stopFollowing = () => { tracking = false; };
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);
function onKeyScroll(e: KeyboardEvent) {
  const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
  if (!typing && SCROLL_KEYS.has(e.key)) tracking = false;
}

let observer: MutationObserver | null = null;
let resize: ResizeObserver | null = null;
onMounted(() => {
  readPage();
  observer = new MutationObserver(readPage);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // The canvas grows a frame after each line arrives, so follow the thread's size, not the text.
  resize = new ResizeObserver(() => keepAnswerInView());
  if (threadEl.value) resize.observe(threadEl.value);
  window.addEventListener("wheel", stopFollowing, { passive: true });
  window.addEventListener("touchmove", stopFollowing, { passive: true });
  window.addEventListener("keydown", onKeyScroll);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  window.removeEventListener("wheel", stopFollowing);
  window.removeEventListener("touchmove", stopFollowing);
  window.removeEventListener("keydown", onKeyScroll);
  observer?.disconnect();
  controller?.abort();
  check?.destroy();
});

// ---------------------------------------------------------------- getting ready

/**
 * When someone starts to ask: is the proxy on, and the human check. Nothing
 * is fetched while the page only loads.
 */
function getReady() {
  if (!configured || statusAsked) return;
  statusAsked = true;
  void fetchStatus().then((s) => {
    if (!s) return;
    if (s.enabled) { if (s.model) model.value = s.model; }
    else blocked.value = s.failure;
  });
  if (needsHumanCheck && checkEl.value) {
    check = humanCheck(checkEl.value);
    void check.start().catch(() => {});
  }
}

// ---------------------------------------------------------------- asking

async function ask(question: string, existing?: Turn) {
  const message = question.trim();
  if (!message || blocked.value || busy.value) return;
  if (!existing && full.value) return;
  getReady();
  const turn = existing ?? reactive(newTurn(message)) as Turn;
  if (!existing) {
    turns.value.push(turn);
    draft.value = "";
  }
  tracking = true;
  await nextTick();
  keepAnswerInView();
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const body = requestBody(context, message);

  try {
    const token = needsHumanCheck && check ? await check.take() : undefined;
    if (signal.aborted) return;
    const refused = await send(body, {
      token,
      signal,
      onEvent: (e) => {
        const spec = applyEvent(turn, e);
        if (spec) { context = advance(context, message, spec); following.value = !!context; }
      },
    });
    if (refused) {
      turn.status = "failed";
      turn.failure = refused;
      if (refused.blocksChat) blocked.value = refused;
    } else if (isBusy(turn)) {
      // The stream ended without a done or error event.
      turn.status = "failed";
      turn.failure = failure("model");
    }
  } catch (e) {
    if (signal.aborted) {
      if (isBusy(turn)) turn.status = "stopped";
    } else {
      turn.status = "failed";
      turn.failure = failure(e instanceof Error && /human check/.test(e.message) ? "check" : "network");
    }
  }
}

function submit() {
  if (canSend.value) void ask(draft.value);
}

function onKeydown(e: KeyboardEvent) {
  // Enter sends; Shift+Enter starts a new line.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}

function stop() {
  controller?.abort();
}

function retry(turn: Turn) {
  restart(turn);
  void ask(turn.question, turn);
}

function newChat() {
  controller?.abort();
  controller = null;
  // Unmounting the answers destroys their engines.
  turns.value = [];
  context = null;
  following.value = false;
  draft.value = "";
  // A refusal that blocks every chat (answers off, today's used up) still holds.
  if (blocked.value && !blocked.value.blocksChat) blocked.value = null;
  void nextTick(() => input.value?.focus());
}

/** The textarea grows with what's typed, up to a few lines. */
watch(draft, () => nextTick(() => {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}));

const playground = withBase("/playground");
const examples = withBase("/examples/");
</script>

<template>
  <div class="chat" :style="frame">
    <header class="chat-head">
      <div class="chat-title">
        <h1>Ask it. <em>See it.</em></h1>
        <p>A live model answers in SayShape, drawn as it writes. Pick your brand color and the whole chat takes it.</p>
      </div>
      <div class="chat-tools">
        <label class="chat-color" title="Your brand color. Every answer and the chat around them take it; the specs don't change.">
          <input type="color" :value="swatch" aria-label="Your brand color" @input="pickAccent">
          <span>{{ accent ? "Your color" : "Brand color" }}</span>
          <code v-if="accent">{{ accent }}</code>
        </label>
        <button v-if="accent" type="button" class="chat-text-btn" @click="accent = null">Reset</button>
        <button type="button" class="sayshape-btn quiet small" :disabled="!turns.length" @click="newChat">New chat</button>
      </div>
    </header>

    <section ref="threadEl" class="chat-thread" aria-label="Conversation">
      <div v-if="!turns.length" class="chat-empty">
        <p class="ss-eyebrow">Live model</p>
        <h2>What would your assistant show?</h2>
        <p class="chat-empty-note">Ask the way you'd ask your company's assistant. The model has no data of its own, so it makes up example figures and says so.</p>
        <ul class="chat-suggest" aria-label="Suggested questions">
          <li v-for="s in SUGGESTIONS" :key="s.question">
            <button type="button" :disabled="!!blocked" @focus="getReady" @pointerenter="getReady" @click="ask(s.question)">
              <span class="chat-suggest-label">{{ s.label }}</span>
              <span>{{ s.question }}</span>
            </button>
          </li>
        </ul>
      </div>

      <article v-for="t in turns" :id="`chat-turn-${t.id}`" :key="t.id" class="chat-turn" :aria-label="`Question: ${t.question}`">
        <p class="chat-q">{{ t.question }}</p>
        <ChatAnswer :turn="t" :theme="theme" :latest="t === last" @retry="retry(t)" />
      </article>
    </section>

    <div ref="dockEl" class="chat-dock">
      <div v-if="blocked" class="chat-notice" role="status">
        <!-- When the last question was refused for this reason, its answer already says so. -->
        <p v-if="last?.failure !== blocked">{{ blocked.message }}</p>
        <p v-if="blocked.kind === 'unconfigured'" class="chat-dev">Building the site yourself? Set <code>VITE_SAYSHAPE_MODEL_ENDPOINT</code> to the model proxy; see <code>worker/README.md</code>.</p>
        <p v-else><a :href="playground">Open the playground</a> or <a :href="examples">see the examples</a>.</p>
      </div>
      <div v-else-if="full" class="chat-notice" role="status">
        <p>That's {{ MAX_ANSWERS }} answers, as long as demo chats go. Start a new chat to keep asking.</p>
        <button type="button" class="sayshape-btn quiet small" @click="newChat">New chat</button>
      </div>

      <form class="chat-composer" :class="{ disabled: !!blocked || full }" @submit.prevent="submit">
        <label for="chat-input" class="chat-sr">{{ following ? "Ask a follow-up" : "Ask a question" }}</label>
        <textarea
          id="chat-input"
          ref="input"
          v-model="draft"
          rows="1"
          :maxlength="MAX_MESSAGE_CHARS"
          :disabled="!!blocked || full"
          :placeholder="following ? 'Ask a follow-up…' : 'Ask anything…'"
          enterkeyhint="send"
          @focus="getReady"
          @keydown="onKeydown"
        ></textarea>
        <button v-if="busy" type="button" class="chat-send stop" aria-label="Stop the answer" @click="stop">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
        </button>
        <button v-else type="submit" class="chat-send" :disabled="!canSend" aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </form>
      <div ref="checkEl" class="chat-check"></div>
      <p class="chat-fine">
        <template v-if="model && !blocked">Answered by {{ model }} through SayShape's server. </template>
        Don't share anything private.<span class="chat-keys"> Enter sends; Shift+Enter starts a new line.</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.chat {
  /* The chat frame's colors: the site's ink and teal until a brand color is picked (see frameColors). */
  --chat-fill: var(--vp-c-text-1);
  --chat-on-fill: var(--vp-c-bg);
  --chat-focus: var(--vp-c-brand-1);
  --chat-w: 880px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: calc(var(--chat-w) + 2 * var(--ss-gutter));
  min-height: calc(100vh - var(--vp-nav-height, 64px));
  margin: 0 auto;
  padding: 24px var(--ss-gutter) 0;
}
.chat :focus-visible { outline-color: var(--chat-focus) }

/* ---------------------------------------------------------------- header: as quiet as the playground's */
.chat-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; padding-bottom: 14px; border-bottom: 1px solid var(--vp-c-divider) }
.chat-title { flex: 1 1 360px }
.chat-title h1 { margin: 0; font: 600 clamp(26px, 2.6vw, 34px)/1.1 var(--sayshape-display); letter-spacing: -0.02em }
.chat-title h1 em { font-style: italic; color: var(--ss-coral) }
.chat-title p { margin: 6px 0 0; max-width: 62ch; font-size: 14.5px; line-height: 1.5; color: var(--vp-c-text-2) }
.chat-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.chat-color { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 5px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); font: 500 13px var(--vp-font-family-base); color: var(--vp-c-text-1); cursor: pointer }
.chat-color:focus-within { outline: 2px solid var(--chat-focus); outline-offset: 2px }
.chat-color input { width: 24px; height: 24px; padding: 0; border: 0; background: none; cursor: pointer }
.chat-color input:focus-visible { outline: none }
.chat-color input::-webkit-color-swatch-wrapper { padding: 0 }
.chat-color input::-webkit-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.chat-color input::-moz-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.chat-color code { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); background: none; padding: 0 }
.chat-text-btn { min-height: 34px; padding: 0 4px; border: 0; background: none; font: 600 13px var(--vp-font-family-base); color: var(--vp-c-text-2); text-decoration: underline; text-underline-offset: 3px; cursor: pointer }
.chat-text-btn:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; border-radius: 4px }

/* ---------------------------------------------------------------- the thread */
.chat-thread { flex: 1; display: flex; flex-direction: column; gap: 36px; padding: 28px 0 24px }
.chat-turn { display: flex; flex-direction: column; gap: 14px; scroll-margin-top: calc(var(--vp-nav-height, 64px) + 16px) }
/* The visitor's message: the one filled shape in the thread, in their color once they pick one. */
.chat-q {
  align-self: flex-end;
  max-width: min(72%, 560px);
  margin: 0;
  padding: 10px 16px;
  border-radius: 20px 20px 6px 20px;
  background: var(--chat-fill);
  color: var(--chat-on-fill);
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-empty { margin: auto 0; padding: clamp(16px, 6vh, 64px) 0 }
.chat-empty h2 { margin: 6px 0 10px; font: 600 clamp(28px, 3.4vw, 42px)/1.08 var(--sayshape-display); letter-spacing: -0.02em; text-wrap: balance }
.chat-empty-note { margin: 0 0 22px; max-width: 58ch; font-size: 15.5px; line-height: 1.55; color: var(--vp-c-text-2) }
.chat-suggest { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none }
.chat-suggest button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  height: 100%;
  min-height: 44px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--ss-card);
  color: var(--vp-c-text-1);
  font: 500 15px/1.4 var(--vp-font-family-base);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.chat-suggest button:hover:not([disabled]) { border-color: var(--vp-c-border); box-shadow: var(--ss-lift-sm) }
.chat-suggest button:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px }
.chat-suggest button[disabled] { opacity: 0.55; cursor: not-allowed }
.chat-suggest-label { font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--vp-c-text-2) }

/* ---------------------------------------------------------------- the dock: notices, the box, the fine print */
.chat-dock {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 0 14px;
  background: linear-gradient(to bottom, transparent, var(--vp-c-bg) 22px);
}
.chat-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 10px 14px; border-radius: 12px; background: var(--vp-c-bg-alt); font-size: 14px; line-height: 1.5 }
.chat-notice p { margin: 0; flex: 1 1 100% }
.chat-notice p:first-of-type:not(:last-of-type) { color: var(--vp-c-text-1); font-weight: 600 }
.chat-notice p + p { color: var(--vp-c-text-2) }
.chat-notice a { color: var(--vp-c-brand-1); font-weight: 600; text-underline-offset: 3px }
.chat-notice .sayshape-btn { flex: none }
.chat-notice:has(.sayshape-btn) p { flex: 1 1 260px }
.chat-dev code { font-size: 12.5px }

.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 7px 7px 7px 18px;
  border: 1.5px solid var(--vp-c-border);
  border-radius: 26px;
  background: var(--ss-card);
  box-shadow: var(--ss-lift-sm);
}
.chat-composer:focus-within { border-color: var(--chat-focus); box-shadow: 0 0 0 1px var(--chat-focus), var(--ss-lift-sm) }
.chat-composer.disabled { opacity: 0.6; box-shadow: none }
.chat-composer textarea {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  max-height: 160px;
  padding: 8px 0;
  border: 0;
  background: none;
  resize: none;
  font: 15px/1.47 var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  outline: none;
}
.chat-composer textarea::placeholder { color: var(--vp-c-text-2) }
.chat-send {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: var(--chat-fill);
  color: var(--chat-on-fill);
  cursor: pointer;
  transition: opacity 0.15s;
}
.chat-send:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px }
.chat-send[disabled] { background: var(--vp-c-divider); color: var(--vp-c-text-2); cursor: default }
.chat-send.stop { background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.chat-check:empty { display: none }
.chat-fine { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--vp-c-text-2); text-align: center }
.chat-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }

@media (max-width: 640px) {
  .chat { padding-top: 16px }
  .chat-head { align-items: flex-start }
  .chat-q { max-width: 86% }
  .chat-suggest { grid-template-columns: 1fr }
  .chat-thread { gap: 28px }
  .chat-fine { text-align: left }
  .chat-keys { display: none }
}
</style>
