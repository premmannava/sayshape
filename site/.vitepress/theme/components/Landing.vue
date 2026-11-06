<script setup lang="ts">
/**
 * The landing page: what SayShape lets an AI do, how to add it, why it isn't
 * just "let the AI write a web page", the measured numbers and what happens
 * to your data. Short on purpose; the docs hold the rest. Claims here are
 * kept to what's true today: the MCP server isn't on npm yet, the engine
 * (not the MCP server) is the part with no dependencies, and the AI sees
 * column names and a sample, never needing the full data.
 *
 * The numbers are medians of the seven recordings the compare page plays
 * (site/public/compare/anthropic_claude-sonnet-5.5): tokens estimated from
 * each answer's length, time until each answer finished.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import ShowHero from "./ShowHero.vue";

const href = (p: string) => withBase(p);
const REPO = "https://github.com/premmannava/sayshape";

const can = [
  { title: "Built on the fly", text: "No pre-made screens. Your agent designs each one for the question in front of it." },
  { title: "Alive, not a picture", text: "People click, type and choose. Changing a value doesn't need another AI reply." },
  { title: "Right where people ask", text: "In Claude, ChatGPT and VS Code, or inside your own chatbot." },
];

const versus = [
  { what: "Your data", page: "Typed into the page, so all of it goes through the AI", ours: "Goes from your app to the screen. The AI only needs the column names and a sample" },
  { what: "Code", page: "Usually comes with JavaScript that runs in your page", ours: "A spec can't run JavaScript. SayShape's own engine draws it" },
  { what: "Speed", page: "~1,300 tokens · ~13 s for the AI to write", ours: "~170 tokens · ~2.4 s for the AI to write" },
  { what: "Looks", page: "Different fonts, colors and layout every time", ours: "Your look, every time. The AI never picks colors" },
  { what: "Mistakes", page: "A broken page, or one that looks right and isn't", ours: "A bad line is skipped and reported; the rest works" },
];

// The MCP server isn't on npm yet: the settings point at a build from source.
const build = `git clone https://github.com/premmannava/sayshape.git
cd sayshape/mcp && npm ci && npm run build`;
const SERVER = "/path/to/sayshape/mcp/dist/server.js";
const setups = [
  { id: "vscode", name: "VS Code", where: "In .vscode/mcp.json", code: `{\n  "servers": {\n    "sayshape": {\n      "type": "stdio",\n      "command": "node",\n      "args": ["${SERVER}"]\n    }\n  }\n}` },
  { id: "claude", name: "Claude", where: "Claude Desktop → Settings → Developer → Edit Config", code: `{\n  "mcpServers": {\n    "sayshape": {\n      "command": "node",\n      "args": ["${SERVER}"]\n    }\n  }\n}` },
  { id: "chatgpt", name: "ChatGPT", where: "Run it on port 3001 behind HTTPS, then add its /mcp address as a connector in developer mode", code: `node ${SERVER} --http 3001` },
];
const setup = ref(setups[0]!.id);
const shownSetup = computed(() => setups.find((s) => s.id === setup.value)!);

const ownApp = `const ui = new SayShape(canvas, { components: coreComponents });

ui.beginStream();
// Your rows go to the screen; the model never needs them.
ui.state.set("sales", rowsFromYourDatabase);
for await (const text of modelStream) ui.push(text);
ui.endStream();`;

// Medians of 7 recorded tasks, Claude Sonnet 5.5.
const numbers = [
  { title: "What the AI writes", unit: "tokens per screen", headline: 7.6, caption: "less than HTML, and 3.7× less than A2UI", digits: 0, suffix: "", rows: [["SayShape", 171], ["A2UI", 628], ["HTML", 1299]] as const },
  { title: "Time for the AI to finish", unit: "seconds of writing", headline: 5.4, caption: "faster than HTML, and 7× faster than A2UI", digits: 1, suffix: " s", rows: [["SayShape", 2.4], ["HTML", 13.2], ["A2UI", 17.2]] as const },
];

const trust = [
  "No SayShape account, server or hosted database",
  "Your full data never has to pass through the AI",
  "Specs can't run JavaScript",
  "The engine has no dependencies: no React, no UI framework",
];

// Count the numbers up once, when they scroll into view. They start at their
// final values, so the page as built (and without motion) shows the real numbers.
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
      bars: n.rows.map(([name, v]) => ({ name, mine: name === "SayShape", value: `${fmt(v * k, n.digits)}${n.suffix}`, width: `${Math.max(1.5, (v / max) * 100 * k)}%` })),
    };
  }),
);
const still = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function countUp() {
  const start = performance.now();
  const step = (now: number) => {
    progress.value = Math.min(1, (now - start) / 1600);
    if (progress.value < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}
onMounted(() => {
  if (!numbersEl.value || typeof IntersectionObserver === "undefined" || still()) return;
  progress.value = 0;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { observer?.disconnect(); observer = null; countUp(); }
  }, { threshold: 0.3 });
  observer.observe(numbersEl.value);
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });
</script>

<template>
  <div class="lp">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="pill"><span class="pulse" aria-hidden="true"></span>For AI agents · open source</p>
        <h1 id="hero-title">Let your AI<br> <span class="line2"><span class="ss-mark">show,</span> not tell.</span></h1>
        <p class="lede">AI agents are stuck answering in text. SayShape lets them answer with a screen people can use, built on the fly in seconds.</p>
        <div class="cta">
          <a class="sayshape-btn primary" href="#setup">Add it to your agent →</a>
          <a class="sayshape-btn quiet" :href="href('/compare')">Watch the comparison</a>
        </div>
      </div>
      <ShowHero class="hero-demo" />
    </section>

    <section class="block" aria-labelledby="can-title">
      <div class="head">
        <h2 id="can-title">What your AI can do now.</h2>
        <p>Instead of a long explanation or a table to read, people get a screen to use, right in the conversation.</p>
      </div>
      <div class="why">
        <article v-for="(w, i) in can" :key="w.title" class="why-item">
          <span class="why-n" aria-hidden="true">0{{ i + 1 }}</span>
          <h3>{{ w.title }}</h3>
          <p>{{ w.text }}</p>
        </article>
      </div>
    </section>

    <section id="setup" class="block" aria-labelledby="setup-title">
      <div class="head">
        <h2 id="setup-title">Add it to your agent.</h2>
        <p>Two ways, both open source.</p>
      </div>
      <div class="ways">
        <article class="way">
          <h3>In the AI tools you already use</h3>
          <p>Connect SayShape to VS Code, Claude or ChatGPT, then ask: <em>“show my sales by region.”</em></p>
          <p class="step"><span>1</span>Build the server (Node.js 20 or later):</p>
          <pre tabindex="0"><code>{{ build }}</code></pre>
          <p class="step"><span>2</span>Point your AI tool at it:</p>
          <div class="tabs" role="tablist" aria-label="Where to add it">
            <button v-for="s in setups" :id="`tab-${s.id}`" :key="s.id" type="button" role="tab" :aria-selected="setup === s.id" :aria-controls="`panel-${s.id}`" @click="setup = s.id">{{ s.name }}</button>
          </div>
          <div :id="`panel-${shownSetup.id}`" role="tabpanel" :aria-labelledby="`tab-${shownSetup.id}`" class="panel">
            <p class="where">{{ shownSetup.where }}</p>
            <pre tabindex="0"><code>{{ shownSetup.code }}</code></pre>
          </div>
          <p class="small">Use the full path to your copy. An npm package that makes this one line is coming soon. <a :href="href('/docs/integration/mcp')">Full setup →</a><br>Tested with Claude Sonnet 5.5 and GPT-4.1. Results depend on the model you connect.</p>
        </article>
        <article class="way">
          <h3>In your own chatbot</h3>
          <p>Your agent writes the screen; your app hands SayShape the data. Rows from your database go to the screen without passing through the model.</p>
          <pre tabindex="0" class="panel-code"><code>{{ ownApp }}</code></pre>
          <a class="more" :href="href('/docs/integration/model')">Integration guide →</a>
        </article>
      </div>
    </section>

    <section class="block html" aria-labelledby="html-title">
      <div class="head">
        <h2 id="html-title">“But my AI can already write web pages.”</h2>
        <p class="big">It can. Here's why that's slower and riskier.</p>
        <p>An AI-written web page is long, usually comes with JavaScript that runs in your page, and only shows your data if the AI types it in. SayShape is a short description of a screen. Your AI writes a few lines, SayShape's own engine draws them, and your data goes from your app to the screen.</p>
      </div>
      <div class="vs" role="table" aria-label="AI writes a web page compared with AI writes SayShape">
        <div class="vs-row vs-head" role="row">
          <span role="columnheader"></span>
          <span role="columnheader">AI writes a web page</span>
          <span role="columnheader" class="ours">AI writes SayShape</span>
        </div>
        <div v-for="v in versus" :key="v.what" class="vs-row" role="row">
          <span role="rowheader">{{ v.what }}</span>
          <span role="cell" class="theirs" data-label="AI writes a web page"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg><span>{{ v.page }}</span></span>
          <span role="cell" class="ours" data-label="AI writes SayShape"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg><span>{{ v.ours }}</span></span>
        </div>
      </div>
      <p class="note">SayShape does less than a web page on purpose. That's why it's fast, safe and private. <a :href="href('/compare')">Watch them side by side →</a></p>
    </section>

    <section ref="numbersEl" class="block" aria-labelledby="numbers-title">
      <div class="head">
        <h2 id="numbers-title">Less to write. <span class="ss-mark">Done sooner.</span></h2>
        <p>We asked one AI for the same screen three ways, in SayShape, HTML and A2UI, and measured how much it wrote and how long it took to finish.</p>
      </div>
      <div class="nums">
        <article v-for="n in counted" :key="n.title" class="num">
          <div class="num-top"><h3>{{ n.title }}</h3><span>{{ n.unit }}</span></div>
          <p class="num-big">{{ n.shown }}</p>
          <p class="num-cap">{{ n.caption }}</p>
          <div class="bars">
            <div v-for="b in n.bars" :key="b.name" class="bar" :class="{ mine: b.mine }">
              <div class="bar-label"><span>{{ b.name }}</span><span>{{ b.value }}</span></div>
              <div class="bar-track"><div class="bar-fill" :style="{ width: b.width }"></div></div>
            </div>
          </div>
        </article>
      </div>
      <p class="note">Median of 7 tasks, each answered by Claude Sonnet 5.5 in all three formats at the same moment, November 2026. Times are how long the AI took to finish writing, not drawing time. Tokens are estimated from each answer's length. Results vary by model, task and environment. <a :href="href('/compare')">See the recordings →</a></p>
    </section>

    <section class="block trust" aria-labelledby="trust-title">
      <div>
        <h2 id="trust-title">An interface engine, not another place to store your data.</h2>
        <p class="trust-note">With the MCP server's database mode, or in your own chatbot, your app hands the rows to the screen. The AI sees the column names and a small sample. The AI provider you connect has its own data rules.</p>
      </div>
      <ul>
        <li v-for="t in trust" :key="t"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{{ t }}</li>
      </ul>
    </section>

    <section class="end" aria-labelledby="end-title">
      <div>
        <p class="end-kicker">Your AI already has the intelligence.</p>
        <h2 id="end-title">Give it a visual language.</h2>
        <p class="end-small">Open source · MIT licensed</p>
      </div>
      <div class="cta">
        <a class="end-btn" href="#setup">Add it to your agent →</a>
        <a class="end-btn quiet" :href="REPO">Star on GitHub</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lp { max-width: 1240px; margin: 0 auto; padding: 56px 32px 80px }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
h1, h2, h3 { border: 0; padding: 0 }

/* Hero */
.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px 56px; align-items: center }
.hero-copy { display: flex; flex-direction: column; gap: 24px; animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both }
.pill { align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; margin: 0; padding: 6px 14px 6px 10px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--vp-c-brand-1); animation: pulse 2.2s ease-in-out infinite }
.hero h1 { margin: 0; font: 800 clamp(46px, 5.4vw, 78px)/0.95 var(--sayshape-display); letter-spacing: -0.055em; color: var(--vp-c-text-1); text-wrap: balance }
.hero h1 .line2 { white-space: nowrap }
.lede { margin: 0; max-width: 520px; font-size: 21px; line-height: 1.45; color: var(--vp-c-text-2); text-wrap: pretty }
.cta { display: flex; flex-wrap: wrap; gap: 12px }
.hero-demo { animation: rise 0.8s 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) both }

