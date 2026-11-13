<script setup lang="ts">
/**
 * The landing page. It shows before it tells: the hero, the four showcases,
 * the mortgage calculator and the look switcher are all the real engine
 * drawing saved specs (site/examples/home.ts, checked by test/home.test.ts).
 * No model runs on this site.
 *
 * Claims are kept to what's true today: both packages are on npm (sayshape and
 * sayshape-mcp, checked from the registry by scripts/verify-pack.mjs); MCP Apps support differs by app; the engine
 * (not the MCP server) is the part with no dependencies; and with host data
 * the AI sees column names and a sample, not the rows.
 *
 * How to connect each app (the integrations card) follows mcp/README.md. Apps
 * that can't draw MCP Apps views (coding agents) get a page to open instead,
 * from sayshape-mcp 0.1.1 (mcp/src/fallback.ts). Claude on the web and ChatGPT
 * use SayShape's public server on Cloud Run (PUBLIC_MCP); there's no one-click
 * install or directory listing yet. App menu
 * paths and commands were checked on 2026-11-10 against each app's own docs
 * or CLI help (Claude's custom connectors article, ChatGPT's developer mode
 * article, Antigravity's MCP docs, `claude mcp add --help`, `codex mcp add`).
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import HomeHero from "./HomeHero.vue";
import HomeShowcases from "./HomeShowcases.vue";
import HomeControl from "./HomeControl.vue";
import LiveDemo from "./LiveDemo.vue";
import { mortgageLook, mortgageSpec } from "../../../examples/home";

const href = (p: string) => withBase(p);
const REPO = "https://github.com/premmannava/sayshape";

// ---------------------------------------------------------------- answers you can use

const mortgageChanges = ref(0);
let lastMortgage = 0;
// The spec's own starting values arrive as changes too; count only what a person does.
let touched = false;
function onMortgageTouch(e: Event) { if (e.isTrusted) touched = true; }
function onMortgageChange(key: string) {
  if (!touched || !["amount", "rate", "term"].includes(key)) return;
  const now = performance.now();
  if (now - lastMortgage > 500) mortgageChanges.value++;
  lastMortgage = now;
}

// ---------------------------------------------------------------- measured results
// Medians of the seven recordings the compare page plays
// (site/public/compare/anthropic_claude-sonnet-5.5): tokens are estimated as
// characters ÷ 4; time is until each answer finished. The headline ratios come
// from the unrounded medians (1,299 / 171 tokens; 13.18 s / 2.43 s).
const numbers = [
  { headline: 7.6, what: "fewer output tokens than HTML", note: "Median estimated output tokens per screen, across 7 recorded tasks", unit: "", digits: 0, accent: true, rows: [["SayShape", 171], ["A2UI", 628], ["HTML", 1299]] as const },
  { headline: 5.4, what: "faster for the model to finish writing", note: "Median time until the model's output was complete, across the same 7 tasks", unit: " s", digits: 1, accent: false, rows: [["SayShape", 2.4], ["HTML", 13.2], ["A2UI", 17.2]] as const },
];
// The numbers count up once, when they scroll into view. They start at their
// final values, so the built page (and reduced motion) shows the real numbers.
const progress = ref(1);
const numbersEl = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let frame = 0;
const ease = (t: number) => 1 - (1 - t) ** 3;
const fmt = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const counted = computed(() =>
  numbers.map((n) => {
    const k = ease(progress.value);
    const max = Math.max(...n.rows.map((r) => r[1]));
    return {
      ...n,
      shown: `${fmt(n.headline * k, 1)}×`,
      bars: n.rows.map(([name, v]) => ({ name, mine: name === "SayShape", value: `${fmt(v, n.digits)}${n.unit}`, width: `${Math.max(1.5, (v / max) * 100 * k)}%` })),
    };
  }),
);
const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
onMounted(() => {
  if (!numbersEl.value || typeof IntersectionObserver === "undefined" || still()) return;
  progress.value = 0;
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer?.disconnect();
    observer = null;
    const start = performance.now();
    const step = (now: number) => {
      progress.value = Math.min(1, (now - start) / 1400);
      if (progress.value < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }, { threshold: 0.25 });
  observer.observe(numbersEl.value);
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });

// ---------------------------------------------------------------- integrations

// Both are on npm: sayshape (the engine) and sayshape-mcp (the server for chat apps).
const MCP = "npx -y sayshape-mcp";
const LIB = "npm install sayshape";
// The hosting command is mcp/README.md's "Host it publicly" one, version pinned; the address is a placeholder.
// SayShape's public server (Cloud Run, from deploy/cloud-run/Dockerfile); docs/integration/mcp#hosted has it too.
const PUBLIC_MCP = "https://sayshape-mcp.premmannava.workers.dev/mcp";
const MCP_JSON = `{\n  "mcpServers": {\n    "sayshape": {\n      "command": "npx",\n      "args": ["-y", "sayshape-mcp"]\n    }\n  }\n}`;
// One entry per app: the steps to install it there, in order, and nothing else. The step with
// `code` shows the copy box. What each app can't do is on the docs page, not here.
const ASK = "Ask for a chart of anything.";
const PAGE = `${ASK} It opens as a page in your browser.`;
type Step = { text: string; code?: string; label?: string };
const setups: { id: string; name: string; steps: Step[]; more?: { text: string; to: string } }[] = [
  { id: "claude", name: "Claude Desktop", steps: [{ text: "Open Settings → Developer → Edit Config." }, { text: "Paste this:", code: MCP_JSON, label: "claude_desktop_config.json" }, { text: `Restart Claude. ${ASK}` }] },
  { id: "claude-code", name: "Claude Code", steps: [{ text: "Run this in a terminal:", code: `claude mcp add sayshape -- ${MCP}`, label: "Terminal" }, { text: PAGE }] },
  { id: "vscode", name: "VS Code", steps: [{ text: "Create .vscode/mcp.json in your project and paste this:", code: `{\n  "servers": {\n    "sayshape": {\n      "type": "stdio",\n      "command": "npx",\n      "args": ["-y", "sayshape-mcp"]\n    }\n  }\n}`, label: ".vscode/mcp.json" }, { text: "Turn on MCP Apps in VS Code's settings (experimental)." }, { text: ASK }] },
  { id: "codex", name: "Codex", steps: [{ text: "Run this in a terminal:", code: `codex mcp add sayshape -- ${MCP}`, label: "Terminal" }, { text: PAGE }] },
  { id: "antigravity", name: "Antigravity", steps: [{ text: "In the agent panel, open … → MCP Servers → Manage MCP Servers → View raw config." }, { text: "Paste this:", code: MCP_JSON, label: "mcp_config.json" }, { text: PAGE }] },
  { id: "hosted", name: "Claude web, ChatGPT", steps: [{ text: "Copy this address:", code: PUBLIC_MCP, label: "Address" }, { text: "Paste it in Claude as a custom connector, or in ChatGPT as an app in developer mode." }, { text: ASK }], more: { text: "Where to paste it, or host your own", to: "/docs/integration/mcp#hosted" } },
  { id: "other", name: "Goose and others", steps: [{ text: "Add this command as an MCP server in your app:", code: MCP, label: "Command" }, { text: ASK }] },
];
// Claude Desktop's steps show from the start, so the install steps are on screen without a press.
const setup = ref(setups[0]!.id);
const shownSetup = computed(() => setups.find((s) => s.id === setup.value)!);
const productOpen = ref(false);
const ownApp = `import { SayShape, coreComponents } from "sayshape";

const ui = new SayShape(canvas, { components: coreComponents });

ui.beginStream();
for await (const text of modelStream) ui.push(text);
ui.endStream();

ui.on("action", ({ name, value }) => yourApp.handle(name, value));`;

// ---------------------------------------------------------------- copy buttons

const copied = ref("");
let copiedTimer = 0;
async function copy(id: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = id;
  } catch {
    copied.value = "";
  }
  clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => { copied.value = ""; }, 1800);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <div class="lp">
    <!-- 1 · Hero -->
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-head">
        <div class="hero-title">
          <p class="eyebrow">Interactive answers for the AI you already use</p>
          <h1 id="hero-title">Let your AI <em>show</em>, not tell.</h1>
        </div>
        <div class="hero-copy">
          <p class="lede">Give the AI you already use the ability to create interactive answers: charts, comparisons, dashboards and tools people can actually use.</p>
          <div class="cta">
            <a class="btn primary" href="#integrations">Add it to your AI<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
            <a class="btn quiet" :href="href('/chat')">Try it live</a>
          </div>
          <p class="aside">Not another chatbot. A new capability for your AI. <a href="#examples">See more examples</a></p>
        </div>
      </div>
      <HomeHero class="hero-demo" />
    </section>

    <!-- 2 · Showcases -->
    <section id="examples" class="band" aria-labelledby="examples-title">
      <div class="wrap">
        <div class="head split">
          <h2 id="examples-title">One question. A whole new way to answer.</h2>
          <p>Ask something different and your AI builds something different. Pick a question to see the kind of screen it can answer with.</p>
        </div>
        <HomeShowcases />
      </div>
    </section>

    <!-- 3 · Text answer vs SayShape answer -->
    <section class="wrap block" aria-labelledby="use-title">
      <div class="head">
        <h2 id="use-title">Answers you can <em>do something</em> with.</h2>
        <p class="sub">Change the numbers. Explore the possibilities. <strong>No new AI response needed.</strong></p>
      </div>
      <div class="versus">
        <div class="before">
          <p class="tag">Before · a text answer</p>
          <p class="q">Monthly payment on $300k at 6.5%?</p>
          <p class="a">About $1,896 a month over 30 years.</p>
          <p class="q">And at 6%?</p>
          <p class="a">About $1,799 a month.</p>
          <p class="q more">What about over 20 years?</p>
          <span class="typing" role="img" aria-label="Waiting for another reply"><i></i><i></i><i></i></span>
          <p class="foot"><strong>Every “what if” is another message and another wait.</strong></p>
        </div>
        <div class="after">
          <div class="after-head">
            <p class="tag">After · a SayShape answer</p>
            <span class="look"><span class="swatch" aria-hidden="true"></span>Neutral look with your brand's accent</span>
          </div>
          <LiveDemo class="after-live" :spec="mortgageSpec" @pointerdown.capture="onMortgageTouch" @keydown.capture="onMortgageTouch" :look="mortgageLook" label="A mortgage calculator drawn by SayShape: loan amount, interest rate and term, with the monthly payment" @change="onMortgageChange" />
          <p class="counter" aria-live="polite">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            <span v-if="mortgageChanges === 0">Drag a slider or pick a term. The payment updates on the screen.</span>
            <span v-else><strong>{{ mortgageChanges }} {{ mortgageChanges === 1 ? "change" : "changes" }}</strong> · 0 new AI messages</span>
          </p>
        </div>
      </div>
    </section>

    <!-- 4 · Measured results -->
    <section id="measured" class="band" aria-labelledby="numbers-title">
      <div class="wrap">
        <div class="head"><h2 id="numbers-title">Less to generate. <em>More to interact with.</em></h2></div>
        <div ref="numbersEl" class="numbers">
          <article v-for="n in counted" :key="n.what" class="number">
            <p class="big"><span class="ratio" :class="{ accent: n.accent }">{{ n.shown }}</span><span class="what">{{ n.what }}</span></p>
            <div class="bars">
              <div v-for="b in n.bars" :key="b.name" class="bar" :class="{ mine: b.mine }">
                <span class="bar-name">{{ b.name }}</span><span class="bar-value">{{ b.value }}</span>
                <span class="bar-track"><span class="bar-fill" :style="{ width: b.width }"></span></span>
              </div>
            </div>
            <p class="note">{{ n.note }}</p>
          </article>
        </div>
        <div class="method">
          <p>A limited recorded comparison: 7 tasks, each answered by Claude Sonnet 5.5 in SayShape, HTML and A2UI (November 2026). It measures the model's output only, not drawing time or your app's speed, and results vary by task and model.</p>
          <p class="method-links"><a :href="href('/compare')">Watch the recordings →</a><a :href="href('/docs/architecture/limitations#measured-results')">How it was measured →</a></p>
        </div>
      </div>
    </section>

    <!-- 5 · Integrations -->
    <section id="integrations" class="wrap block" aria-labelledby="int-title">
      <div class="head">
        <h2 id="int-title">Works where your AI already lives.</h2>
        <p class="sub">Choose how you want to use SayShape.</p>
      </div>
      <div class="paths">
        <article class="path">
          <div class="path-head"><span class="path-icon coral" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /><path d="M9 10h6" /></svg></span><h3>In my existing AI assistant</h3></div>
          <p>Bring interactive answers into chat apps and editors that support MCP Apps, without building a new app, and into coding agents as a page you open. Your assistant's own model writes the screens, so there's no extra API key.</p>
          <div class="setup-tabs" role="group" aria-label="Pick your app to set it up"><button v-for="s in setups" :key="s.id" type="button" :aria-pressed="setup === s.id" aria-controls="assistant-details" @click="setup = s.id">{{ s.name }}</button></div>
          <div id="assistant-details" class="details">
            <ol class="steps">
              <li v-for="(st, i) in shownSetup.steps" :key="i">
                <span>{{ st.text }}</span>
                <div v-if="st.code" class="code"><div class="code-bar"><span>{{ st.label }}</span><button type="button" class="copy" @click="copy(shownSetup.id, st.code)">{{ copied === shownSetup.id ? "Copied" : "Copy" }}</button></div><pre tabindex="0" role="region" :aria-label="`Setup for ${shownSetup.name}`"><code>{{ st.code }}</code></pre></div>
              </li>
            </ol>
            <p class="small"><template v-if="shownSetup.id !== 'hosted'">Needs Node.js 20 or later. </template><a :href="href(shownSetup.more?.to ?? '/docs/integration/mcp')">{{ shownSetup.more?.text ?? "More options" }} →</a></p>
          </div>
        </article>
        <article class="path">
          <div class="path-head"><span class="path-icon teal" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M8 21h8" /></svg></span><h3>In my own product</h3></div>
          <p>Give your chatbot the ability to answer with interactive screens, while your application controls the data, the look and every action.</p>
          <ul class="ticks">
            <li>Your model, your data, your theme</li>
            <li>Screens build line by line as your model streams</li>
            <li>One canvas, no UI framework, no runtime dependencies</li>
          </ul>
          <div class="path-actions">
            <a class="btn quiet" :href="href('/docs/integration/embedding')">Explore integration</a>
            <button type="button" class="link-btn" :aria-expanded="productOpen" aria-controls="product-details" @click="productOpen = !productOpen">{{ productOpen ? "Hide the code" : "See the code" }}</button>
          </div>
          <div v-if="productOpen" id="product-details" class="details">
            <div class="code"><div class="code-bar"><span>Terminal</span><button type="button" class="copy" @click="copy('lib', LIB)">{{ copied === "lib" ? "Copied" : "Copy" }}</button></div><pre tabindex="0" role="region" aria-label="Install command"><code>{{ LIB }}</code></pre></div>
            <div class="code"><div class="code-bar"><span>Your app</span><button type="button" class="copy" @click="copy('app', ownApp)">{{ copied === "app" ? "Copied" : "Copy" }}</button></div><pre tabindex="0" role="region" aria-label="Embedding code"><code>{{ ownApp }}</code></pre></div>
          </div>
        </article>
      </div>
    </section>

    <!-- 6 · Control -->
    <section class="band" aria-labelledby="control-title">
      <div class="wrap control">
        <div class="control-copy">
          <h2 id="control-title">Your app stays in control of the data, the actions and the look.</h2>
          <div class="pillars">
            <div>
              <h3>Your data</h3>
              <p>In supported setups, your app hands full datasets straight to the screen. The model may still see column names or a few sample rows, depending on the integration.</p>
              <a :href="href('/docs/integration/host-data')">Host data and events →</a>
            </div>
            <div>
              <h3>Your actions</h3>
              <p>A screen can only send named actions to your app, and your code decides what each one does. A spec can't run code or open links, and it loads images only from hosts your app allows.</p>
              <a :href="href('/docs/architecture/security')">The expression boundary →</a>
            </div>
            <div>
              <h3>Your design</h3>
              <p>Your app sets the theme and which elements exist. The AI picks roles like “primary” or “warning”, never colors or code. Try the same spec in each look, or pick your own brand color.</p>
              <a :href="href('/docs/integration/themes')">Themes →</a>
            </div>
          </div>
        </div>
        <HomeControl class="control-demo" />
      </div>
    </section>

    <!-- 7 · Closing -->
    <section id="start" class="wrap closing-wrap" aria-labelledby="start-title">
      <div class="closing">
        <div class="closing-copy">
          <h2 id="start-title">Your AI already knows how to answer. <em>Give it a way to show you.</em></h2>
          <div class="cta">
            <a class="btn light" href="#integrations">Add it to your AI</a>
            <a class="btn outline-light" :href="REPO">View on GitHub</a>
          </div>
          <p class="small">SayShape v0.1 is an early prototype. Open source, MIT licensed. <a :href="href('/chat')">Ask a live model and watch it answer →</a></p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lp { --gutter: var(--ss-gutter); overflow-x: clip }
.wrap { max-width: var(--ss-content); margin: 0 auto; padding: 0 var(--gutter) }
.block { padding-top: clamp(56px, 7vw, 104px); padding-bottom: clamp(56px, 7vw, 104px) }
.band { background: var(--ss-card); border-top: 1px solid var(--vp-c-divider); border-bottom: 1px solid var(--vp-c-divider); padding: clamp(56px, 7vw, 104px) 0 }

h1, h2 { font-family: var(--sayshape-display); font-weight: 600; letter-spacing: -0.02em; color: var(--vp-c-text-1) }
h1 em, h2 em { font-style: italic; color: var(--ss-coral) }
h2 { margin: 0; font-size: clamp(34px, 4.6vw, 62px); line-height: 1.03 }
h3 { margin: 0; font-size: 19px; font-weight: 700 }
.head { margin-bottom: clamp(28px, 3.6vw, 44px) }
.head.split { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px 40px }
.head.split h2 { max-width: 18ch }
.head.split p { max-width: 42ch; margin: 0; font-size: 17px; line-height: 1.55; color: var(--vp-c-text-2) }
.head .sub { margin: 14px 0 0; font-size: clamp(18px, 1.6vw, 21px); line-height: 1.45 }
.small { margin: 0; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2) }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 10px; min-height: 50px; padding: 0 22px; border-radius: 999px; font-weight: 600; font-size: 16px; text-decoration: none !important; border: 1.5px solid transparent; transition: background 0.15s, color 0.15s, border-color 0.15s }
.btn.primary { background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.btn.primary:hover { background: var(--ss-ink-hover) }
.btn.quiet { border-color: var(--vp-c-text-1); color: var(--vp-c-text-1) }
.btn.quiet:hover { background: var(--vp-c-text-1); color: var(--vp-c-bg) }
.btn.light { background: #f9f7f2; color: #171b32 }
.btn.light:hover { background: #ffffff }
.btn.outline-light { border-color: #6a6f92; color: #f9f7f2 }
.btn.outline-light:hover { border-color: #f9f7f2 }
.btn:focus-visible, .link-btn:focus-visible, .copy:focus-visible, .setup-tabs button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 3px }
.link-btn { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--vp-c-text-1); font: 600 14px var(--vp-font-family-base); text-decoration: underline; text-underline-offset: 3px; cursor: pointer }

/* 1 · Hero */
.hero { max-width: var(--ss-content); margin: 0 auto; padding: clamp(28px, 4.5vw, 64px) var(--gutter) clamp(48px, 6vw, 88px) }
.hero-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 20px 56px; margin-bottom: clamp(28px, 4vw, 48px) }
.hero-title { flex: 1 1 560px; min-width: 0 }
.eyebrow { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: var(--ss-coral-ink) }
h1 { margin: 0; font-size: clamp(50px, 7vw, 104px); line-height: 0.95; letter-spacing: -0.03em }
.hero-copy { flex: 1 1 380px; min-width: 0; max-width: 480px }
.lede { margin: 0; font-size: clamp(18px, 1.5vw, 21px); line-height: 1.45; color: var(--vp-c-text-1) }
.cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px }
.aside { margin: 16px 0 0; font-size: 14px; color: var(--vp-c-text-2) }
.aside a { color: var(--vp-c-text-1); font-weight: 600; text-decoration: underline; text-decoration-color: var(--vp-c-border); text-underline-offset: 3px; white-space: nowrap }

