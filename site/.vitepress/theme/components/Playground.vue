<script setup lang="ts">
/**
 * The public playground: edit a SayShape spec and see the real engine render it,
 * entirely in the browser. It reuses the development playground's samples,
 * appearance presets, theme export and model guide (playground/), and keeps
 * its debugging tools. It has no model connection: GitHub Pages can only
 * serve static files, and a model needs a server that holds the key.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { withBase } from "vitepress";
import type { Diagnostic, SayShapeNode } from "@sayshape/index";
import { examples } from "../../../examples/catalog";
import { sourceByKey, sourceGroups, sources } from "../sayshape/playgroundSources";
import { loadThemeFonts, PRESETS, resolveTheme, type PresetId } from "../../../../playground/appearance/presets";
import { themeCode } from "../../../../playground/appearance/export";
import { normalizeHex } from "../../../../playground/appearance/color";
import { highlightSpec } from "../sayshape/highlight";
import { useSayShape } from "../sayshape/useSayShape";
import { fromBase64, isSiteDark, prefersReducedMotion, replayStream, toBase64Url } from "../sayshape/runtime";
import { onHostEvents, type HostEvent } from "../sayshape/events";
import PgPicker, { type PickerGroup } from "./PgPicker.vue";

// ------------------------------------------------------------ what can be loaded

// The picker's list (the gallery's examples and the development samples, grouped) is in ../sayshape/playgroundSources.
const pickGroups: PickerGroup[] = sourceGroups.map((g) => ({ label: g.label, items: g.items.map((s) => ({ value: s.key, label: s.title })) }));
const modeGroups: PickerGroup[] = [{ items: [{ value: "site", label: "Match site" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] }];
const presetGroups: PickerGroup[] = [{ items: PRESETS.map((p) => ({ value: p.id, label: p.label })) }];
const DEFAULT_KEY = examples[0]!.id;

// ------------------------------------------------------------ state

const canvas = ref<HTMLCanvasElement | null>(null);
const ta = ref<HTMLTextAreaElement | null>(null);
const sourceKey = ref<string>(DEFAULT_KEY); // "" when the text came from a link
const text = ref(sourceOf(DEFAULT_KEY));
const original = ref(text.value);
const diagnostics = shallowRef<Diagnostic[]>([]);
const stateRows = shallowRef<Array<[string, string]>>([]);
const flashKey = ref("");
const events = ref<HostEvent[]>([]);
const metrics = ref({ nodes: 0, parse: "0.00", layout: "0.00", paint: "0.00" });
const inspectText = ref("Turn on Inspect and click something in the preview, or put the cursor on a spec line.");
const streaming = ref(false);
const hideEditor = ref(false);
// Only narrow screens show one panel at a time; they open on the drawing, which is what the page is about.
const tab = ref<"spec" | "preview" | "details">("preview");
/** The toolbar menu that's open, if any. */
const menu = ref<"" | "reset" | "share">("");
const toolbar = ref<HTMLElement | null>(null);
const mode = ref<"site" | "light" | "dark">("site");
const preset = ref<PresetId>("teal");
/** The visitor's own color, laid over the chosen style; null until they pick one. */
const accent = ref<string | null>(null);
const boxes = ref(false);
const hits = ref(false);
const inspecting = ref(false);
const notice = ref("");
const selectedLine = ref(0);
const scroll = ref({ top: 0, left: 0 });
const guideText = ref("");
let escapeTab = false;
let signal = { cancelled: false };
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const edited = computed(() => text.value !== original.value);
const currentTitle = computed(() => sources.find((s) => s.key === sourceKey.value)?.title ?? "Spec from a link");
const lineCount = computed(() => Math.max(1, text.value.split("\n").length));
const highlighted = computed(() => highlightSpec(text.value));
const byLine = computed(() => {
  const m = new Map<number, "error" | "warning">();
  for (const d of diagnostics.value) if (m.get(d.line) !== "error") m.set(d.line, d.severity === "error" ? "error" : "warning");
  return m;
});
const errorCount = computed(() => diagnostics.value.filter((d) => d.severity === "error").length);
const warningCount = computed(() => diagnostics.value.length - errorCount.value);
const forcedScheme = computed(() => (mode.value === "site" ? null : mode.value));

function sourceOf(key: string): string {
  return sources.find((s) => s.key === key)?.spec ?? "";
}

function say(message: string) {
  notice.value = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ""; }, 2600);
}

// ------------------------------------------------------------ engine

