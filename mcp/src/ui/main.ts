/**
 * The view an MCP Apps client shows for show_interface: the SayShape engine
 * drawing the model's spec on a canvas, inside the client's sandboxed iframe.
 *
 * - While the model is still writing the tool call, clients that stream tool
 *   input send growing copies of the spec, and the engine draws each finished
 *   line as it arrives.
 * - When the call is complete, the full spec replaces whatever streamed.
 * - An emit: action is the only thing that leaves the interface: it becomes a
 *   message in the conversation, with the action, its value and the
 *   interface's state, so the model can answer it.
 */
import "./no-eval";
import { App, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { SayShape } from "../../../src/engine";
import { coreComponents } from "../../../src/components";
import { mapComponents } from "../../../src/components/map";
import { sceneComponents } from "../../../src/components/scene";
import type { Theme } from "../../../src/theme";
import type { Box, Value } from "../../../src/types";
import { tidySpec } from "../../../src/model/clean";
import { eventDelivery, imageName, nextChunk, outcomeOf } from "./messages";
import { firstFamily, type ReadVar } from "./host-theme";
import { needsToolbarRow } from "./toolbar-room";
import { COPY_ACTION, DECK_ACTION, DEFAULT_PRESET, PRESENT_ACTION, interfaceTheme, isPresetId, MOTION_ACTION, SAVE_ACTION, TOOLBAR_PADDING, toolbarSpec, toolbarWidth, themeForPreset, type Tools } from "./theme-selection";
import { browserClipboard, writeClipboard } from "./clipboard";
import { toolButton } from "./tool-button";
import { deflated, fromDataUrl, pdfOf, pptxOf, rgbOf, toBase64, type SlidePicture } from "./deck-file";
import { readViewOptions } from "./view-options";
import { announce, brandColorFor, chosenColors, colorsArrival, sameColors, toolColors } from "./host-brand";

const FACES = ['400 15px "Instrument Sans"', '600 15px "Instrument Sans"', '700 15px "Instrument Sans"'];

const bar = document.querySelector<HTMLElement>("#bar")!;
const themeCanvas = document.querySelector<HTMLCanvasElement>("#view-tools")!;
/** What the server was started with: --theme-picker, --theme, --no-save-image, --no-copy-text. */
const viewOptions = readViewOptions(document);
const canvas = document.querySelector<HTMLCanvasElement>("#sayshape")!;
const app = new App({ name: "SayShape", version: "0.4.0" }, {}, { autoResize: true });

let sayshape: SayShape | null = null;
let themePicker: SayShape | null = null;
let activePreset = viewOptions.theme;
/** True once the person picks a preset in the toolbar's selector (the one the server started with is not a pick). */
let presetPicked = false;
/** The chat app's brand color, from the name it announced in the handshake. */
let hostBrand: string | undefined;
/**
 * This call's colors argument (the conversation's colors), above every other source of colors. Each
 * show_interface call gets a view of its own, so a call without colors starts from the operator's, a picked
 * preset's or the chat app's again; nothing here outlives the view. Ignored with --no-model-colors.
 */
let conversationColors: string[] | undefined;
/** Counts changes to conversationColors, so a theme worked out before one isn't painted after it. */
let colorsVersion = 0;
/** Whether the console has been told when the colors arrived (once per view). */
let colorsLogged = false;
/** The spec text the engine has been given so far in the current stream. */
let shown = "";
/** Input that arrived before the engine was ready. */
let pending: { spec: string; final: boolean } | null = null;
/**
 * Rows from the database, by the name the spec uses (show_interface's data
 * argument). They're fetched from the server by the interface itself, so they
 * never pass through the model, and put back after anything that resets state.
 */
const hostData = new Map<string, Value>();
let pendingData: Record<string, string> | null = null;
/** Datasets still being fetched: elements that read them draw placeholders until they arrive. */
const loadingData = new Set<string>();
/** True while the spec is still streaming in, before the data argument is known. */
let awaiting = false;

/**
 * What the view shows before the first line of a spec arrives (some chat apps
 * only send the spec once it's complete): the outline of a card, shimmering.
 */
const INTRO = `card
  skeleton lines=1
  skeleton shape=block height=150
  skeleton lines=2
`;
let introShowing = false;

/**
 * Smaller models send flawed or repeated interfaces more often, and each call
 * makes a new view in the chat, so a view hides itself completely (the host
 * sizes the frame from its content, so it collapses to nothing) once its
 * result says a corrected or identical one is coming or already shown.
 */
let folded = false;
let pendingOutcome: "fixing" | "repeat" | null = null;

function fold(outcome: "fixing" | "repeat"): void {
  if (!sayshape) { pendingOutcome = outcome; return; }
  folded = true;
  loadingData.clear();
  awaiting = false;
  syncLoading();
  // The wrapper holds both the toolbar and the canvas, so nothing inside can show it again.
  const wrapEl = bar.parentElement;
  if (wrapEl) wrapEl.hidden = true;
}

function syncLoading(): void {
  sayshape?.setLoading(loadingData);
  sayshape?.setAwaiting(awaiting);
}

const prefersDark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
const SENTINEL = "rgb(1, 2, 3)";

/**
 * Reads host variables as values the canvas understands. Colors and lengths
 * go through a hidden probe so the browser resolves var(), light-dark() and
 * relative units; a variable that isn't a valid color leaves the probe at the
 * sentinel, and is ignored.
 */
function domReader(dark: boolean): ReadVar {
  const root = document.documentElement;
  const wrap = document.createElement("div");
  // color-scheme only on the probe: light-dark() resolves for the host's theme, and the page
  // itself stays transparent over the chat (a page-wide scheme can make browsers paint it opaque).
  wrap.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${SENTINEL};color-scheme:${dark ? "dark" : "light"}`;
  const probe = document.createElement("span");
  wrap.append(probe);
  document.body.append(wrap);
  return (name, kind) => {
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    if (!raw) return undefined;
    if (kind === "font") return raw;
    if (kind === "color") {
      probe.style.color = `var(${name})`;
      const c = getComputedStyle(probe).color;
      return c && c !== SENTINEL ? c : undefined;
    }
    probe.style.borderTopLeftRadius = `var(${name})`;
    return getComputedStyle(probe).borderTopLeftRadius || undefined;
  };
}

/** The selected SayShape preset in the host's mode, with the call's colors argument, else the server's --colors (or --accent), else the chat app's brand color (see chosenColors), adjusted to the host's shared colors, fonts and radii. */
function themeFor(ctx: McpUiHostContext | undefined): Theme {
  const dark = ctx?.theme ? ctx.theme === "dark" : prefersDark();
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  const styles = ctx?.styles;
  if (styles?.css?.fonts) applyHostFonts(styles.css.fonts);
  if (styles?.variables) applyHostStyleVariables(styles.variables);
  return themeForPreset(activePreset, dark ? "dark" : "light", styles?.variables ? domReader(dark) : undefined, chosenColors({ conversationColors, operatorColors: viewOptions.colors, picked: presetPicked, startupPreset: viewOptions.theme, brand: hostBrand }));
}

/** Canvas text doesn't trigger font loading, so load the theme's faces before drawing with them. */
async function loadFaces(theme: Theme): Promise<void> {
  if (!document.fonts) return;
  const family = firstFamily(theme.font.family);
  const faces = family && family !== "Instrument Sans"
    ? [400, 600, 700].map((w) => `${w} 15px "${family}"`)
    : FACES;
  await Promise.race([
    Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => undefined),
    new Promise((done) => setTimeout(done, 1500)),
  ]);
}

async function applyTheme(ctx: McpUiHostContext | undefined): Promise<Theme> {
  const version = colorsVersion;
  let theme = themeFor(ctx);
  await loadFaces(theme);
  // Colors arrived while the fonts loaded: paint with them, not the theme from before.
  if (version !== colorsVersion) theme = themeFor(ctx);
  paintTheme(theme);
  return theme;
}

function paintTheme(theme: Theme): void {
  // The engine clears its bitmap to transparency each frame and leaves 20px
  // around the content. In an MCP iframe, that transparent gutter can expose
  // a black host surface even beside a light card. Paint the canvas element's
  // background using the resolved host-aware theme, without changing layout
  // or making the entire iframe opaque.
  canvas.style.backgroundColor = theme.colors.surface;
  bar.style.backgroundColor = theme.colors.surface;
  sayshape?.setTheme(faceTheme(theme));
  themePicker?.setTheme(theme);
}

/**
 * Use the tool call's colors argument. Called as the arguments stream in, so the first lines already draw
 * in the colors when the chat app sends them before the spec. A change only repaints: setTheme lays out
 * again and keeps the stream, state and everything drawn so far. The fonts don't change with the colors,
 * so there's nothing to wait for.
 */
function useConversationColors(list: string[] | undefined): void {
  if (sameColors(list, conversationColors)) return;
  if (list && !colorsLogged) {
    colorsLogged = true;
    // For checking in a real chat app whether the colors come before the spec.
    console.info(colorsArrival(list, shown));
  }
  conversationColors = list;
  colorsVersion++;
  // Before start() has painted, its own applyTheme picks them up.
  if (sayshape || themePicker) paintTheme(themeFor(app.getHostContext()));
}

/** Whether the server lets the conversation choose colors (not --no-model-colors). */
const modelColors = viewOptions.modelColors !== false;

/** The theme interfaces are drawn in, with the logo the server was started with (--logo) for slides. */
let face: Theme | null = null;
function faceTheme(theme: Theme): Theme {
  const t = interfaceTheme(theme);
  face = viewOptions.logo ? { ...t, deck: { ...t.deck, logo: viewOptions.logo } } : t;
  return face;
}

/** Whether the chat app is showing this view full screen. */
const isFull = (): boolean => app.getHostContext()?.displayMode === "fullscreen";

/**
 * Present: ask the chat app to show the view full screen, or to
 * put it back. Full screen, the deck is as wide as lets a whole slide and
 * its bar fit the height, in the middle.
 */
async function togglePresent(): Promise<void> {
  const mode = isFull() ? "inline" : "fullscreen";
  if (!app.getHostContext()?.availableDisplayModes?.includes(mode)) { sayshape?.notify("This app can't show it full screen"); return; }
  try { await app.requestDisplayMode({ mode }); } catch { sayshape?.notify("Couldn't change to full screen"); }
  fitScreen();
}

/** Room above and below a slide for the tools and the deck's bar, full screen, in pixels. */
const PRESENT_CHROME = 130;
function fitScreen(): void {
  const wrap = bar.parentElement;
  if (!wrap) return;
  const full = isFull() && showsDeck();
  // The height the chat app gives the view, when it says: the view's own window grows with what's in it, so it can't be trusted here.
  const dims = app.getHostContext()?.containerDimensions as { height?: number; maxHeight?: number } | undefined;
  const height = dims?.height ?? dims?.maxHeight ?? window.innerHeight;
  wrap.style.maxWidth = full ? `${Math.max(320, Math.round((height - PRESENT_CHROME) * (16 / 9)))}px` : "";
  wrap.style.margin = full ? "0 auto" : "";
  themePicker?.state.set("full", isFull());
}

function show(spec: string, final: boolean): void {
  if (!sayshape) { pending = { spec, final }; return; }
  if (introShowing) { introShowing = false; sayshape.beginStream(); shown = ""; applyHostData(); }
  const next = nextChunk(shown, spec);
  if (next.restart) { sayshape.beginStream(); shown = ""; applyHostData(); }
  if (next.add) { sayshape.push(next.add); shown += next.add; }
  if (final) {
    if (sayshape.isStreaming) sayshape.endStream();
    // The streamed text can differ from the final arguments (healed JSON); the final spec wins.
    if (sayshape.spec !== spec) { sayshape.setSpec(spec, { resetState: true }); applyHostData(); }
  }
  // The toolbar offers PDF and PowerPoint while a deck is showing.
  const deck = showsDeck();
  // The toolbar starts without the deck tools, so a view that never shows a deck looks as it always did.
  if (deck && !toolbarHasDeck) buildToolbar(true);
  themePicker?.state.set("deck", deck);
  // A slide fills the width up to its corner, so a deck's tools always get a row of their own.
  deckShowing = deck;
  placeToolbar();
  fitScreen();
}

/** Whether a deck is showing (its tools always take a row of their own). */
let deckShowing = false;
/** What the last check looked at, so a repaint with nothing laid out again costs nothing. */
let roomKey: { root: unknown; width: number; tools: number; deck: boolean } | null = null;
let roomMeasure: CanvasRenderingContext2D | null | undefined;
const measureText = (text: string, font: string): number => {
  roomMeasure ??= document.createElement("canvas").getContext("2d");
  if (!roomMeasure) return Infinity;
  roomMeasure.font = font;
  return roomMeasure.measureText(text).width;
};

/**
 * Give the tools a row of their own above the interface when something is drawn in its top-right corner
 * (tabs across the top, say), else let them sit over the corner. Moving the strip never changes the
 * interface's width, so this cannot set off another layout.
 */
function placeToolbar(): void {
  const wrap = bar.parentElement;
  if (!wrap || !sayshape) return;
  const root = sayshape.boxes;
  const width = canvas.clientWidth;
  const toolsWidth = toolbarWidth(tools);
  // Without a modal, boxes is the same object until the next layout.
  if (roomKey && roomKey.root === root && roomKey.width === width && roomKey.tools === toolsWidth && roomKey.deck === deckShowing) return;
  roomKey = { root, width, tools: toolsWidth, deck: deckShowing };
  const height = themeCanvas.clientHeight || 38;
  wrap.classList.toggle("bar-row", deckShowing || needsToolbarRow(root, width, { w: toolsWidth, h: height }, measureText));
}

function applyHostData(): void {
  if (!sayshape) return;
  for (const [name, rows] of hostData) {
    try { sayshape.state.set(name, rows); } catch { sayshape.notify(`Couldn't show the data for ${name}`); }
  }
}