/* 3 · Before and after */
.versus { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr); gap: 20px; align-items: start }
.before, .after { border: 1px solid var(--vp-c-divider); border-radius: 22px; background: var(--ss-card) }
.before { display: flex; flex-direction: column; gap: 10px; padding: 22px }
.tag { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vp-c-text-2) }
.q { align-self: flex-end; max-width: 88%; margin: 0; padding: 9px 13px; border-radius: 15px 15px 4px 15px; background: var(--vp-c-bg-alt); font-size: 15px }
.a { margin: 0; font-size: 15px; line-height: 1.5; color: var(--vp-c-text-2) }
.typing { display: inline-flex; gap: 5px; padding: 4px 0 }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: var(--vp-c-text-3); opacity: 0.6 }
.foot { margin: auto 0 0; padding-top: 12px; border-top: 1px solid var(--vp-c-divider); font-size: 14px }
.after { padding: clamp(16px, 2.2vw, 26px); box-shadow: var(--ss-lift) }
.after-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 14px }
.look { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--vp-c-text-2) }
.swatch { width: 10px; height: 10px; border-radius: 3px; background: #b45309 }
.after-live { border-radius: 16px; border: 1px solid var(--vp-c-divider) }
.counter { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; padding: 10px 14px; border-radius: 12px; background: var(--vp-c-bg-alt); font-size: 14px; color: var(--vp-c-text-2) }
.counter svg { flex: none; color: var(--vp-c-brand-1) }
.counter strong { color: var(--vp-c-text-1) }

/* 4 · Numbers */
.numbers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px }
.number { padding: clamp(22px, 3vw, 34px); border: 1px solid var(--vp-c-divider); border-radius: 22px; background: var(--vp-c-bg) }
.big { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin: 0 }
.ratio { font-family: var(--sayshape-display); font-weight: 600; font-size: clamp(60px, 7vw, 96px); line-height: 0.9; color: var(--vp-c-text-1); font-variant-numeric: tabular-nums }
.ratio.accent { color: var(--ss-coral) }
.what { max-width: 18ch; font-size: 17px; font-weight: 600; line-height: 1.3 }
.bars { display: flex; flex-direction: column; gap: 12px; margin-top: 26px }
.bar { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; font-size: 14px; color: var(--vp-c-text-2) }
.bar.mine { color: var(--vp-c-text-1); font-weight: 600 }
.bar-track { grid-column: 1 / -1; height: 12px; border-radius: 999px; background: var(--vp-c-bg-alt); overflow: hidden }
.bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--ss-bar) }
.bar.mine .bar-fill { background: var(--vp-c-text-1) }
.number:first-child .bar.mine .bar-fill { background: var(--ss-coral) }
.note { margin: 14px 0 0; font-size: 13px; color: var(--vp-c-text-2) }
.method { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 24px; margin-top: 16px; padding: 14px 18px; border: 1px solid var(--vp-c-divider); border-radius: 14px; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2) }
.method p { margin: 0; flex: 1 1 420px }
.method-links { display: flex; flex-wrap: wrap; gap: 6px 18px; flex: 0 1 auto !important; font-weight: 600 }