const { sayshape } = useSayShape(canvas, (l) => {
  const offs = [
    l.on("diagnostics", (d) => { diagnostics.value = d; }),
    l.on("change", ({ key }) => { flashKey.value = key; queueMicrotask(renderState); }),
    l.on("render", (m) => {
      metrics.value = { nodes: m.nodes, parse: m.parseMs.toFixed(2), layout: m.layoutMs.toFixed(2), paint: m.paintMs.toFixed(2) };
      renderState();
    }),
    l.on("inspect", (sel) => {
      inspectText.value = sel ? JSON.stringify(l.inspector.describe(sel.node), null, 2) : "Nothing selected.";
      if (sel && l.inspector.inspecting) goToLine(sel.node.line);
    }),
    onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 12); }),
  ];
  // The guide a model would get; copy it into any chat assistant to try generation without a server here.
  import("../../../../playground/model-guide").then(({ playgroundGuide }) => {
    import("@sayshape/index").then(({ languageGuide }) => { guideText.value = languageGuide(l.registry, playgroundGuide([])); });
  });
  applyTheme();
  l.setSpec(text.value);
  l.renderNow();
  diagnostics.value = l.diagnostics;
  return () => offs.forEach((off) => off());
}, { map: true, followSiteTheme: () => false });

/** The preview's theme: the chosen style, in the chosen scheme or the site's. */
function applyTheme() {
  const l = sayshape.value;
  if (!l) return;
  const scheme = forcedScheme.value ?? (isSiteDark() ? "dark" : "light");
  const theme = resolveTheme(preset.value, scheme, accent.value).theme;
  l.setTheme(theme);
  loadThemeFonts(theme, () => l.setTheme(theme));
}
watch([mode, preset, accent], () => applyTheme());
/** What the picker shows before anything is picked: the chosen style's own accent. */
const swatch = computed(() => accent.value ?? normalizeHex(resolveTheme(preset.value, "light", null).theme.colors.accent) ?? "#0f766e");
function pickAccent(e: Event) {
  accent.value = normalizeHex((e.target as HTMLInputElement).value);
}
// When following the site with a non-default style, a site switch must re-resolve the preset.
let siteObserver: MutationObserver | null = null;
onMounted(() => {
  siteObserver = new MutationObserver(() => { if (mode.value === "site") applyTheme(); });
  siteObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});

const passwordKeys = () => new Set((sayshape.value?.find("input") ?? []).filter((n: SayShapeNode) => n.props.kind === "password" && n.props.bind).map((n: SayShapeNode) => n.props.bind!.split(".")[0]!));
function renderState() {
  const l = sayshape.value;
  if (!l) return;
  const secret = passwordKeys();
  stateRows.value = Object.entries(l.state.snapshot()).map(([k, v]) => {
    const shown = secret.has(k) && typeof v === "string" ? "•".repeat(v.length) : v;
    let s = JSON.stringify(shown);
    if (s && s.length > 160) s = s.slice(0, 157) + "…";
    return [k, s ?? "undefined"];
  });
}

// ------------------------------------------------------------ toolbar menus

function toggleMenu(name: "reset" | "share") {
  menu.value = menu.value === name ? "" : name;
  if (menu.value) void nextTick(() => menuItems()[0]?.focus());
}
const menuItems = () => [...(toolbar.value?.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]') ?? [])];
/** Close the open menu; `refocus` puts the keyboard back on the button that opened it. */
function closeMenu(refocus = false) {
  if (!menu.value) return;
  const opener = toolbar.value?.querySelector<HTMLElement>(`[data-menu="${menu.value}"]`);
  menu.value = "";
  if (refocus) opener?.focus();
}
function pickFromMenu(run: () => void) {
  closeMenu(true);
  run();
}
function onMenuKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); closeMenu(true); return; }
  const items = menuItems();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  items[(to + items.length) % items.length]?.focus();
}
function onOutsidePress(e: PointerEvent) {
  if (menu.value && !(e.target as HTMLElement).closest?.(".pg-menu")) closeMenu();
}
/** Tabbing out of an open menu closes it. */
function onMenuFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as HTMLElement | null;
  if (next && !next.closest(".pg-menu")) closeMenu();
}

// ------------------------------------------------------------ loading and resetting

function load(key: string, spec = sourceOf(key)) {
  cancelStream();
  sourceKey.value = key;
  text.value = spec;
  original.value = spec;
  events.value = [];
  selectedLine.value = 0;
  if (sayshape.value) {
    sayshape.value.inspector.selected = null;
    sayshape.value.setSpec(spec, { resetState: true });
  }
  const url = new URL(location.href);
  url.hash = "";
  if (key) url.searchParams.set("example", key); else url.searchParams.delete("example");
  history.replaceState(history.state, "", url);
}