/** Fetch each dataset's rows from the server (fetch_dataset, which only the interface may call) and show them. */
async function loadData(wanted: Record<string, string>): Promise<void> {
  if (!sayshape) { pendingData = wanted; return; }
  if (!app.getHostCapabilities()?.serverTools) {
    loadingData.clear();
    syncLoading();
    sayshape.notify("This chat app doesn't let interfaces load data");
    return;
  }
  await Promise.all(Object.entries(wanted).map(async ([name, id]) => {
    try {
      const r = await app.callServerTool({ name: "fetch_dataset", arguments: { id } });
      const rows = (r.structuredContent as { rows?: unknown } | undefined)?.rows;
      if (r.isError || !Array.isArray(rows)) throw new Error("no rows");
      hostData.set(name, rows as Value);
      try { sayshape?.state.set(name, rows as Value); } catch { sayshape?.notify(`Couldn't show the data for ${name}`); }
    } catch {
      sayshape?.notify(`Couldn't load the data for ${name}`);
    }
    // Each dataset draws in as soon as it's here, without waiting for the others.
    loadingData.delete(name);
    syncLoading();
  }));
  applyHostData();
}

function dataOf(args: Record<string, unknown> | undefined): Record<string, string> | null {
  const d = args?.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : null;
}

function specOf(args: Record<string, unknown> | undefined): string | null {
  const s = args?.spec;
  return typeof s === "string" ? s : null;
}

