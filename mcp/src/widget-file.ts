/**
 * For chat apps that can't draw MCP Apps views but can show a widget made from
 * a file: one self-contained HTML fragment per interface, written into the
 * folder the server was started with (--widget-dir). Such an app creates the
 * widget from the file's path, so the engine never passes through the model.
 *
 * What the apps this is for have in common (measured in one of them, Muse):
 *
 * - The widget's sandbox loads nothing from outside: no scripts from a CDN, no
 *   fetch, no remote images. Inline scripts, blob: scripts, DecompressionStream
 *   and data: images work. So the engine is carried in the file itself, gzipped
 *   and base64, unpacked by the loader and run as a blob: script.
 * - A widget is an HTML fragment (no doctype, html, head or body), under 1 MB,
 *   stored whole with the chat and run in its own frame: nothing is shared or
 *   cached between widgets, so every file carries its own engine.
 * - The app scans a widget's source for browser storage names. The loader and
 *   the engine have none, and a spec that happens to say one has its first
 *   letter escaped (inert), so the words never appear in the file.
 * - The frame is about 656 px wide, its height follows the content and its
 *   default font is Times: the wrapping <div> sets its own font and width.
 *
 * The fragment draws like the page for text-only apps (fallback.ts), which
 * stays as it is: the same loader steps, but with the engine from the package,
 * and with the server's own settings (--theme, --accent or --colors, --image-hosts,
 * --scene, --behavior) carried across.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveTheme, type PresetId } from "../../playground/appearance/presets";
import { NOTHING_SENT, scriptJson, usesMap } from "./fallback";
import type { PackedEngine } from "./widget-engine";

/** The most a file may be: apps that take widgets refuse more than 1 MB, so stay under it. */
export const WIDGET_MAX_BYTES = 1_000_000;
/** How many files are kept in the folder, newest first. */
export const WIDGET_KEEP = 50;
/** The server's own file names: nothing else in the folder is ever touched. */
export const WIDGET_FILE = /^sayshape-[0-9a-f]{16}\.html$/;

export interface WidgetOptions {
  spec: string;
  /** The packed engine (widget-engine.ts). */
  engine: PackedEngine;
  /** --theme and --accent or --colors: the theme the interface draws in, resolved for light and dark. Default: teal. */
  theme?: PresetId;
  colors?: readonly string[];
  /** --image-hosts: the hosts the engine may load images from. */
  imageHosts?: readonly string[];
  /** --logo: drawn in the corner of every slide of a deck. */
  logo?: string;
  /** --scene, --behavior: the experimental elements the engine registers. */
  scenes?: boolean;
  behavior?: boolean;
  /** False with --no-select-text: the engine adds no text layer. Absent means on. */
  selectText?: boolean;
  /**
   * The JavaScript source of a function expression for a host (a chat app) to hook in. The loader calls it
   * once, after the first setSpec, as `(SOURCE)(ui, S, root)`: ui is the SayShape instance, S is the engine's
   * global (window.sayshape) and root is the wrapping <div>. It may return nothing, or an object with an
   * optional emit(action): actions other than a link go there. A host that throws never stops the drawing.
   */
  host?: string;
}

/**
 * JSON for a script, as scriptJson, and with browser storage names written so
 * the file never contains them (the first letter becomes a \u escape, which
 * means the same inside a string): apps that scan widgets refuse them, even
 * in text a spec merely shows.
 */
function inertJson(value: unknown): string {
  return scriptJson(value).replace(/(l)(ocalStorage)|(s)(essionStorage)|(i)(ndexedDB)|(o)(penDatabase)/gi, (_m, ...g: string[]) => {
    const at = [0, 2, 4, 6].find((i) => g[i] !== undefined)!;
    return `\\u00${g[at]!.charCodeAt(0).toString(16)}${g[at + 1]}`;
  });
}

/** Source code for a <script>: the same guards as for JSON, for code that is meant to stay code. */
const inertSource = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** What shows in place of the canvas if the engine can't be unpacked here. */
export const NO_UNPACK = "This chat app can't unpack the SayShape engine that draws this interface, so it can't be shown here.";
/** What shows if it unpacked but didn't start. */
export const NO_START = "The SayShape engine didn't start in this chat app, so this interface can't be shown here.";

/** The wrapping <div>'s font: HTML text in a widget's frame would otherwise be Times. */
const FONT = "15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif";

interface Parts {
  /** Ids in the file all start with this, so no two files (and nothing around them) share one. */
  id: string;
}