function onPick(key: string) {
  if (edited.value && !confirm("Load another spec? Your edits to this one will be lost.")) return;
  load(key);
}

/** Back to the spec as it was loaded, with fresh state. */
function resetExample() {
  load(sourceKey.value, original.value);
  say("Spec and state reset");
}

/** Same spec, fresh state: only what the interface remembers is cleared. */
function resetState() {
  sayshape.value?.setSpec(text.value, { resetState: true });
  events.value = [];
  say("State reset. The spec is unchanged");
}

function onInput() {
  if (streaming.value || !sayshape.value) return;
  sayshape.value.setSpec(text.value);
}

// ------------------------------------------------------------ streaming replay

function cancelStream() {
  signal.cancelled = true;
  if (streaming.value) { streaming.value = false; sayshape.value?.endStream(); }
}

async function replay() {
  const l = sayshape.value;
  if (!l) return;
  cancelStream();
  signal = { cancelled: false };
  const spec = text.value;
  streaming.value = true;
  events.value = [];
  const done = await replayStream(l, spec, { signal, instant: prefersReducedMotion() });
  if (done) streaming.value = false;
}

// ------------------------------------------------------------ copy, download, link

async function copy(textToCopy: string, what: string) {
  try {
    await navigator.clipboard.writeText(textToCopy);
    say(`${what} copied`);
  } catch {
    say(`Couldn't copy the ${what.toLowerCase()}. Your browser blocked the clipboard`);
  }
}
const copySpec = () => copy(text.value, "Spec");
function copyLink() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "spec=" + toBase64Url(text.value);
  void copy(url.toString(), "Link");
}
function download() {
  const blob = new Blob([text.value.endsWith("\n") ? text.value : text.value + "\n"], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sourceKey.value || "spec"}.sayshape`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const copyTheme = () => copy(themeCode({ preset: preset.value, mode: mode.value === "site" ? "system" : mode.value, accent: accent.value }), "Theme code");
const copyGuide = () => copy(guideText.value, "Model guide");

// ------------------------------------------------------------ editor

function onScroll() {
  const t = ta.value;
  if (t) scroll.value = { top: t.scrollTop, left: t.scrollLeft };
}

function onKeydown(e: KeyboardEvent) {
  const t = ta.value!;
  if (e.key === "Escape") { escapeTab = true; return; }
  if (e.key === "Tab" && !e.shiftKey && !escapeTab && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    t.setRangeText("  ", t.selectionStart, t.selectionEnd, "end");
    text.value = t.value;
    onInput();
  }
  if (e.key !== "Escape") escapeTab = false;
}

function syncCursorLine() {
  const t = ta.value;
  if (!t || streaming.value) return;
  const line = t.value.slice(0, t.selectionStart).split("\n").length;
  if (line !== selectedLine.value) {
    selectedLine.value = line;
    sayshape.value?.inspector.selectLine(line);
  }
}

function goToLine(line: number) {
  const t = ta.value;
  if (!t) return;
  if (tab.value !== "spec" && window.matchMedia("(max-width: 900px)").matches) tab.value = "spec";
  hideEditor.value = false;
  void nextTick(() => {
    const lines = t.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    t.focus();
    t.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 22;
    t.scrollTop = Math.max(0, (line - 4) * lh);
    selectedLine.value = line;
    onScroll();
  });
}

// ------------------------------------------------------------ debug tools

watch(boxes, (v) => sayshape.value?.inspector.setBoxes(v));
watch(hits, (v) => sayshape.value?.inspector.setHits(v));
watch(inspecting, (v) => sayshape.value?.inspector.setInspecting(v));

async function captureFrame() {
  const l = sayshape.value;
  if (!l) return;
  const calls = await l.inspector.captureFrame();
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.op, (counts.get(c.op) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  inspectText.value =
    `One frame: ${calls.length} canvas calls\n\n` +
    top.map(([op, n]) => `${String(n).padStart(5)}  ${op}`).join("\n") +
    `\n\nFirst calls:\n` +
    calls.slice(0, 12).map((c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`).join("\n");
}

// ------------------------------------------------------------ start-up