/* Sections */
.block { margin-top: 104px }
.head { display: flex; flex-direction: column; gap: 12px; max-width: 780px; margin-bottom: 32px }
.head h2, .trust h2 { margin: 0; font: 800 clamp(36px, 4.4vw, 58px)/1.02 var(--sayshape-display); letter-spacing: -0.045em; color: var(--vp-c-text-1) }
.head p { margin: 0; font-size: 19px; line-height: 1.5; color: var(--vp-c-text-2) }
.head .big { font: 700 clamp(22px, 2.2vw, 28px)/1.2 var(--sayshape-display); letter-spacing: -0.02em; color: var(--vp-c-brand-1) }
.note { margin: 18px 0 0; font-size: 15px; color: var(--vp-c-text-2) }
.note a, .small a, .more { font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none }

/* HTML vs SayShape */
.vs { border: 2px solid var(--ss-rule); border-radius: 22px; background: var(--ss-card); overflow: hidden; box-shadow: 6px 6px 0 var(--ss-shadow) }
.vs-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 2.4fr) minmax(0, 2.4fr); border-top: 1px solid var(--vp-c-divider) }
.vs-row:first-child { border-top: 0 }
.vs-row > span { display: flex; gap: 10px; align-items: flex-start; padding: 16px 20px; font-size: 16px; line-height: 1.45 }
.vs-row > span:first-child { font-weight: 700; color: var(--vp-c-text-1) }
.vs-row svg { flex: none; margin-top: 3px }
.vs-row > span > span { flex: 1; min-width: 0 }
.vs-head > span { font: 600 13px var(--vp-font-family-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vp-c-text-2) }
.vs-head .ours { color: var(--vp-c-brand-1) }
.vs .theirs { color: var(--vp-c-text-2) }
.vs .theirs svg { color: var(--sayshape-warn) }
.vs-row:not(.vs-head) .ours { color: var(--vp-c-text-1); background: var(--vp-c-brand-soft); font-weight: 500 }
.vs-row:not(.vs-head) .ours svg { color: var(--vp-c-brand-1) }