// Tidied the way the server checks it (fences, typographic quotes). While streaming,
// only complete lines are tidied and shown, so each step extends the last one.
app.ontoolinputpartial = (p) => {
  // Colors first: they're declared before spec, so they usually arrive before its first line.
  const colors = toolColors(p.arguments, modelColors, true);
  if (colors) useConversationColors(colors);
  const spec = specOf(p.arguments);
  // Until the data argument arrives, a name with no value yet may be a dataset: wait for it.
  if (!awaiting) { awaiting = true; syncLoading(); }
  if (spec !== null) show(tidySpec(spec.slice(0, spec.lastIndexOf("\n") + 1)), false);
};
app.ontoolinput = (p) => {
  // The complete arguments are the truth, colors or none.
  useConversationColors(toolColors(p.arguments, modelColors));
  const spec = specOf(p.arguments);
  const data = dataOf(p.arguments);
  // The names are known now: only datasets still to fetch wait as placeholders.
  for (const name of Object.keys(data ?? {})) loadingData.add(name);
  awaiting = false;
  syncLoading();
  if (spec !== null) show(tidySpec(spec), true);
  if (data) void loadData(data);
};
app.ontoolresult = (r) => {
  // A refused call (an unknown dataset, say) never sends rows: stop waiting for them.
  if (r.isError) {
    loadingData.clear();
    awaiting = false;
    syncLoading();
    return;
  }
  const outcome = outcomeOf(r);
  if (outcome !== "show") fold(outcome);
};
app.onhostcontextchanged = () => {
  // getHostContext() holds the whole context with this change merged in.
  void applyTheme(app.getHostContext());
  // The chat app may leave full screen by itself (Escape, its own button).
  fitScreen();
};
window.addEventListener("resize", () => fitScreen());
app.onteardown = async () => {
  sayshape?.destroy();
  sayshape = null;
  themePicker?.destroy();
  themePicker = null;
  return {};
};