/** Load a spec from a #spec= link. Returns whether the hash held one. */
function loadFromHash(): boolean {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("spec");
  if (!fromLink) return false;
  try {
    const spec = fromBase64(fromLink);
    sourceKey.value = "";
    text.value = spec;
    original.value = spec;
  } catch {
    say("That link's spec couldn't be read, so the default example is shown");
  }
  return true;
}

// A #spec= link followed while already on this page only changes the hash.
function onHashChange() {
  if (loadFromHash()) sayshape.value?.setSpec(text.value, { resetState: true });
}

onMounted(() => {
  const params = new URLSearchParams(location.search);
  window.addEventListener("hashchange", onHashChange);
  document.addEventListener("pointerdown", onOutsidePress);
  if (!loadFromHash()) {
    const from = sourceByKey(params.get("example") ?? "");
    if (from) { sourceKey.value = from.key; text.value = from.spec; original.value = text.value; }
  }
  // The engine may already be running with the default spec.
  if (sayshape.value) sayshape.value.setSpec(text.value, { resetState: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
  document.removeEventListener("pointerdown", onOutsidePress);
  signal.cancelled = true;
  siteObserver?.disconnect();
  clearTimeout(noticeTimer);
});

const docsModel = withBase("/docs/integration/model.html");
const docsGuide = withBase("/docs/integration/model-guide.html");
</script>

<template>
  <div class="pg" :class="{ 'no-editor': hideEditor }">
    <header class="pg-head">
      <h1>Write it. <em>Watch it draw.</em></h1>
      <p class="pg-note">
        Edit any spec and the real engine redraws as you type. No model runs on this site: <a :href="docsModel">connect your own</a>, or paste the
        <a :href="docsGuide">model guide</a> into any chat assistant and drop its answer here.
      </p>
    </header>

    <div ref="toolbar" class="pg-toolbar" role="toolbar" aria-label="Playground controls">
      <PgPicker class="pg-pick" :model-value="sourceKey" :groups="pickGroups" label="Spec to load" placeholder="From a link" search @update:model-value="onPick" />
      <button class="sayshape-btn primary small" type="button" :disabled="!sayshape || streaming" title="Play the current spec into the preview line by line, as a model's response would arrive" @click="replay">▶ Replay as stream</button>
      <div class="pg-menu" @keydown="onMenuKeydown" @focusout="onMenuFocusOut">
        <button class="sayshape-btn quiet small" type="button" data-menu="reset" aria-haspopup="menu" :aria-expanded="menu === 'reset'" :disabled="!sayshape" @click="toggleMenu('reset')">Reset <span class="pg-caret" aria-hidden="true"></span></button>
        <div v-if="menu === 'reset'" class="pg-menu-list" role="menu" aria-label="Reset">
          <button type="button" role="menuitem" @click="pickFromMenu(resetState)"><b>Start over</b><span>Keep the spec as it is now and clear what the interface remembers</span></button>
          <button type="button" role="menuitem" @click="pickFromMenu(resetExample)"><b>Undo my edits</b><span>Put the spec back as it was loaded, and start over</span></button>
        </div>
      </div>
      <div class="pg-menu" @keydown="onMenuKeydown" @focusout="onMenuFocusOut">
        <button class="sayshape-btn quiet small" type="button" data-menu="share" aria-haspopup="menu" :aria-expanded="menu === 'share'" @click="toggleMenu('share')">Share <span class="pg-caret" aria-hidden="true"></span></button>
        <div v-if="menu === 'share'" class="pg-menu-list" role="menu" aria-label="Share">
          <button type="button" role="menuitem" @click="pickFromMenu(copyLink)"><b>Copy link</b><span>A link to this page with this spec in it</span></button>
          <button type="button" role="menuitem" @click="pickFromMenu(copySpec)"><b>Copy spec</b><span>The text in the editor</span></button>
          <button type="button" role="menuitem" @click="pickFromMenu(download)"><b>Download</b><span>The spec as a .sayshape file</span></button>
        </div>
      </div>
      <span class="pg-notice" role="status" aria-live="polite">{{ notice }}</span>
      <button class="sayshape-btn quiet small pg-hide" type="button" :aria-pressed="hideEditor" @click="hideEditor = !hideEditor">{{ hideEditor ? "Show editor" : "Hide editor" }}</button>
    </div>

    <div class="pg-tabs" role="tablist" aria-label="Panels">
      <button role="tab" type="button" :aria-selected="tab === 'preview'" @click="tab = 'preview'">Preview</button>
      <button role="tab" type="button" :aria-selected="tab === 'spec'" @click="tab = 'spec'">Spec</button>
      <button role="tab" type="button" :aria-selected="tab === 'details'" @click="tab = 'details'">
        Problems <span v-if="diagnostics.length" class="pg-count">{{ diagnostics.length }}</span>
      </button>
    </div>

    <div class="pg-main" :data-tab="tab">
      <section class="pg-pane pg-editor" aria-label="Spec editor">
        <div class="pg-pane-head">
          <h2>{{ currentTitle }}<span v-if="edited" class="pg-edited"> (edited)</span></h2>
          <span class="pg-diag-summary" :class="{ bad: errorCount, warn: !errorCount && warningCount }">
            {{ errorCount ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "" }}{{ errorCount && warningCount ? ", " : "" }}{{ warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "" }}{{ !diagnostics.length ? "No problems" : "" }}
          </span>
        </div>
        <div class="ed">
          <div class="ed-gutter" aria-hidden="true">
            <div :style="{ transform: `translateY(${-scroll.top}px)` }">
              <div v-for="n in lineCount" :key="n" :class="[byLine.get(n), { sel: n === selectedLine }]">{{ n }}</div>
            </div>
          </div>
          <div class="ed-body">
            <pre class="ed-hl spec-view" aria-hidden="true" :style="{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }"><code v-html="highlighted"></code></pre>
            <textarea
              ref="ta"
              v-model="text"
              class="ed-input"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              wrap="off"
              :readonly="streaming"
              aria-label="SayShape spec. Tab inserts two spaces; press Escape, then Tab, to leave the editor."
              aria-describedby="pg-problems-title"
              @input="onInput"
              @scroll="onScroll"
              @keydown="onKeydown"
              @click="syncCursorLine"
              @keyup="syncCursorLine"
            ></textarea>
          </div>
        </div>
      </section>

      <section class="pg-pane pg-preview" aria-label="Preview">
        <div class="pg-pane-head">
          <h2>Preview</h2>
          <div class="pg-looks">
            <PgPicker :model-value="mode" :groups="modeGroups" label="Preview light or dark" small @update:model-value="mode = $event as typeof mode" />
            <PgPicker :model-value="preset" :groups="presetGroups" label="Preview color style" small @update:model-value="preset = $event as PresetId" />
            <label class="pg-color" title="Your brand color, laid over the style. The spec doesn't change.">
              <input type="color" :value="swatch" aria-label="Your brand color for the preview" @input="pickAccent">
              <span>{{ accent ?? "Your color" }}</span>
            </label>
            <button v-if="accent" class="sayshape-btn-text" type="button" @click="accent = null">Reset color</button>
          </div>
        </div>
        <div class="sayshape-stage pg-stage" :data-scheme="forcedScheme ?? undefined">
          <div class="sayshape-canvas-wrap"><canvas ref="canvas" aria-label="Preview of the spec, drawn by SayShape on a canvas. The editor holds the readable source."></canvas></div>
        </div>
        <div class="pg-pane-foot">
          <dl class="pg-metrics" aria-label="Last frame">
            <div><dt>Elements</dt><dd>{{ metrics.nodes }}</dd></div>
            <div><dt>Parse</dt><dd>{{ metrics.parse }} ms</dd></div>
            <div><dt>Layout</dt><dd>{{ metrics.layout }} ms</dd></div>
            <div><dt>Paint</dt><dd>{{ metrics.paint }} ms</dd></div>
          </dl>
          <div class="pg-tools" role="group" aria-label="Debugging overlays">
            <label><input v-model="boxes" type="checkbox"> Layout boxes</label>
            <label><input v-model="hits" type="checkbox"> Hit regions</label>
            <label><input v-model="inspecting" type="checkbox"> Inspect</label>
          </div>
        </div>
      </section>

      <section class="pg-details" aria-label="Problems, state and inspector">
        <div class="pg-pane">
          <div class="pg-pane-head"><h2 id="pg-problems-title">Problems</h2><span class="pg-count">{{ diagnostics.length }}</span></div>
          <ul class="pg-diags">
            <li v-if="!diagnostics.length" class="empty">No problems. The parser accepted every line.</li>
            <li v-for="d in diagnostics" :key="d.line + d.message" :class="d.severity">
              <button type="button" @click="goToLine(d.line)">
                <span class="ln">Line {{ d.line }}</span>
                <span class="sev">{{ d.severity }}</span>
                <span class="msg">{{ d.message }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="pg-pane">
          <div class="pg-pane-head"><h2>State</h2><span class="pg-hint">sayshape.state.snapshot()</span></div>
          <table class="pg-state">
            <tbody>
              <tr v-for="[k, v] in stateRows" :key="k" :class="{ flash: k === flashKey }"><th scope="row">{{ k }}</th><td>{{ v }}</td></tr>
            </tbody>
          </table>
          <h3 class="pg-sub">Events sent to the page</h3>
          <ol class="pg-events">
            <li v-if="!events.length" class="empty">None yet. emit:, go: and notify: actions show up here; nothing is sent anywhere.</li>
            <li v-for="e in events" :key="e.id">{{ e.text }}</li>
          </ol>
        </div>
        <div class="pg-pane">
          <div class="pg-pane-head"><h2>Inspector</h2><button class="sayshape-btn-text" type="button" :disabled="!sayshape" @click="captureFrame">Capture frame</button></div>
          <pre class="pg-inspect">{{ inspectText }}</pre>
        </div>
      </section>
    </div>

    <div class="pg-extra">
      <details>
        <summary>Model guide</summary>
        <p>
          The instructions a model gets, generated from the component definitions: the compact guide the development playground sends.
          Paste it into a chat assistant, describe a screen, and paste the reply into the editor. Results depend on the model.
        </p>
        <button class="sayshape-btn quiet small" type="button" :disabled="!guideText" @click="copyGuide">Copy model guide</button>
        <pre class="pg-guide">{{ guideText || "Loading…" }}</pre>
      </details>
      <details>
        <summary>Theme code for this style</summary>
        <p>TypeScript that sets the preview's style in your own app, using <code>extendTheme</code> and <code>sayshape.setTheme</code>.</p>
        <button class="sayshape-btn quiet small" type="button" @click="copyTheme">Copy theme code</button>
      </details>
    </div>
  </div>
</template>

<style scoped>
.pg { max-width: var(--ss-workspace); margin: 0 auto; padding: 24px var(--ss-gutter) 56px; --pg-pane-h: clamp(460px, calc(100vh - 330px), 760px) }
/* A short heading, so the editor and the drawing are in the first view. */
.pg-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 24px; margin-bottom: 14px }
.pg-head h1 em { font-style: italic; color: var(--ss-coral) }
.pg-head h1 { font: 600 clamp(26px, 2.6vw, 34px)/1.1 var(--sayshape-display); letter-spacing: -0.02em; margin: 0; white-space: nowrap }
.pg-note { flex: 1 1 420px; margin: 0; max-width: 92ch; color: var(--vp-c-text-2); line-height: 1.5; font-size: 14.5px }
.pg-note a { color: var(--vp-c-brand-1); font-weight: 600; text-underline-offset: 3px }

.pg-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 0; border-top: 1px solid var(--vp-c-divider) }
.pg-pick { width: 260px; margin-right: 6px }
.pg-hide { margin-left: auto }
.pg-notice { margin-left: 6px; font-size: 13.5px; color: var(--vp-c-brand-1); font-weight: 600 }

.pg-menu { position: relative }
.pg-caret { width: 7px; height: 7px; margin: -4px 0 0 -2px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg) }
.pg-menu-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: grid;
  width: max-content;
  max-width: min(320px, calc(100vw - 32px));
  padding: 6px;
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  background: var(--ss-card);
  box-shadow: var(--ss-lift-sm);
}
.pg-menu-list button { all: unset; box-sizing: border-box; display: grid; gap: 2px; padding: 8px 12px; border-radius: 9px; cursor: pointer }
.pg-menu-list button:hover, .pg-menu-list button:focus-visible { background: color-mix(in srgb, var(--vp-c-text-1) 7%, transparent) }
.pg-menu-list button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px }
.pg-menu-list b { font: 600 14px var(--vp-font-family-base); color: var(--vp-c-text-1) }
.pg-menu-list span { font-size: 12.5px; line-height: 1.4; color: var(--vp-c-text-2) }