/* Why */
.why { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; border-top: 2px solid var(--ss-rule) }
.why-item { display: flex; flex-direction: column; gap: 10px; padding: 28px 28px 8px 0 }
.why-item + .why-item { padding-left: 28px; border-left: 1px solid var(--vp-c-divider) }
.why-n { font: 500 13px var(--vp-font-family-mono); color: var(--vp-c-text-3) }
.why-item h3 { margin: 0; font: 800 clamp(26px, 2.8vw, 36px)/1.02 var(--sayshape-display); letter-spacing: -0.04em; color: var(--vp-c-text-1) }
.why-item p { margin: 0; font-size: 17px; line-height: 1.5; color: var(--vp-c-text-2) }

/* Two ways */
.ways { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px }
.way { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 28px; border: 1.5px solid var(--vp-c-divider); border-radius: 22px; background: var(--ss-card) }
.way h3 { margin: 0; font: 800 26px/1.1 var(--sayshape-display); letter-spacing: -0.03em; color: var(--vp-c-text-1) }
.way p { margin: 0; font-size: 16px; line-height: 1.5; color: var(--vp-c-text-2) }
.way em { color: var(--vp-c-text-1) }
.tabs { display: inline-flex; align-self: flex-start; gap: 4px; padding: 4px; border: 1.5px solid var(--ss-rule); border-radius: 999px }
.tabs button { min-height: 40px; padding: 0 16px; border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1); cursor: pointer }
.tabs button[aria-selected="true"] { background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.panel { display: flex; flex-direction: column; gap: 8px; min-width: 0 }
.where { font: 13px var(--vp-font-family-mono) !important; color: var(--vp-c-text-3) !important }
.way pre { margin: 0; padding: 16px 18px; border-radius: 14px; background: var(--vp-code-block-bg); border: 1px solid var(--vp-c-divider); font: 13px/1.6 var(--vp-font-family-mono); color: var(--vp-c-text-1); overflow-x: auto; white-space: pre }
.small { font-size: 14px !important }
.step { display: flex; align-items: center; gap: 10px; font-weight: 600; color: var(--vp-c-text-1) !important }
.step span { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--ss-mark); color: #0f1a17; font: 700 13px var(--vp-font-family-mono) }
.more { margin-top: auto }

/* Numbers */
.nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px }
.num { display: flex; flex-direction: column; gap: 18px; padding: 30px; border: 2px solid var(--ss-rule); border-radius: 22px; background: var(--ss-card); box-shadow: 6px 6px 0 var(--ss-shadow) }
.num-top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px }
.num-top h3 { margin: 0; font: 800 24px/1.1 var(--sayshape-display); letter-spacing: -0.025em; color: var(--vp-c-text-1) }
.num-top span { font: 13px var(--vp-font-family-mono); color: var(--vp-c-text-3) }
.num-big { margin: 0; font: 800 clamp(60px, 6.4vw, 92px)/0.9 var(--sayshape-display); letter-spacing: -0.05em; color: var(--vp-c-brand-1); font-variant-numeric: tabular-nums }
.num-cap { margin: -6px 0 0; font-size: 17px; color: var(--vp-c-text-2) }
.bars { display: flex; flex-direction: column; gap: 14px }
.bar-label { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; font-size: 15px; color: var(--vp-c-text-2) }
.bar-label span:last-child { font-family: var(--vp-font-family-mono); font-variant-numeric: tabular-nums }
.bar.mine .bar-label { color: var(--vp-c-text-1); font-weight: 700 }
.bar-track { height: 18px; border-radius: 7px; background: var(--vp-c-bg-alt); overflow: hidden }
.bar-fill { height: 100%; border-radius: 7px; background: var(--vp-c-text-3); opacity: 0.55 }
.bar.mine .bar-fill { background: var(--vp-c-brand-1); opacity: 1 }

