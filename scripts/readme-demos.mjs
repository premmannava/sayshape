/**
 * Draws the README's two small animated pictures of the experimental
 * features: a scene (three balls bouncing) and behavior (a countdown that
 * ticks while a ball is dragged).
 *
 *   npm run readme:demos
 *
 * Nothing in them is staged. Each spec below is the one printed in the README,
 * drawn by the engine from src/ in a real browser. The browser's clock is
 * stepped by hand, so every frame is taken at an exact time and the loops
 * join up. The drag is a real pointer drag; only the arrow is drawn on top.
 *
 * Writes docs/images/demo-<name>-light.gif and -dark.gif.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encode } from "./gif.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 560, SCALE = 2, FRAME_MS = 40;
/** GitHub's page colors, so the pictures sit on the README without an edge. */
const PAGE = { light: "#ffffff", dark: "#0d1117" };

export const DEMOS = {
  draw: {
    spec: `scene "Three balls bouncing on a floor" w=600 h=260 duration=1
  each items={range(3)} as=i
    ellipse x={150 + 150*i} y=236 rx={50 - 22*abs(sin(PI*(t + i/3)))} ry=7 fill="ink 20%"
    circle x={150 + 150*i} y={204 - 140*abs(sin(PI*(t + i/3)))} r=30 fill={pick(colors, i)} shine=true
`,
    state: `state colors=["accent", "warn", "good"]\n`,
    // One bounce is one second: 25 frames, and the last runs into the first.
    async play(page, shoot) {
      for (let i = 0; i < 1000 / FRAME_MS; i++) { await shoot(FRAME_MS); await page.clock.runFor(FRAME_MS); }
    },
  },
  behavior: {
    spec: `state x=300 left=10 running=true
every 1s if={running && left > 0} do=dec:left
card
  text "Drag the ball. {left} seconds left." style=title
  scene "A ball you can drag" w=600 h=160
    line x1=40 y1=118 x2=560 y2=118 stroke=line width=2
    circle x={clamp(x, 40, 560)} y=84 r=30 fill=accent shine=true shadow=md drag=true
  button "Pause or resume" variant=secondary on=toggle:running
`,
    state: "",
    // The pointer comes in, takes the ball right, then left, then lets go, while the seconds count down.
    async play(page, shoot) {
      const ball = await page.evaluate(() => window.demo.find());
      if (ball.missing !== undefined) throw new Error(`No draggable shape found. The mirror holds: ${ball.missing}`);
      const step = async (x, y, down) => {
        await page.mouse.move(x, y);
        await page.evaluate(([cx, cy, d]) => window.demo.cursor(cx, cy, d), [x, y, down]);
        await page.clock.runFor(FRAME_MS);
        await shoot(FRAME_MS);
      };
      const glide = async (from, to, n, down) => {
        for (let i = 1; i <= n; i++) {
          const k = i / n, e = k * k * (3 - 2 * k);
          await step(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, down);
        }
      };
      const start = { x: ball.x + 120, y: ball.y + 110 }, right = { x: ball.x + 170, y: ball.y }, left = { x: ball.x - 170, y: ball.y };
      await glide(start, ball, 14, false);
      await page.mouse.down();
      await glide(ball, right, 24, true);
      await glide(right, left, 40, true);
      await glide(left, ball, 24, true);
      await page.mouse.up();
      await glide(ball, start, 14, false);
      for (let i = 0; i < 20; i++) { await page.clock.runFor(FRAME_MS); await shoot(FRAME_MS); }
    },
  },
};