/**
 * Send an event to the model. When the client allows both, the details go in
 * as model context (not shown in the chat) and the conversation shows only a
 * short line like "Confirm laptop", which also makes the model answer straight
 * away. The context is sent first, so it is there when the model answers.
 */
async function deliver(name: string, value: Value | undefined, state: Record<string, Value>): Promise<void> {
  const caps = app.getHostCapabilities();
  const plan = eventDelivery({ message: !!caps?.message, updateModelContext: !!caps?.updateModelContext }, name, value, state);
  if (!plan) { sayshape?.notify("This chat app can't receive actions from interfaces"); return; }
  const content = (text: string) => [{ type: "text" as const, text }];
  try {
    if (plan.context !== undefined) {
      await app.updateModelContext({ content: content(plan.context), structuredContent: { action: name, value: value ?? null, state } });
    }
    if (plan.message !== undefined) {
      const r = await app.sendMessage({ role: "user", content: content(plan.message) });
      sayshape?.notify(r?.isError ? "Couldn't send that to the assistant" : "Sent to the assistant");
    } else {
      sayshape?.notify("Saved for the assistant's next reply");
    }
  } catch {
    sayshape?.notify("Couldn't send that to the assistant");
  }
}

/**
 * Save the interface as it looks right now, after anything the person changed,
 * as a PNG the chat app downloads (MCP Apps' ui/download-file). The engine
 * draws a clean copy at twice the screen's sharpness on the theme's surface
 * (no hover, focus or notices), so it reads well pasted into an email or a
 * slide. Nothing goes to the model.
 */