/* 5 · Integrations */
.paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px }
.path { display: flex; flex-direction: column; gap: 16px; padding: clamp(22px, 3vw, 32px); border: 1px solid var(--vp-c-divider); border-radius: 24px; background: var(--ss-card) }
.path > p { margin: 0; font-size: 16px; line-height: 1.55; color: var(--vp-c-text-2) }
.path-head { display: flex; align-items: center; gap: 12px }
.path-head h3 { font-family: var(--sayshape-display); font-weight: 600; font-size: clamp(23px, 2.2vw, 29px); letter-spacing: -0.01em }
.path-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px }
.path-icon.coral { background: var(--ss-coral-soft); color: var(--ss-coral-ink) }
.path-icon.teal { background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1) }
.ticks { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; font-size: 15px }
.ticks li { position: relative; padding-left: 26px }
.ticks li::before { content: ""; position: absolute; left: 2px; top: 5px; width: 12px; height: 7px; border-left: 2.4px solid var(--vp-c-brand-1); border-bottom: 2.4px solid var(--vp-c-brand-1); transform: rotate(-45deg) }
.path-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: auto }
.details { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; border-top: 1px solid var(--vp-c-divider) }
.steps { list-style: decimal; display: flex; flex-direction: column; gap: 12px; margin: 0; padding-left: 22px; font-size: 15px; line-height: 1.5 }
.steps li::marker { font-weight: 700 }
.steps .code { margin-top: 8px; margin-left: -22px }
.setup-tabs { display: flex; flex-wrap: wrap; gap: 6px }
.setup-tabs button { min-height: 44px; padding: 0 12px; border: 1px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); color: var(--vp-c-text-1); font: 600 13px var(--vp-font-family-base); cursor: pointer }
.setup-tabs button[aria-pressed="true"] { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg) }
.code { border-radius: 12px; background: var(--ss-code-bg); overflow: hidden }
.code-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 4px 6px 4px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ss-code-com) }
.code pre:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px }
/* Commands never wrap (a wrapped "--host" reads as two commands); they scroll inside their box, at every width. */
.code pre { margin: 0; padding: 12px 16px 14px; overflow-x: auto; white-space: pre; font: 13px/1.7 var(--vp-font-family-mono); color: var(--ss-code-ink) }
.code code { background: none; padding: 0; color: inherit; font: inherit }
.copy { min-height: 36px; padding: 0 12px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: rgba(255, 255, 255, 0.08); color: var(--ss-code-ink); font: 600 12px var(--vp-font-family-base); letter-spacing: 0; text-transform: none; cursor: pointer }
.copy:hover { background: rgba(255, 255, 255, 0.16) }