/** Runs in the page: the engine from src/, a spec, and an arrow to show where the pointer is. */
async function setUp({ spec, scheme, width, behavior }) {
  await Promise.all([400, 600, 700].map((w) => import(/* @vite-ignore */ `/node_modules/@fontsource/instrument-sans/${w}.css`)));
  await Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 16px "Instrument Sans"`)));
  const [{ SayShape }, { coreComponents }, { sceneComponents }, { lightTheme, darkTheme }] = await Promise.all([
    import("/src/engine.ts"), import("/src/components/index.ts"), import("/src/components/scene/index.ts"), import("/src/theme.ts"),
  ]);
  const canvas = document.getElementById("canvas");
  const ui = new SayShape(canvas, {
    components: [...coreComponents, ...sceneComponents],
    theme: scheme === "dark" ? darkTheme : lightTheme,
    width,
    ...(behavior ? { behavior: true } : {}),
  });
  ui.setSpec(spec);
  const arrow = document.getElementById("arrow");
  window.demo = {
    /** The middle of the shape people can drag, in page pixels, from where the screen-reader mirror puts it. */
    find() {
      ui.renderNow();
      const el = document.querySelector('[data-sayshape-a11y] input[type="range"], [data-sayshape-a11y] [role="slider"]');
      if (!el) return { missing: [...document.querySelectorAll("[data-sayshape-a11y] *")].map((e) => `${e.tagName}:${e.getAttribute("role") ?? e.getAttribute("type") ?? ""}`).join(" ") };
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    cursor(x, y, down) {
      arrow.style.display = "block";
      arrow.style.transform = `translate(${x}px, ${y}px) scale(${down ? 0.86 : 1})`;
    },
  };
}

const pageHtml = (scheme) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: ${PAGE[scheme]}; color-scheme: ${scheme} }
  #stage { position: relative; display: inline-block; padding: 12px; background: ${PAGE[scheme]} }
  canvas { display: block }
  #arrow { display: none; position: fixed; left: 0; top: 0; width: 22px; height: 22px; transform-origin: 0 0; pointer-events: none }
</style></head><body><div id="stage"><canvas id="canvas"></canvas></div>
<svg id="arrow" viewBox="0 0 22 22"><path d="M2 1 L2 17 L6.5 13 L9.5 20 L12.5 18.7 L9.6 12 L15.5 12 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
</body></html>`;

async function record(browser, base, name, demo, scheme) {
  const page = await browser.newPage({ viewport: { width: WIDTH + 40, height: 600 }, deviceScaleFactor: SCALE, colorScheme: scheme });
  page.on("pageerror", (e) => { throw e; });
  await page.clock.install({ time: 0 });
  await page.route(`${base}/__demo.html`, (r) => r.fulfill({ contentType: "text/html", body: pageHtml(scheme) }));
  await page.goto(`${base}/__demo.html`);
  await page.evaluate(setUp, { spec: demo.state + demo.spec, scheme, width: WIDTH, behavior: demo.spec.includes("every ") });
  await page.clock.pauseAt(1000);
  await page.clock.runFor(200);
  const stage = page.locator("#stage");
  const frames = [];
  await demo.play(page, async (delay) => {
    const png = await stage.screenshot();
    // FRAMES=<folder> also saves every tenth frame as a PNG, to look at one without a GIF viewer.
    if (process.env.FRAMES && frames.length % 10 === 0) writeFileSync(resolve(process.env.FRAMES, `${name}-${scheme}-${String(frames.length).padStart(3, "0")}.png`), png);
    frames.push({ ...decodePng(png), delay });
  });
  await page.close();
  return frames;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await createServer({ configFile: resolve(root, "visual/vite.config.ts"), server: { port: 5197, strictPort: true }, logLevel: "error" });
  await server.listen();
  const browser = await chromium.launch();
  try {
    for (const [name, demo] of Object.entries(DEMOS)) {
      for (const scheme of ["light", "dark"]) {
        const frames = await record(browser, "http://localhost:5197", name, demo, scheme);
        const { bytes, written } = encode(frames);
        const file = `docs/images/demo-${name}-${scheme}.gif`;
        writeFileSync(resolve(root, file), bytes);
        console.log(`${file}: ${written} frames, ${frames[0].w}×${frames[0].h}, ${(bytes.length / 1024).toFixed(0)} KB`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}
