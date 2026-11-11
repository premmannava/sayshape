/**
 * Draws the README's animated picture: one recorded request answered by one
 * model in SayShape and in HTML, replayed side by side at the speed each
 * answer arrived, then one press on the SayShape screen.
 *
 *   npm run build && npm run readme:hero
 *
 * Nothing in it is staged. The answers and their timings are a recording made
 * by scripts/record.ts (site/public/compare/, the same file the website's
 * /compare page replays), SayShape is drawn by the engine in dist/, and the
 * HTML answer runs in a sandboxed iframe as its markup arrives. It needs the
 * network once, for fonts and for whatever scripts the HTML answer loads.
 *
 * Writes docs/images/hero-light.gif and hero-dark.gif.
 */
import { chromium } from "playwright";
import gifenc from "gifenc";
import { inflateSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORDING = "site/public/compare/anthropic_claude-sonnet-5.5/c5.json";
const ENGINE = resolve(root, "dist/sayshape.global.js");
const WIDTH = 880, HEIGHT = 654, SCALE = 2;
/** How often the picture is redrawn while answers arrive, and how long the last frame holds. */
const STEP_MS = 250, HOLD_MS = 900, END_MS = 3200;
/** What to press once both answers are in, by the name a screen reader hears. */
const PRESS = "Month";

if (!existsSync(ENGINE)) {
  console.error("dist/sayshape.global.js is missing. Run: npm run build");
  process.exit(1);
}
const rec = JSON.parse(readFileSync(resolve(root, RECORDING), "utf8"));
const MODEL_NAMES = { "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5" };
const model = MODEL_NAMES[rec.model] ?? rec.model;

const COLORS = {
  light: { bg: "#ffffff", ink: "#1f2328", muted: "#59636e", line: "#d1d9e0", code: "#f6f8fa", done: "#1a7f37", doneBg: "#dafbe1", chip: "#eff2f5", out: "#ffffff" },
  dark: { bg: "#0d1117", ink: "#f0f6fc", muted: "#9198a1", line: "#3d444d", code: "#151b23", done: "#3fb950", doneBg: "#12261e", chip: "#212830", out: "#0d1117" },
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function pageHtml(scheme) {
  const c = COLORS[scheme];
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  * { box-sizing: border-box }
  html, body { margin: 0; background: ${c.bg}; color-scheme: ${scheme} }
  #stage { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; padding: 18px 20px 20px; background: ${c.bg}; color: ${c.ink}; font: 14px/1.4 "Instrument Sans", system-ui, sans-serif; overflow: hidden }
  .ask { display: flex; align-items: baseline; gap: 14px; height: 48px }
  .ask q { flex: 1; font-size: 15px; font-weight: 600; quotes: "\\201C" "\\201D"; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
  .ask span { flex: none; font-size: 12.5px; color: ${c.muted} }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px }
  .col { border: 1px solid ${c.line}; border-radius: 12px; overflow: hidden }
  .head { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-bottom: 1px solid ${c.line} }
  .head b { font-size: 16px; font-weight: 700 }
  .head i { flex: 1; font-style: normal; font-size: 12.5px; color: ${c.muted} }
  .clock { min-width: 74px; padding: 4px 10px; border-radius: 999px; background: ${c.chip}; font: 500 13px "IBM Plex Mono", ui-monospace, monospace; text-align: center; color: ${c.muted} }
  .clock.done { background: ${c.doneBg}; color: ${c.done} }
  .out { position: relative; height: 412px; background: ${c.out}; overflow: hidden }
  .out canvas { display: block }
  .out iframe { display: block; width: 100%; height: 100%; border: 0 }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; color: ${c.muted} }
  .code { height: 94px; padding: 9px 14px 0; border-top: 1px solid ${c.line}; background: ${c.code} }
  .code small { display: block; margin-bottom: 4px; font-size: 11.5px; color: ${c.muted} }
  .code pre { margin: 0; font: 11px/1.45 "IBM Plex Mono", ui-monospace, monospace; color: ${c.ink}; white-space: pre; overflow: hidden }
  .code pre div { overflow: hidden; text-overflow: ellipsis }
  #cursor { position: absolute; left: 0; top: 0; width: 22px; height: 22px; display: none; pointer-events: none }
  #ring { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 2px solid ${c.done}; border-radius: 50%; display: none; pointer-events: none }
</style></head><body>
<div id="stage">
  <div class="ask"><q>${esc(rec.request)}</q><span>${esc(model)} · real time</span></div>
  <div class="cols">
    ${["sayshape", "html"].map((f) => `<div class="col" id="${f}">
      <div class="head"><b>${f === "sayshape" ? "SayShape" : "HTML"}</b><i>${f === "sayshape" ? "drawn as each line arrives" : "in a sandboxed iframe"}</i><span class="clock">0.0 s</span></div>
      <div class="out">${f === "sayshape" ? "<canvas></canvas>" : ""}<div class="wait">Waiting for the model…</div></div>
      <div class="code"><small></small><pre></pre></div>
    </div>`).join("")}
  </div>
  <div id="ring"></div>
  <svg id="cursor" viewBox="0 0 22 22"><path d="M4 2l13 9.5-5.6 1L15 19l-2.6 1.3-3.5-6.6L4 17.5z" fill="${c.ink}" stroke="${c.bg}" stroke-width="1.4" stroke-linejoin="round"/></svg>
</div></body></html>`;
}

/** Runs in the page: draws both answers as they stood `t` ms after the request was sent. */
function setUp({ rec, scheme }) {
  const $ = (sel) => document.querySelector(sel);
  const ui = new sayshape.SayShape($("#sayshape canvas"), {
    components: sayshape.coreComponents,
    theme: scheme === "dark" ? sayshape.darkTheme : sayshape.lightTheme,
    animate: false,
    padding: 16,
  });
  // The same reading of an HTML answer as the website's /compare page.
  const htmlSoFar = (raw) => {
    const fence = raw.indexOf("```");
    if (fence < 0) return raw;
    const start = raw.indexOf("\n", fence);
    if (start < 0) return "";
    const body = raw.slice(start + 1), close = body.indexOf("```");
    return close < 0 ? body : body.slice(0, close);
  };
  const textAt = (f, t) => rec.formats[f].chunks.filter((c) => c[0] <= t).map((c) => c[1]).join("");
  const shown = { sayshape: null, html: null };
  let frame = null, streaming = false;

  const panel = (f, t) => {
    const done = t >= rec.formats[f].doneMs, text = textAt(f, t), el = $("#" + f);
    const clock = el.querySelector(".clock");
    clock.textContent = (done ? "✓ " : "") + (Math.min(t, rec.formats[f].doneMs) / 1000).toFixed(1) + " s";
    clock.classList.toggle("done", done);
    el.querySelector(".wait").style.display = text ? "none" : "";
    el.querySelector("small").textContent = text ? `${text.length.toLocaleString("en-US")} characters${done ? "" : " so far"}` : "";
    const tail = text.trimEnd().split("\n").slice(-4);
    el.querySelector("pre").replaceChildren(...(text ? tail : []).map((l) => Object.assign(document.createElement("div"), { textContent: l || " " })));
    return { done, text };
  };

  window.hero = {
    async at(t) {
      const s = panel("sayshape", t);
      if (s.text !== shown.sayshape) {
        if (!streaming) { ui.beginStream(); streaming = true; }
        ui.push(s.text.slice((shown.sayshape ?? "").length));
        shown.sayshape = s.text;
      }
      if (s.done && streaming) { ui.endStream(); streaming = false; }

      const h = panel("html", t), body = htmlSoFar(h.text);
      if (body !== shown.html) {
        shown.html = body;
        frame?.remove();
        frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        const loaded = new Promise((r) => { frame.onload = r; setTimeout(r, 4000); });
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>body{margin:16px;font-family:system-ui,sans-serif}</style></head><body>${body}</body></html>`;
        $("#html .out").prepend(frame);
        await loaded;
        // Scripts the answer loads (a chart library, say) draw a moment after the frame does.
        if (h.done) await new Promise((r) => setTimeout(r, 1200));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    /** Where the engine's accessibility mirror says the element with this name is. */
    find(name) {
      for (const el of document.querySelectorAll("#sayshape [aria-label], #sayshape button, #sayshape [role]")) {
        if ((el.getAttribute("aria-label") ?? el.textContent ?? "").trim() !== name) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    },
    cursor(x, y, ring) {
      Object.assign($("#cursor").style, { display: "block", transform: `translate(${x - 4}px, ${y - 2}px)` });
      Object.assign($("#ring").style, { display: ring ? "block" : "none", left: x + "px", top: y + "px" });
    },
  };
  return document.fonts.ready.then(() => Promise.all(['600 15px "Instrument Sans"', '500 13px "IBM Plex Mono"'].map((f) => document.fonts.load(f)))).then(() => true);
}

/** A screenshot's pixels as RGBA. Chromium writes plain 8-bit PNGs, which is all this reads. */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, kind = 0;
  const data = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4); kind = body[9];
      if (body[8] !== 8 || (kind !== 2 && kind !== 6) || body[12] !== 0) throw new Error("Unexpected PNG format from the screenshot");
    } else if (type === "IDAT") data.push(body);
    p += 12 + len;
  }
  const bpp = kind === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(data));
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * bpp;
      out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

/**
 * Frames to a GIF. Each frame stores only the pixels that changed since the
 * one before, with its own palette for just those pixels, so gradients and
 * small text keep their colors; a frame where nothing changed is folded into
 * the wait before it.
 */
function encode(frames) {
  const { w, h } = frames[0];
  const gif = GIFEncoder();
  let prev = null, written = 0;
  const pending = [];
  for (const f of frames) {
    const now = new Uint32Array(f.rgba.buffer), was = prev && new Uint32Array(prev.buffer);
    const changed = [];
    for (let i = 0; i < now.length; i++) if (!was || now[i] !== was[i]) changed.push(i);
    if (!changed.length) { pending[pending.length - 1].delay += f.delay; continue; }
    const pixels = new Uint8Array(changed.length * 4);
    for (let k = 0; k < changed.length; k++) pixels.set(f.rgba.subarray(changed[k] * 4, changed[k] * 4 + 4), k * 4);
    const palette = quantize(pixels, 255), CLEAR = palette.length;
    // Flat areas (backgrounds, borders) must come out exactly, or text that was there leaves a faint mark.
    const counts = new Map();
    const colors = new Uint32Array(pixels.buffer);
    for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
    const taken = new Set();
    for (const [c] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, 16)) {
      const rgb = [c & 255, (c >> 8) & 255, (c >> 16) & 255];
      let best = -1, far = Infinity;
      palette.forEach((q, i) => { const d = (q[0] - rgb[0]) ** 2 + (q[1] - rgb[1]) ** 2 + (q[2] - rgb[2]) ** 2; if (d < far && !taken.has(i)) { far = d; best = i; } });
      if (best >= 0) { palette[best] = rgb; taken.add(best); }
    }
    const picked = applyPalette(pixels, palette);
    const index = new Uint8Array(w * h).fill(CLEAR);
    for (let k = 0; k < changed.length; k++) index[changed[k]] = picked[k];
    pending.push({ index, palette: [...palette, [0, 0, 0]], delay: f.delay, clear: CLEAR, first: !prev });
    prev = f.rgba;
  }
  for (const f of pending) {
    gif.writeFrame(f.index, w, h, f.first ? { palette: f.palette, delay: f.delay, repeat: 0 } : { palette: f.palette, delay: f.delay, transparent: true, transparentIndex: f.clear, dispose: 1 });
    written++;
  }
  gif.finish();
  return { bytes: gif.bytes(), written };
}

async function record(browser, scheme) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE, colorScheme: scheme });
  await page.setContent(pageHtml(scheme), { waitUntil: "networkidle" });
  await page.addScriptTag({ path: ENGINE });
  await page.evaluate(setUp, { rec, scheme });
  const stage = page.locator("#stage");
  const frames = [];
  const shoot = async (delay) => { frames.push({ ...decodePng(await stage.screenshot()), delay }); };

  // Every moment something is drawn: a steady beat, plus the instant each SayShape piece landed.
  const end = Math.max(rec.formats.sayshape.doneMs, rec.formats.html.doneMs);
  const times = new Set([end, rec.formats.sayshape.doneMs]);
  for (let t = 0; t < end; t += STEP_MS) times.add(t);
  for (const c of rec.formats.sayshape.chunks) times.add(c[0]);
  const order = [...times].sort((a, b) => a - b);
  for (let i = 0; i < order.length; i++) {
    await page.evaluate((t) => window.hero.at(t), order[i]);
    await shoot(i + 1 < order.length ? order[i + 1] - order[i] : HOLD_MS);
  }

  // Then use it: the pointer goes to one control on the SayShape screen and presses it.
  const to = await page.evaluate((name) => window.hero.find(name), PRESS);
  if (!to) throw new Error(`Nothing named "${PRESS}" on the SayShape screen`);
  const from = { x: to.x + 90, y: to.y + 150 };
  for (const k of [0, 0.45, 0.8, 1]) {
    await page.evaluate(([x, y]) => window.hero.cursor(x, y, false), [from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k]);
    await shoot(k === 1 ? 260 : 90);
  }
  await page.mouse.click(to.x, to.y);
  await page.evaluate(([x, y]) => window.hero.cursor(x, y, true), [to.x, to.y]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shoot(260);
  await page.evaluate(([x, y]) => window.hero.cursor(x, y, false), [to.x, to.y]);
  await shoot(END_MS);
  await page.close();
  return frames;
}

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const frames = await record(browser, scheme);
  const { bytes, written } = encode(frames);
  const file = `docs/images/hero-${scheme}.gif`;
  writeFileSync(resolve(root, file), bytes);
  console.log(`${file}: ${written} frames, ${frames[0].w}×${frames[0].h}, ${(bytes.length / 1024).toFixed(0)} KB`);
}
await browser.close();