/* 6 · Control */
.control { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: clamp(28px, 4vw, 56px); align-items: start }
.control h2 { font-size: clamp(30px, 3.6vw, 50px); max-width: 21ch }
.pillars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; margin-top: 34px }
.pillars > div { display: flex; flex-direction: column; gap: 8px; padding-top: 16px; border-top: 2px solid var(--vp-c-text-1) }
.pillars p { margin: 0; font-size: 15px; line-height: 1.55; color: var(--vp-c-text-2) }
.pillars a { margin-top: auto; font-size: 14px; font-weight: 600 }

/* 7 · Closing */
.closing-wrap { padding-top: clamp(56px, 7vw, 96px); padding-bottom: 24px }
.closing { display: flex; flex-wrap: wrap; gap: 32px 48px; align-items: center; padding: clamp(28px, 5.5vw, 72px); border-radius: clamp(24px, 3vw, 32px); background: #171b32; color: #f9f7f2 }
.closing-copy { flex: 1 1 440px; min-width: 0 }
.closing h2 { color: #f9f7f2; font-size: clamp(32px, 4.4vw, 58px) }
.closing h2 em { color: #ff8a73 }
.closing .small { margin-top: 20px; color: #b9bcd6 }
.closing .small a { color: #f9f7f2; font-weight: 600; text-underline-offset: 3px; white-space: nowrap }
.closing .small a:focus-visible { outline: 2px solid #f9f7f2; outline-offset: 3px; border-radius: 3px }

/* Tablet */
@media (max-width: 1024px) {
  .versus { grid-template-columns: minmax(0, 1fr) }
  .control { grid-template-columns: minmax(0, 1fr) }
}
@media (max-width: 860px) {
  .numbers, .paths { grid-template-columns: minmax(0, 1fr) }
  .pillars { grid-template-columns: minmax(0, 1fr); gap: 18px }
}
/* Phone */
@media (max-width: 560px) {
  .hero { padding-top: 24px }
  .hero-head { gap: 16px; margin-bottom: 24px }
  .eyebrow { margin-bottom: 12px; font-size: 13px }
  .cta .btn { flex: 1 1 auto; justify-content: center }
  .before .more, .before .typing { display: none }
  .before { padding: 18px }
  .after { padding: 10px; border-radius: 18px }
  .after-head { margin: 4px 4px 10px }
  .after-live { border-radius: 12px }
  .number { padding: 18px }
  .ratio { font-size: 52px }
  .numbers { gap: 12px }
      .closing { border-radius: 22px }
  .closing .cta .btn { flex: 1 1 auto; justify-content: center }
}
@media (prefers-reduced-motion: reduce) { .btn { transition: none } }
</style>