async function saveImage(): Promise<void> {
  if (!sayshape) return;
  if (introShowing || folded) { sayshape.notify("There's no interface to save yet"); return; }
  if (showsDeck()) { await saveDeck("pdf"); return; }
  let blob = "";
  try {
    const picture = await sayshape.picture({ pixelRatio: 2 });
    blob = picture.toDataURL("image/png").split(",")[1] ?? "";
  } catch {
    blob = "";
  }
  if (!blob) { sayshape.notify("Couldn't save the image"); return; }
  try {
    const r = await app.downloadFile({
      contents: [{ type: "resource", resource: { uri: `file:///${imageName(sayshape.spec)}`, mimeType: "image/png", blob } }],
    });
    sayshape.notify(r.isError ? "The image wasn't saved" : "Image saved");
  } catch {
    sayshape.notify("Couldn't save the image");
  }
}

/** Whether the interface showing is a slide deck, which saves as a file of slides, not one image. */
function showsDeck(): boolean {
  return !!sayshape && !introShowing && !folded && /^\s*deck\b/m.test(sayshape.spec);
}

/** The width decks are drawn at for a file: a slide's own design width plus the view's padding, so nothing is scaled down. */
const DECK_FILE_WIDTH = 1000;
/** Device pixels per CSS pixel in a file's pictures: 2880 by 1620 a slide, sharp on a large screen and when zoomed in. */
const DECK_FILE_SHARPNESS = 3;
/** The most slides a file holds; a longer deck is saved up to here. */
const MAX_FILE_SLIDES = 60;
const DECK_FILES = {
  pdf: { ext: "pdf", mime: "application/pdf", name: "PDF" },
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", name: "PowerPoint file" },
} as const;

/**
 * Save the deck as a PDF or a PowerPoint file with a page per slide
 * Each slide is drawn by the engine on a copy, as
 * it is now, after anything the person changed, and goes in as a picture: the
 * file looks exactly like the chat, and nothing in it can be edited. Nothing
 * goes to the model.
 */