.pg-tabs { display: none }

.pg-main { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); grid-template-areas: "editor preview" "details details"; gap: 16px }
.no-editor .pg-main { grid-template-columns: minmax(0, 1fr); grid-template-areas: "preview" "details" }
.no-editor .pg-editor { display: none }
.pg-editor { grid-area: editor }
.pg-preview { grid-area: preview }
.pg-details { grid-area: details; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start }

.pg-pane { border: 1.5px solid var(--vp-c-divider); border-radius: 16px; background: var(--ss-card); overflow: hidden; display: flex; flex-direction: column; min-width: 0 }
.pg-pane-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 16px; border-bottom: 1px solid var(--vp-c-divider); background: transparent }
.pg-preview { border: 1px solid var(--vp-c-border); box-shadow: var(--ss-lift-sm) }
.pg-pane-head h2 { margin: 0 auto 0 0; font: 500 11px var(--vp-font-family-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--vp-c-brand-1) }
.pg-edited { color: var(--vp-c-text-2); font-weight: 500 }
.pg-diag-summary { font-size: 12.5px; color: var(--sayshape-ok); font-weight: 600 }
.pg-diag-summary.bad { color: var(--sayshape-bad) }
.pg-diag-summary.warn { color: var(--sayshape-warn) }
.pg-count { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.pg-hint { font: 11.5px var(--vp-font-family-mono); color: var(--vp-c-text-2) }
.pg-looks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px }
.pg-color { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 5px; border: 1.5px solid var(--vp-c-divider); border-radius: 999px; background: var(--ss-card); font: 500 13px var(--vp-font-family-base); color: var(--vp-c-text-1); cursor: pointer }
.pg-color:focus-within { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.pg-color input { width: 20px; height: 20px; padding: 0; border: 0; background: none; cursor: pointer }
.pg-color input::-webkit-color-swatch-wrapper { padding: 0 }
.pg-color input::-webkit-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.pg-color input::-moz-color-swatch { border: 1px solid var(--vp-c-divider); border-radius: 50% }
.pg-looks .sayshape-btn-text { margin-left: 4px }
.pg-pane-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 16px; padding: 8px 16px; border-top: 1px solid var(--vp-c-divider) }
.pg-metrics { display: flex; flex-wrap: wrap; gap: 2px 16px; margin: 0 }
.pg-metrics div { display: flex; gap: 6px; align-items: baseline }
.pg-metrics dt { font: 500 10.5px var(--vp-font-family-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--vp-c-text-3) }
.pg-metrics dd { margin: 0; font: 500 12px var(--vp-font-family-mono); font-variant-numeric: tabular-nums; white-space: nowrap }
.pg-tools { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--vp-c-text-2) }
.pg-tools label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer }
.pg-tools input { accent-color: var(--vp-c-brand-1) }