/* Trust */
.trust { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px 56px; align-items: center; padding: 48px; border-radius: 28px; background: var(--vp-c-bg-alt) }
.trust-note { margin: 16px 0 0; font-size: 16px; line-height: 1.5; color: var(--vp-c-text-2) }
.trust ul { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none }
.trust li { display: flex; align-items: center; gap: 14px; font: 700 clamp(19px, 1.8vw, 23px)/1.25 var(--sayshape-display); letter-spacing: -0.015em; color: var(--vp-c-text-1) }
.trust li svg { flex: none; padding: 5px; box-sizing: content-box; border-radius: 50%; background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1) }

/* Closing */
.end { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 28px 40px; margin-top: 104px; padding: 56px 48px; border-radius: 28px; background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.end-kicker { margin: 0 0 8px; font-size: 19px; opacity: 0.75 }
.end h2 { margin: 0; font: 800 clamp(38px, 4.8vw, 64px)/0.98 var(--sayshape-display); letter-spacing: -0.045em; color: inherit }
.end-small { margin: 14px 0 0; font: 13px var(--vp-font-family-mono); opacity: 0.7 }
.end-btn { display: inline-flex; align-items: center; min-height: 50px; padding: 0 24px; border-radius: 999px; border: 2px solid var(--ss-on-ink); background: var(--ss-on-ink); color: var(--vp-c-text-1); font-weight: 600; text-decoration: none; transition: transform 0.18s, box-shadow 0.18s }
.end-btn:hover { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 var(--vp-c-brand-1) }
.end-btn.quiet { background: transparent; color: var(--ss-on-ink) }

@keyframes rise { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--vp-c-brand-soft) } 50% { box-shadow: 0 0 0 7px transparent } }

@media (max-width: 1080px) {
  .hero { grid-template-columns: minmax(0, 1fr) }
}
@media (max-width: 860px) {
  .lp { padding: 32px 20px 56px }
  .block { margin-top: 72px }
  .why, .ways, .nums, .trust { grid-template-columns: minmax(0, 1fr) }
  .why-item, .why-item + .why-item { padding: 22px 0; border-left: 0; border-top: 1px solid var(--vp-c-divider) }
  .why-item:first-child { border-top: 0 }
  .vs-row { grid-template-columns: minmax(0, 1fr) }
  .vs-row > span:first-child { padding-bottom: 0 }
  .vs-head { display: none }
  .vs-row > span[data-label] { flex-wrap: wrap }
  .vs-row > span[data-label]::before { content: attr(data-label); flex-basis: 100%; font: 600 11px var(--vp-font-family-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--vp-c-text-3) }
  .trust, .end { padding: 32px 24px }
}
@media (prefers-reduced-motion: reduce) {
  .hero-copy, .hero-demo { animation: none }
  .pulse { animation: none }
  .end-btn { transition: none }
}
</style>