/** The fragment for an id. Built twice by fragment(): once with no id to name the file, once with its own. */
function body(o: WidgetOptions, { id }: Parts): string {
  const map = usesMap(o.spec);
  const themes = {
    light: resolveTheme(o.theme ?? "teal", "light", o.colors ?? null).theme,
    dark: resolveTheme(o.theme ?? "teal", "dark", o.colors ?? null).theme,
  };
  if (o.logo) for (const t of [themes.light, themes.dark]) t.deck = { ...t.deck, logo: o.logo };
  const packs = [o.engine.engine.base64, ...(map ? [o.engine.map.base64] : [])];
  const components =
    "S.coreComponents" +
    (o.scenes ? ".concat(S.sceneComponents)" : "") +
    (map ? ".concat(window.sayshapeMap ? window.sayshapeMap.mapComponents : [])" : "");
  // The host's function sits in a script of its own, so even source that doesn't parse can't stop the main one.
  const hostScript = o.host === undefined ? "" : `<script>\ndocument.getElementById(${scriptJson(id)}).sayshapeHost = (\n${inertSource(o.host)}\n);\n</script>\n`;
  const hosted = o.host === undefined ? "" : `
    // A host (a chat app) hooks in here, once the interface is drawn; if it throws, nothing is lost.
    try { var made = box.sayshapeHost(ui, S, box); if (made && typeof made === "object") hooks = made; } catch (e) {}`;
  return `<div id="${id}" style="box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;font:${FONT}">
<canvas id="${id}-view" aria-label="An interface drawn by SayShape" style="display:block;max-width:100%"></canvas>
<p id="${id}-note" hidden style="margin:20px"></p>
${hostScript}<script>
(function () {
  var box = document.getElementById(${scriptJson(id)}), canvas = document.getElementById(${scriptJson(`${id}-view`)}), note = document.getElementById(${scriptJson(`${id}-note`)});
  var spec = ${inertJson(o.spec)};
  var themes = ${inertJson(themes)};
  var packs = ${scriptJson(packs)};
  var hooks = null;
  function fail(text) { canvas.style.display = "none"; note.textContent = text; note.hidden = false; }
  if (!(window.DecompressionStream && window.Blob && window.Response && window.atob && window.URL && URL.createObjectURL)) { fail(${scriptJson(NO_UNPACK)}); return; }
  // The engine is carried gzipped: unpack it and run it as a blob: script, so nothing is fetched.
  function load(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).blob().then(function (code) {
      return new Promise(function (done, failed) {
        var url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        var script = document.createElement("script");
        script.onload = function () { URL.revokeObjectURL(url); done(); };
        script.onerror = function () { URL.revokeObjectURL(url); failed(new Error("script")); };
        script.src = url;
        box.appendChild(script);
      });
    });
  }
  function start() {
    var S = window.sayshape, root = document.documentElement;
    if (!S) { fail(${scriptJson(NO_START)}); return; }
    var components = ${components};
    var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function theme() {
      var chosen = root.getAttribute("data-theme");
      return chosen === "dark" || (chosen !== "light" && media && media.matches) ? themes.dark : themes.light;
    }
    var ui = new S.SayShape(canvas, { components: components, theme: theme(), imageHosts: ${scriptJson(o.imageHosts ?? [])}${o.behavior ? ", behavior: true" : ""}${o.selectText === false ? ", selectText: false" : ""} });
    function apply() {
      var t = theme();
      box.style.background = t.colors.surface;
      box.style.color = t.colors.ink;
      ui.setTheme(t);
    }
    apply();
    if (media && media.addEventListener) media.addEventListener("change", apply);
    if (window.MutationObserver) new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    // A link pressed in rich text opens in a new tab, https only, as on any web page. Any other action
    // goes to the host's emit, if it gave one; otherwise there is no chat to send it to.
    ui.on("action", function (a) {
      if (a.name === "link") {
        var url = null;
        try { url = new URL(String(a.value)); } catch (e) {}
        if (url && url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (hooks && typeof hooks.emit === "function") {
        try { hooks.emit(a); return; } catch (e) {}
      }
      ui.notify(${scriptJson(NOTHING_SENT)});
    });
    ui.setSpec(spec);${hosted}
  }
  var loading = load(packs[0]);
  for (var n = 1; n < packs.length; n++) loading = loading.then(load.bind(null, packs[n]));
  loading.then(start).then(null, function () { fail(${scriptJson(NO_START)}); });
})();
</script>
</div>
`;
}

/**
 * The fragment and its file name. Both come from one hash: the fragment with no id, which holds the spec,
 * every setting, the engine and the loader. So the same interface, settings and engine always give the same
 * name, and ids are unique to the file.
 */
function made(o: WidgetOptions): { html: string; name: string } {
  const hash = createHash("sha256").update(body(o, { id: "" })).digest("hex");
  return { html: body(o, { id: `sw-${hash.slice(16, 28)}` }), name: `sayshape-${hash.slice(0, 16)}.html` };
}

/** The file's name for these options. */
export const widgetFileName = (o: WidgetOptions): string => made(o).name;

/**
 * The fragment: one wrapping <div> (no doctype, html, head or body) holding a
 * canvas, a note for when the engine can't run, and one script with the spec,
 * the packed engine (and the map's, when the spec has a map), and the loader.
 */