/* Editor: a transparent textarea over highlighted text, sharing one font and metrics. */
.ed { position: relative; display: flex; height: var(--pg-pane-h); background: var(--sayshape-code-bg) }
.ed-gutter { flex: none; width: 46px; overflow: hidden; border-right: 1px solid var(--vp-c-divider); padding: 12px 0; font: 13px/1.7 var(--vp-font-family-mono); color: var(--vp-c-text-3); text-align: right; user-select: none }
.ed-gutter div div { padding-right: 9px; position: relative; height: 1.7em }
.ed-gutter .error { color: var(--sayshape-bad); font-weight: 600 }
.ed-gutter .error::before { content: ""; position: absolute; left: 6px; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%; background: var(--sayshape-bad) }
.ed-gutter .warning { color: var(--sayshape-warn); font-weight: 600 }
.ed-gutter .sel { background: var(--sayshape-hl); color: var(--vp-c-brand-1) }
.ed-body { position: relative; flex: 1; min-width: 0; overflow: hidden }
.ed-hl, .ed-input {
  margin: 0;
  padding: 12px 14px;
  font: 13px/1.7 var(--vp-font-family-mono);
  tab-size: 2;
  white-space: pre;
  letter-spacing: 0;
  border: 0;
}
.ed-hl { position: absolute; inset: 0 auto auto 0; pointer-events: none; min-width: 100% }
.ed-hl :deep(.line) { padding-right: 0; min-height: 1.7em }
.ed-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: var(--vp-c-text-1);
  overflow: auto;
  outline: none;
}
.ed-input::selection { background: var(--sayshape-hl); color: transparent }
.ed-input:focus-visible { box-shadow: inset 0 0 0 2px var(--vp-c-brand-1) }
.ed-input[readonly] { cursor: progress }

