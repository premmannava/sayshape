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
import type { Value } from "../../../src/types";
import { tidySpec } from "../../../src/model/clean";
import { eventDelivery, FIXING_SPEC, imageName, nextChunk, outcomeOf, REPEAT_SPEC, SHOW_ANYWAY } from "./messages";
import { firstFamily, type ReadVar } from "./host-theme";
import { COPY_ACTION, interfaceTheme, isPresetId, MOTION_ACTION, SAVE_ACTION, TOOLBAR_PADDING, toolbarSpec, toolbarWidth, themeForPreset } from "./theme-selection";
import { browserClipboard, writeClipboard } from "./clipboard";
import { toolButton } from "./tool-button";
import { readViewOptions } from "./view-options";

const FACES = ['400 15px "Instrument Sans"', '600 15px "Instrument Sans"', '700 15px "Instrument Sans"'];

const bar = document.querySelector<HTMLElement>("#bar")!;
const themeCanvas = document.querySelector<HTMLCanvasElement>("#view-tools")!;
/** What the server was started with: --theme-picker, --theme, --no-save-image, --no-copy-text. */
const viewOptions = readViewOptions(document);
const canvas = document.querySelector<HTMLCanvasElement>("#sayshape")!;
const app = new App({ name: "SayShape", version: "0.2.1" }, {}, { autoResize: true });

let sayshape: SayShape | null = null;
let themePicker: SayShape | null = null;
let activePreset = viewOptions.theme;
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
 * The spec behind a "being fixed" note, kept so "Show this version" can bring
 * it back. Smaller models send flawed or repeated interfaces more often, and
 * each call makes a new view in the chat, so a view folds itself away once
 * its result says a corrected or identical one is coming or already shown.
 */
let folded: string | null = null;
let pendingOutcome: "fixing" | "repeat" | null = null;

function fold(outcome: "fixing" | "repeat"): void {
  if (!sayshape) { pendingOutcome = outcome; return; }
  folded = sayshape.spec;
  loadingData.clear();
  awaiting = false;
  syncLoading();
  sayshape.setSpec(outcome === "fixing" ? FIXING_SPEC : REPEAT_SPEC, { resetState: true });
}

function unfold(): void {
  if (!sayshape || folded === null) return;
  sayshape.setSpec(folded, { resetState: true });
  folded = null;
  applyHostData();
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

/** The selected SayShape preset in the host's mode, with the server's --accent, adjusted to the host's shared colors, fonts and radii. */
function themeFor(ctx: McpUiHostContext | undefined): Theme {
  const dark = ctx?.theme ? ctx.theme === "dark" : prefersDark();
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  const styles = ctx?.styles;
  if (styles?.css?.fonts) applyHostFonts(styles.css.fonts);
  if (styles?.variables) applyHostStyleVariables(styles.variables);
  return themeForPreset(activePreset, dark ? "dark" : "light", styles?.variables ? domReader(dark) : undefined, viewOptions.accent);
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
  const theme = themeFor(ctx);
  await loadFaces(theme);
  // The engine clears its bitmap to transparency each frame and leaves 20px
  // around the content. In an MCP iframe, that transparent gutter can expose
  // a black host surface even beside a light card. Paint the canvas element's
  // background using the resolved host-aware theme, without changing layout
  // or making the entire iframe opaque.
  canvas.style.backgroundColor = theme.colors.surface;
  bar.style.backgroundColor = theme.colors.surface;
  sayshape?.setTheme(interfaceTheme(theme));
  themePicker?.setTheme(theme);
  return theme;
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
  const spec = specOf(p.arguments);
  // Until the data argument arrives, a name with no value yet may be a dataset: wait for it.
  if (!awaiting) { awaiting = true; syncLoading(); }
  if (spec !== null) show(tidySpec(spec.slice(0, spec.lastIndexOf("\n") + 1)), false);
};
app.ontoolinput = (p) => {
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
};
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
  if (introShowing || folded !== null) { sayshape.notify("There's no interface to save yet"); return; }
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

/**
 * Copy the interface's words, as it is right now, to the clipboard: nothing
 * drawn on a canvas can be selected, so this stands in for selecting it all.
 * Tables and chart data come as tab-separated rows, so they paste into a
 * spreadsheet as cells (SayShape.copyText()). Nothing goes to the model.
 */
async function copyText(): Promise<void> {
  if (!sayshape) return;
  if (introShowing || folded !== null) { sayshape.notify("There's nothing to copy yet"); return; }
  const text = sayshape.copyText();
  if (!text) { sayshape.notify("There's no text to copy"); return; }
  const ok = await writeClipboard(text, browserClipboard(document));
  sayshape.notify(ok ? "Text copied" : "This chat app doesn't allow copying from here");
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

async function start(): Promise<void> {
  await app.connect();
  const theme = await applyTheme(app.getHostContext());
  // The theme selector only when the server was started with --theme-picker; the copy
  // button unless --no-copy-text; the download button unless --no-save-image, and only
  // where the chat app can download files.
  const tools = {
    picker: viewOptions.themePicker,
    copy: viewOptions.copyText,
    save: viewOptions.saveImage && !!app.getHostCapabilities()?.downloadFile,
    theme: viewOptions.theme,
    motion: !!viewOptions.behavior,
  };
  const toolbar = toolbarSpec(tools);
  if (toolbar) {
    bar.hidden = false;
    themePicker = new SayShape(themeCanvas, {
      components: [...coreComponents, toolButton],
      theme,
      width: toolbarWidth(tools),
      padding: TOOLBAR_PADDING,
      imageHosts: [],
      onWarning: () => {},
    });
    themePicker.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
      if (name === SAVE_ACTION) { void saveImage(); return; }
      if (name === COPY_ACTION) { void copyText(); return; }
      if (name === MOTION_ACTION) { toggleMotion(); return; }
      if (name !== "theme") return;
      if (!isPresetId(value)) {
        themePicker?.state.set("preset", activePreset);
        return;
      }
      activePreset = value;
      void applyTheme(app.getHostContext());
    });
    themePicker.setSpec(toolbar);
  }
  sayshape = new SayShape(canvas, {
    components: [...coreComponents, ...mapComponents, ...(viewOptions.scene ? sceneComponents : [])],
    ...(viewOptions.behavior ? { behavior: true } : {}),
    theme: interfaceTheme(theme),
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
  sayshape.on("action", ({ name, value }: { name: string; value: Value | undefined }) => {
    if (!sayshape) return;
    if (name === SHOW_ANYWAY) { unfold(); return; }
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