export const widgetFragment = (o: WidgetOptions): string => made(o).html;

export type WidgetResult =
  | { ok: true; path: string; bytes: number; reused: boolean }
  | { ok: false; reason: string; bytes?: number };

/**
 * Writes the fragment into the folder, or says why it can't. The same
 * interface reuses its file (touched, so it counts as the newest); then files
 * past the newest WIDGET_KEEP that match the server's own naming are deleted.
 */
export async function writeWidget(dir: string, o: WidgetOptions): Promise<WidgetResult> {
  const { html, name } = made(o);
  const bytes = Buffer.byteLength(html);
  if (bytes >= WIDGET_MAX_BYTES) {
    return { ok: false, bytes, reason: `it would be ${Math.round(bytes / 1024)} KB, and a widget has to be under 1 MB${usesMap(o.spec) ? " (the map's outlines are most of it)" : ""}` };
  }
  const path = resolve(dir, name);
  try {
    await mkdir(dir, { recursive: true });
    let reused = false;
    try {
      reused = (await stat(path)).size === bytes;
    } catch {
      /* not there yet */
    }
    if (reused) {
      const now = new Date();
      await utimes(path, now, now);
    } else {
      // Written whole under another name, then renamed: a reader never sees half a file.
      const temp = join(dir, `.${name}.${process.pid}.tmp`);
      await writeFile(temp, html);
      await rename(temp, path);
    }
    await pruneWidgets(dir, WIDGET_KEEP, name).catch(() => []);
    return { ok: true, path, bytes, reused };
  } catch (e) {
    return { ok: false, reason: `the file couldn't be written to ${dir} (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * Deletes the oldest of the server's own files beyond `keep`, never `current`.
 * Only names matching WIDGET_FILE are considered: anything else in the folder is left alone.
 */
export async function pruneWidgets(dir: string, keep = WIDGET_KEEP, current?: string): Promise<string[]> {
  const mine: Array<{ name: string; at: number }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !WIDGET_FILE.test(entry.name) || entry.name === current) continue;
    try {
      mine.push({ name: entry.name, at: (await stat(join(dir, entry.name))).mtimeMs });
    } catch {
      /* gone already */
    }
  }
  mine.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
  const removed: string[] = [];
  for (const old of mine.slice(Math.max(0, keep - (current ? 1 : 0)))) {
    try {
      await unlink(join(dir, old.name));
      removed.push(old.name);
    } catch {
      /* in use or gone: leave it */
    }
  }
  return removed;
}

/** What the model is told when the file is ready. No HTML, and the file is not to be read: it holds the engine. */
export function widgetText(path: string, bytes: number): string {
  return (
    "This chat app can't draw interfaces itself, but it can show a widget made from a file, and the file for this interface is ready:\n" +
    `${path}\n` +
    "Create the widget from that file exactly as it is. Don't read it and don't edit it: it carries the whole engine " +
    `(about ${Math.round(bytes / 1024)} KB), which would fill your context for nothing. Don't call show_interface again unless the person asks for a change.`
  );
}

/**
 * With a host adapter (--widget-host): what the quick start says about emit:. A press can't reach the model
 * while it is answering, but the adapter keeps it in the widget's state.
 */
export const PRESSES_SAVED =
  "on=emit:name saves a press for your next turn: this chat app can't send it to you as it happens. " +
  "After the person's next message, read the widget's state: its actions list holds what they pressed (name, value, time) and its state holds the interface's values. " +
  "Don't wait for a press; also update the screen in the same on=, e.g. on=set:sel:{x.name};emit:pick:{x.name}.";

/** The same, added to the result for a spec that uses emit:. */
export const PRESSES_SAVED_RESULT =
  "This interface has buttons that use emit:. Presses are saved for your next turn, not sent now: after the person's next message, read the widget's state, where its actions list holds what they pressed.";

/** The lead when there are problems to fix first: no file is made until there are none. */
export const widgetFixLead = (n: number) =>
  `${n} problem${n === 1 ? "" : "s"} leave${n === 1 ? "s" : ""} part of this interface wrong or missing, and this chat app can't draw interfaces, so nothing is showing yet. ` +
  `Fix ${n === 1 ? "it" : "them"} and call show_interface again with the whole corrected spec; once there's nothing to fix, the result names a file to make a widget from:`;

/** The same interface again: its file is already in an earlier result. */
export const WIDGET_REPEAT_TEXT =
  "An earlier show_interface result already named the file for this exact interface, so there's no new file. " +
  "Use that one, and don't call show_interface again unless the person asks for a change.";

/** What the model is told when the spec is fine but no file could be made. */
export const widgetFailedText = (reason: string) =>
  `The interface is written correctly, but this chat app can't draw interfaces and no file could be made for it: ${reason}. ` +
  "So nothing is showing. Tell the person, and answer them in text or with a smaller interface.";
