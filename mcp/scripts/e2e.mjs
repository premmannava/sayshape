// End-to-end check of the built view in a real browser, inside a sandboxed
// iframe driven by the MCP Apps host bridge, the way Claude or ChatGPT run it:
// handshake, streamed tool input, the final spec, theme changes, resizing, and
// an emit: action arriving back as a message.
//
//   npm run build && npm run test:e2e        screenshots go to e2e-output/
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "@playwright/test";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../e2e-output/");
mkdirSync(out, { recursive: true });

const uiHtml = readFileSync(here("../dist/ui.html"), "utf8");
if (/\b(src|href)=["']https?:/i.test(uiHtml)) throw new Error("ui.html loads something from another origin");

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    outDir: out + "host",
    emptyOutDir: true,
    lib: { entry: here("../test/host/host.ts"), name: "TestHost", formats: ["iife"], fileName: () => "host.js" },
  },
});
const hostJs = readFileSync(out + "host/host.js", "utf8");

const SPEC = `state hikers=3 days=2
state gear=[{id: 1, item: "Tent", kg: 2.4}, {id: 2, item: "Stove", kg: 0.6}, {id: 3, item: "Water filter", kg: 0.3}]
derive water={hikers * days * 3}
card
  text "Weekend hike planner" style=title
  text "Numbers update as you change the trip." tone=muted
  row
    stepper "Hikers" bind=hikers min=1 max=12
    stepper "Days" bind=days min=1 max=7
  grid min=140 gap=10
    stat label="Water to carry" value="{water} L" tone=accent
    stat label="Gear items" value={len(gear)}
  chart "Gear weight (kg)" kind=bar items=gear x=item y=kg
  button "Plan this trip" on=emit:plan_trip:{hikers}
`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failures.push(what); };
const frameBackground = async (page) => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  return frame.evaluate(() => getComputedStyle(document.querySelector("#sayshape")).backgroundColor);
};
const colorPixels = (frame, selector, rgb) => frame.evaluate(({ selector, rgb }) => {
  const c = document.querySelector(selector);
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let count = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === rgb[0] && d[i + 1] === rgb[1] && d[i + 2] === rgb[2] && d[i + 3] > 0) count++;
  return count;
}, { selector, rgb });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setContent(`<!doctype html><body style="margin:20px;font-family:sans-serif;background:#fff"><script>${hostJs}</script></body>`);
  // The same Content Security Policy chat apps give the view: inline scripts and styles, no eval.
  // A violation is logged as a console error, so "no errors in the page" catches it.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:">`;
  const listen = `<script>document.addEventListener("securitypolicyviolation", (e) => console.error("Content Security Policy blocked " + e.violatedDirective))</script>`;
  // Started with --theme-picker, as the server would write it into the view.
  const withPicker = uiHtml.replace(/<head>/i, `<head><meta name="sayshape-view" content="picker=1&theme=teal&save=1">`);
  const strict = withPicker.replace(/<head>/i, `<head>${csp}${listen}`);
  check(strict !== withPicker, "the view runs under a strict Content Security Policy");
  // This host can download files, so the view offers "Save image" beside the theme picker.
  await page.evaluate((html) => window.TestHost.mount(html, "light", undefined, false, true), strict);
  await page.evaluate(() => window.host.ready);
  check(true, "the view completed the MCP Apps handshake");

  // Stream the tool input a few lines at a time, the way a client forwards a model's tool call.
  const lines = SPEC.split("\n");
  for (let n = 1; n <= lines.length; n++) {
    const partial = lines.slice(0, n).join("\n") + (n < lines.length ? "\n" : "");
    await page.evaluate((spec) => window.host.bridge.sendToolInputPartial({ arguments: { spec } }), partial);
    await page.waitForTimeout(40);
    if (n === 8) await page.screenshot({ path: out + "1-streaming.png" });
  }
  // Sent with the fences and typographic quotes models slip into; the view tidies them like the server.
  await page.evaluate((spec) => window.host.bridge.sendToolInput({ arguments: { spec } }), "```\n" + SPEC.replace('"Weekend hike planner"', "“Weekend hike planner”") + "```\n");
  await page.evaluate(() => window.host.bridge.sendToolResult({ content: [{ type: "text", text: "The interface is showing in the conversation, with no problems." }] }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "2-final-light.png" });
  // The 20px root padding outside a card must not expose a dark iframe background.
  const lightBacking = await frameBackground(page);
  check(lightBacking === "rgb(255, 255, 255)", `light MCP Canvas gutter follows the light theme (${lightBacking})`);

  const sizes = await page.evaluate(() => window.host.sizes);
  check(sizes.length > 0 && Math.max(...sizes) > 300, `the view reported its height to the host (${Math.max(0, ...sizes)}px)`);

  const frame = page.frames().find((f) => f !== page.mainFrame());
  const painted = await frame.evaluate(() => {
    const c = document.querySelector("#sayshape");
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) ink++;
    return { w: c.width, h: c.height, ink };
  });
  check(painted.h > 300 && painted.ink > 50, `the engine painted the canvas (${painted.w}×${painted.h}, ${painted.ink} sampled pixels)`);

  // The trusted picker changes the preset without replacing the model's spec or emitting an action.
  // The toolbar is one slim strip at the right: the theme selector, then the download icon.
  const bar = await frame.evaluate(() => {
    const r = document.querySelector("#view-tools").getBoundingClientRect();
    return { x: r.x, w: r.width, h: r.height, page: document.documentElement.clientWidth };
  });
  check(bar.h <= 56 && Math.round(bar.page - (bar.x + bar.w)) === 14, `the toolbar is a slim strip at the right, lined up with the interface (${Math.round(bar.w)}×${Math.round(bar.h)})`);
  await frame.locator("#view-tools").click({ position: { x: 60, y: 26 } });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
  check(await colorPixels(frame, "#sayshape", [109, 40, 217]) > 0, "selecting Purple updates the chart palette");
  check((await page.evaluate(() => window.host.messages)).length === 0, "theme selection stays local and sends nothing to the model");

  // Press the emit button with the keyboard: focus the canvas, Tab through the controls, Enter.
  await frame.locator("#sayshape").focus();
  let sent = [];
  for (let i = 0; i < 12 && !sent.length; i++) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    sent = await page.evaluate(() => window.host.context.filter((m) => m.includes("plan_trip")));
  }
  const shown = await page.evaluate(() => window.host.messages);
  check(sent.length === 1 && shown.length === 1, "pressing the emit: button sent one message to the conversation");
  check(/^Plan trip(: \d+)?$/.test(shown[0] ?? ""), `the conversation shows a short line, with no tags or JSON ("${shown[0]}")`);
  check(/I pressed "plan_trip" with the value \d+/.test(sent[0] ?? ""), "the model context names the action and its value");
  check(/"hikers":\d+/.test(sent[0] ?? "") && /"gear":\[/.test(sent[0] ?? ""), "the model context carries the interface's state");
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "3-after-emit.png" });

  // "Save image" hands the host a PNG of the interface as it looks now, and tells the model nothing.
  const before = (await page.evaluate(() => window.host.messages)).length;
  await frame.locator("#view-tools").click({ position: { x: Math.round(bar.w - 26), y: 26 } });
  await page.waitForTimeout(400);
  const files = await page.evaluate(() => window.host.downloads);
  const png = files[0]?.blob ? Buffer.from(files[0].blob, "base64") : Buffer.alloc(0);
  check(files.length === 1 && files[0].mimeType === "image/png", `Save image asked the host to download one PNG (${files.map((f) => f.uri).join(", ")})`);
  check(files[0]?.uri === "file:///weekend-hike-planner.png", "the image is named after the interface's title");
  check(png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) > 300 && png.readUInt32BE(20) > 300, `the download is a real PNG of the interface (${png.length ? `${png.readUInt32BE(16)}×${png.readUInt32BE(20)}` : "empty"})`);
  writeFileSync(out + "5-saved.png", png);
  check((await page.evaluate(() => window.host.messages)).length === before, "saving sends nothing to the model");

  await page.evaluate(() => { document.body.style.background = "#1f1f1e"; window.host.bridge.setHostContext({ theme: "dark" }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + "4-dark.png" });
  check(await frame.evaluate(() => document.documentElement.dataset.theme === "dark"), "the view follows the host's dark theme");
  const darkBacking = await frameBackground(page);
  check(darkBacking === "rgb(18, 25, 28)", `Canvas gutter updates when the host switches to dark theme (${darkBacking})`);
  check(await colorPixels(frame, "#sayshape", [182, 156, 247]) > 0, "the selected Purple preset follows the host's dark palette");

  
  // VS Code can cap an MCP App's iframe height. A tall canvas then extends
  // past the iframe viewport. If the app document uses overflow:hidden, VS
  // Code's wheel-boundary logic sees the extra scrollHeight but the iframe
  // itself cannot move, trapping trackpad/mouse-wheel scrolling over the UI.
  // Keep this as a browser regression using the real, built MCP App view.
  await page.addStyleTag({ content: "iframe { max-height: 260px !important; }" });
  // Wait for the frame to be laid out at the capped height before measuring inside it.
  await frame.waitForFunction(() => innerHeight <= 262, undefined, { timeout: 2000 }).catch(() => {});
  const constrained = await frame.evaluate(() => ({
    scrollable: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    overflow: getComputedStyle(document.body).overflowY,
  }));
  check(constrained.scrollable > 100, `a constrained MCP App has overflowing content (${constrained.scrollable}px)`);
  check(constrained.overflow === "auto", "the MCP view allows vertical scrolling inside a constrained host");
  await page.mouse.move(150, 120); // inside the canvas and the constrained iframe
  await page.mouse.wheel(0, 350);
  await page.waitForTimeout(120);
  const scrolled = await frame.evaluate(() => window.scrollY);
  check(scrolled > 50, `wheel scrolling over the canvas moves the iframe document (${scrolled}px)`);
  await page.mouse.wheel(0, -350);
  await page.waitForTimeout(120);
  check((await frame.evaluate(() => window.scrollY)) < scrolled, "wheel scrolling over the canvas works in reverse");
  await page.addStyleTag({ content: "iframe { max-height: none !important; }" });


  // A host that sends its own design tokens, as Claude and ChatGPT do, with light-dark() values.
  const styled = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 2 });
  styled.on("pageerror", (e) => errors.push(e.message));
  await styled.setContent(`<!doctype html><body style="margin:20px;background:#262624"><script>${hostJs}</script></body>`);
  await styled.evaluate((html) => window.TestHost.mount(html, "dark", {
    "--color-background-primary": "light-dark(rgb(255, 255, 255), rgb(48, 48, 46))",
    "--color-text-primary": "light-dark(rgb(20, 20, 19), rgb(250, 249, 245))",
    "--color-text-secondary": "rgb(194, 192, 182)",
    "--color-border-primary": "rgba(222, 220, 209, 0.3)",
    "--font-sans": "Georgia, serif",
    "--border-radius-lg": "4px",
  }), uiHtml);
  await styled.evaluate(() => window.host.ready);
  await styled.evaluate((spec) => window.host.bridge.sendToolInput({ arguments: { spec } }), SPEC);
  await styled.waitForTimeout(700);
  await styled.screenshot({ path: out + "5-host-styles.png" });
  const styledFrame = styled.frames().find((f) => f !== styled.mainFrame());
  const hostBacking = await styledFrame.evaluate(() => getComputedStyle(document.querySelector("#sayshape")).backgroundColor);
  check(hostBacking === "rgb(48, 48, 46)", `Canvas gutter respects the host's custom surface color (${hostBacking})`);
  // Started without flags, in a chat app that can't download: no theme picker, no download, no toolbar at all.
  check(await styledFrame.evaluate(() => document.querySelector("#bar").hidden), "without flags or downloads the view shows no toolbar");
  const cardPixel = await styledFrame.evaluate(() => {
    const c = document.querySelector("#sayshape");
    // A point inside the card, left of the title and above it.
    const d = c.getContext("2d").getImageData(Math.round(c.width * 0.1), Math.round(c.height * 0.06), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  // Cards follow the host's background with a 4.5% lift toward its ink in
  // dark mode. The old E2E expected the raw background and was inconsistent
  // with the intentionally raised surfaces and the host-theme unit tests.
  const expectedRaised = [48, 48, 46].map((channel, i) =>
    Math.round(channel + ([250, 249, 245][i] - channel) * 0.045));
  check(cardPixel.every((channel, i) => Math.abs(channel - expectedRaised[i]) <= 3),
    `the card matches the raised host light-dark() surface (expected rgb(${expectedRaised.join(", ")}), got rgb(${cardPixel.join(", ")})`);

  // A view whose result says the spec needs fixing folds into a short note, and comes back on request;
  // one whose result says it repeats the interface above folds into a single line.
  const foldPage = async (structuredContent) => {
    const p = await browser.newPage({ viewport: { width: 680, height: 900 }, deviceScaleFactor: 2 });
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.setContent(`<!doctype html><body style="margin:20px;background:#fff"><script>${hostJs}</script></body>`);
    await p.evaluate((html) => window.TestHost.mount(html, "light"), uiHtml);
    await p.evaluate(() => window.host.ready);
    await p.evaluate((spec) => window.host.bridge.sendToolInput({ arguments: { spec } }), SPEC);
    await p.waitForTimeout(500);
    const full = await p.evaluate(() => window.host.sizes.at(-1));
    await p.evaluate((sc) => window.host.bridge.sendToolResult({ content: [{ type: "text", text: "result" }], structuredContent: sc }), structuredContent);
    await p.waitForTimeout(500);
    return { p, full, folded: await p.evaluate(() => window.host.sizes.at(-1)) };
  };
  const fixing = await foldPage({ toFix: 2, repeat: false });
  await fixing.p.screenshot({ path: out + "7-fixing.png" });
  check(fixing.folded < 200 && fixing.full > 300, `a view whose spec needs fixing folds into a short note (${fixing.full}px → ${fixing.folded}px)`);
  const foldedFrame = fixing.p.frames().find((f) => f !== fixing.p.mainFrame());
  await foldedFrame.locator("#sayshape").focus();
  let restored = fixing.folded;
  for (let i = 0; i < 4 && restored < 300; i++) {
    await fixing.p.keyboard.press("Tab");
    await fixing.p.keyboard.press("Enter");
    await fixing.p.waitForTimeout(300);
    restored = await fixing.p.evaluate(() => window.host.sizes.at(-1));
  }
  check(restored > 300, `"Show this version" brings it back (${restored}px)`);
  check((await fixing.p.evaluate(() => window.host.messages)).length === 0, "and sends nothing to the model");
  const repeat = await foldPage({ toFix: 0, repeat: true });
  await repeat.p.screenshot({ path: out + "8-repeat.png" });
  check(repeat.folded < 180, `a repeat of the interface above folds into one line (${repeat.folded}px)`);
  const kept = await foldPage({ toFix: 0, repeat: false });
  check(kept.folded > 300, `a good interface stays as it is (${kept.folded}px)`);

  check(errors.length === 0, `no errors in the page${errors.length ? ": " + errors.join(" | ") : ""}`);
  writeFileSync(out + "messages.json", JSON.stringify(await page.evaluate(() => window.host.messages), null, 2));
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots in ${out}`);