.pg-stage { height: calc(var(--pg-pane-h) - 37px); overflow: auto }
.pg-stage[data-scheme="light"] { --sayshape-stage: #edf1ef; --sayshape-stage-dot: #cbd4d0 }
.pg-stage[data-scheme="dark"] { --sayshape-stage: #0b0f14; --sayshape-stage-dot: #222b35 }

.pg-diags, .pg-events { list-style: none; margin: 0; padding: 6px 0; max-height: 280px; overflow: auto; font-size: 13.5px }
.pg-diags li button { all: unset; box-sizing: border-box; display: grid; grid-template-columns: auto auto 1fr; gap: 10px; width: 100%; padding: 6px 14px; cursor: pointer; line-height: 1.45 }
.pg-diags li button:hover { background: var(--sayshape-hl) }
.pg-diags li button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px }
.pg-diags .ln { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); padding-top: 2px }
.pg-diags .sev { font-size: 12px; font-weight: 600; padding-top: 1px }
.pg-diags .error .sev, .pg-diags .error .msg { color: var(--sayshape-bad) }
.pg-diags .warning .sev { color: var(--sayshape-warn) }
.pg-diags .empty, .pg-events .empty { padding: 6px 14px; color: var(--vp-c-text-2) }
.pg-state { display: table; width: calc(100% - 28px); margin: 8px 14px; border-collapse: collapse; font-size: 13px }
.pg-state th { font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-2); text-align: left; padding: 3px 12px 3px 0; vertical-align: top; border: 0; white-space: nowrap; background: none }
.pg-state td { padding: 3px 0; font: 12px var(--vp-font-family-mono); word-break: break-all; border: 0 }
.pg-state tr { background: none !important; border: 0 }
.pg-state tr.flash td { color: var(--vp-c-brand-1); font-weight: 600 }
.pg-sub { margin: 4px 14px 0; font-size: 13px; font-weight: 700 }
.pg-events li { padding: 3px 14px; font: 12px var(--vp-font-family-mono); color: var(--vp-c-brand-1) }
.pg-events .empty { font-family: var(--vp-font-family-base); font-size: 13px }
.pg-inspect { margin: 0; padding: 10px 14px; font: 12px/1.55 var(--vp-font-family-mono); white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow: auto }