async function saveDeck(kind: keyof typeof DECK_FILES): Promise<void> {
  if (!sayshape) return;
  const file = DECK_FILES[kind];
  const engine = sayshape;
  let key = "", count = 0, titles: string[] = [];
  // The first deck's slide; the deck's box is met first and says where its page lives and how many slides it has.
  const frame = (b: Box): boolean => {
    if (b.node.type === "deck" && !count) {
      key = b.node.props.bind ?? "";
      const d = b.data as { count?: number; titles?: string[] } | undefined;
      count = d?.count ?? 0;
      titles = d?.titles ?? [];
    }
    return b.node.type === "slide";
  };
  const draw = async (state?: Record<string, Value>): Promise<SlidePicture> => {
    // Pages have square corners: the slide's rounded frame would leave the page's own corners showing.
    const square = face ? { theme: { ...face, deck: { ...face.deck, square: true } } } : {};
    const c = await engine.picture({ pixelRatio: DECK_FILE_SHARPNESS, width: DECK_FILE_WIDTH, widen: false, frame, ...square, ...(state ? { state } : {}) });
    const size = { width: c.width, height: c.height };
    // Without loss, so text keeps its edges: a PNG for PowerPoint, the pixels themselves for a PDF.
    if (kind === "pptx") return { data: fromDataUrl(c.toDataURL("image/png")), format: "png", ...size };
    const pixels = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
    const packed = pixels ? await deflated(rgbOf(pixels)) : null;
    if (packed) return { data: packed, format: "rgb", ...size };
    return { data: fromDataUrl(c.toDataURL("image/jpeg", 0.95)), format: "jpeg", ...size };
  };
  let blob = "";
  try {
    engine.notify(`Making the ${file.name}…`);
    const first = await draw();
    const slides: SlidePicture[] = [];
    // A page kept somewhere a plain name can't reach (t.page) can't be set on the copy: the slide showing is saved.
    if (count > 1 && /^[A-Za-z_][\w-]*$/.test(key)) {
      for (let i = 0; i < Math.min(count, MAX_FILE_SLIDES); i++) slides.push(await draw({ [key]: i }));
    } else {
      slides.push(first);
    }
    if (slides.every((s) => s.data.length > 0)) blob = toBase64(kind === "pdf" ? pdfOf(slides) : pptxOf(slides, titles));
  } catch {
    blob = "";
  }
  if (!blob) { engine.notify(`Couldn't make the ${file.name}`); return; }
  try {
    const name = imageName(engine.spec).replace(/\.png$/, `.${file.ext}`);
    const r = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${name}`, mimeType: file.mime, blob } }] });
    engine.notify(r.isError ? `The ${file.name} wasn't saved` : `${kind === "pdf" ? "PDF" : "PowerPoint file"} saved`);
  } catch {
    engine.notify(`Couldn't save the ${file.name}`);
  }
}

/**
 * Copy the interface's words, as it is right now, to the clipboard: nothing
 * drawn on a canvas can be selected, so this stands in for selecting it all.
 * Tables and chart data come as tab-separated rows, so they paste into a
 * spreadsheet as cells (SayShape.copyText()). Nothing goes to the model.
 */
async function copyText(): Promise<void> {
  if (!sayshape) return;
  if (introShowing || folded) { sayshape.notify("There's nothing to copy yet"); return; }
  const text = sayshape.copyText();
  if (!text) { sayshape.notify("There's no text to copy"); return; }
  const ok = await writeClipboard(text, browserClipboard(document));
  sayshape.notify(ok ? "Text copied" : "This chat app doesn't allow copying from here");
}

/** Put a code block's text on the clipboard, with a short notice either way. Nothing goes to the model. */
async function copyCode(text: string): Promise<void> {
  const ok = await writeClipboard(text, browserClipboard(document));
  sayshape?.notify(ok ? "Code copied" : "This chat app doesn't allow copying from here");
}

/**
 * Ctrl+C (Cmd+C on a Mac) copies the interface's text, as the Copy text
 * button does, unless the person is typing in a field or has selected text
 * somewhere else on the page.
 */
function onCopyKey(e: KeyboardEvent): void {
  if (!viewOptions.copyText || e.key.toLowerCase() !== "c" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if (isTypingField(e.target)) return;
  if (document.getSelection()?.toString()) return;
  e.preventDefault();
  void copyText();
}

/** A field someone types in, where Ctrl+C copies their own selection. The accessibility mirror's checkboxes and sliders aren't. */
function isTypingField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "reset"].includes(target.type);
}

/** The toolbar's Pause motion / Resume motion button (behavior on): stops and restarts the interface's rules. */
let motionPaused = false;
function toggleMotion(): void {
  if (!sayshape) return;
  motionPaused = !motionPaused;
  if (motionPaused) sayshape.pauseRules(); else sayshape.resumeRules();
  themePicker?.state.set("paused", motionPaused);
}

/** The tools the toolbar was last built with (set in start). */
let tools: Tools = { picker: false, copy: false, save: false, theme: DEFAULT_PRESET };
let toolbarHasDeck = false;

/**
 * Draw the toolbar. With deck tools (PowerPoint, Present, a PDF in place of the image) it is wider, so it is
 * built that way only once a deck shows, and then again from scratch with them; state the person changed in it
 * (the theme picked, motion paused) carries over.
 */
function buildToolbar(deck: boolean): void {
  themePicker?.destroy();
  themePicker = null;
  toolbarHasDeck = deck;
  tools = {
    ...tools,
    deck,
    present: deck && !!app.getHostContext()?.availableDisplayModes?.includes("fullscreen"),
  };
  const toolbar = toolbarSpec(tools);
  if (!toolbar) return;
  bar.hidden = false;
  themePicker = new SayShape(themeCanvas, {
    components: [...coreComponents, toolButton],
    theme: themeFor(app.getHostContext()),
    width: toolbarWidth(tools),
    padding: TOOLBAR_PADDING,
    imageHosts: [],
    onWarning: () => {},
  });
  themePicker.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
    if (name === SAVE_ACTION) { void saveImage(); return; }
    if (name === DECK_ACTION) { void saveDeck("pptx"); return; }
    if (name === PRESENT_ACTION) { void togglePresent(); return; }
    if (name === COPY_ACTION) { void copyText(); return; }
    if (name === MOTION_ACTION) { toggleMotion(); return; }
    if (name !== "theme") return;
    if (!isPresetId(value)) {
      themePicker?.state.set("preset", activePreset);
      return;
    }
    activePreset = value;
    presetPicked = true;
    void applyTheme(app.getHostContext());
  });
  themePicker.setSpec(toolbar);
  if (motionPaused) themePicker.state.set("paused", true);
  if (tools.picker) themePicker.state.set("preset", activePreset);
}

async function start(): Promise<void> {
  await app.connect();
  // One line per connection, so the table of brand colors can be corrected from what real apps say.
  const host = app.getHostVersion();
  console.info(announce(host));
  hostBrand = brandColorFor(host?.name);
  const theme = await applyTheme(app.getHostContext());
  // The theme selector only when the server was started with --theme-picker; the copy
  // button unless --no-copy-text; the download button unless --no-save-image, and only
  // where the chat app can download files. The deck tools join when a deck first shows.
  tools = {
    picker: viewOptions.themePicker,
    copy: viewOptions.copyText,
    save: viewOptions.saveImage && !!app.getHostCapabilities()?.downloadFile,
    theme: viewOptions.theme,
    motion: !!viewOptions.behavior,
    deck: false,
    present: false,
  };
  buildToolbar(false);
  sayshape = new SayShape(canvas, {
    components: [...coreComponents, ...mapComponents, ...(viewOptions.scene ? sceneComponents : [])],
    ...(viewOptions.behavior ? { behavior: true } : {}),
    // The invisible text layer (selecting, copying by drag, Ctrl/Cmd+F) unless --no-select-text.
    ...(viewOptions.selectText === false ? { selectText: false } : {}),
    ...(viewOptions.selectTouch !== undefined ? { selectTouch: viewOptions.selectTouch } : {}),
    theme: faceTheme(theme),
    // The chat app already boxes the view: a card that is the whole interface draws no frame of its own.
    bareRootCard: true,
    // Only the hosts the server was started with (--image-hosts). The view has no origin of
    // its own to load from, and the server asks the chat app's sandbox to allow just these.
    imageHosts: viewOptions.imageHosts ?? [],
    onWarning: () => {},
  });
  // Behavior on: the toolbar offers Pause while the interface has rules, whatever the spec says.
  sayshape.on("rules", ({ count }) => {
    themePicker?.state.set("rules", count);
    if (bar && !tools.picker && !tools.copy && !tools.save) bar.hidden = count === 0;
  });
  // After each frame: the boxes only change when the interface is laid out again, so this mostly does nothing.
  sayshape.on("render", placeToolbar);
  sayshape.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
    if (!sayshape) return;
    // A code block's copy button (emit:copy:<code>) is the person's own: it goes to the clipboard, not the model.
    if (name === "copy" && typeof value === "string") { void copyCode(value); return; }
    void deliver(name, value, sayshape.state.snapshot());
  });
  document.addEventListener("keydown", onCopyKey);
  syncLoading();
  if (pending) { const p = pending; pending = null; show(p.spec, p.final); }
  else { sayshape.setSpec(INTRO); introShowing = true; }
  if (pendingData) { const d = pendingData; pendingData = null; void loadData(d); }
  if (pendingOutcome) { const o = pendingOutcome; pendingOutcome = null; fold(o); }
}

void start();