.pg-extra { margin-top: 20px; display: grid; gap: 10px }
.pg-extra details { border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 0 16px }
.pg-extra summary { cursor: pointer; padding: 12px 0; font-weight: 600 }
.pg-extra p { margin: 0 0 12px; color: var(--vp-c-text-2); font-size: 14px; max-width: 80ch; line-height: 1.6 }
.pg-extra details > button { margin-bottom: 14px }
.pg-guide { margin: 0 0 16px; padding: 12px 14px; max-height: 360px; overflow: auto; font: 12px/1.55 var(--vp-font-family-mono); white-space: pre-wrap; background: var(--sayshape-code-bg); border: 1px solid var(--vp-c-divider); border-radius: 8px }

@media (max-width: 1100px) {
  .pg-details { grid-template-columns: 1fr 1fr }
}
@media (max-width: 900px) {
  .pg { padding: 20px 16px 48px }
  .pg-head { margin-bottom: 12px }
  .pg-hide { display: none }
  .pg-pick { flex: 1 1 100%; width: auto; margin-right: 0 }
  .pg-notice { flex: 1 1 100%; margin-left: 0 }
  .pg-notice:empty { display: none }
  /* A menu as wide as the toolbar, under it: one hung from its button would run off the screen. */
  .pg-toolbar { position: relative }
  .pg-menu { position: static }
  .pg-menu-list { top: calc(100% - 4px); right: 0; width: auto; max-width: none }
  .pg-tabs { display: flex; gap: 4px; margin-bottom: 12px; position: sticky; top: var(--vp-nav-height, 64px); z-index: 5; background: var(--vp-c-bg); padding: 6px 0 }
  .pg-tabs button {
    flex: 1;
    height: 38px;
    border: 1px solid var(--vp-c-border);
    border-radius: 8px;
    background: var(--vp-c-bg);
    color: var(--vp-c-text-2);
    font: 600 14px var(--vp-font-family-base);
    cursor: pointer;
  }
  .pg-tabs button[aria-selected="true"] { border-color: var(--vp-c-brand-1); color: var(--vp-c-text-1); box-shadow: inset 0 -3px 0 var(--vp-c-brand-1) }
  .pg-main, .no-editor .pg-main { grid-template-columns: 1fr; grid-template-areas: "editor" "preview" "details" }
  .no-editor .pg-editor { display: flex }
  .pg-main[data-tab="spec"] .pg-preview, .pg-main[data-tab="spec"] .pg-details,
  .pg-main[data-tab="preview"] .pg-editor, .pg-main[data-tab="preview"] .pg-details,
  .pg-main[data-tab="details"] .pg-editor, .pg-main[data-tab="details"] .pg-preview { display: none }
  .pg-details { grid-template-columns: 1fr }
  .ed { height: 60vh; min-height: 360px }
  .pg-stage { height: auto; max-height: none; overflow: visible }
}
</style>
