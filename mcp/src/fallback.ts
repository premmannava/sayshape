/**
 * For chat apps that can't draw MCP Apps views (text-only clients): a small,
 * complete HTML page that draws the interface, which show_interface puts in
 * its text result for the model to publish as a page or save as a file.
 *
 * The page loads the engine as one classic script from jsDelivr
 * (dist/sayshape.global.js, built by scripts/build-browser.mjs) instead of
 * carrying it, so it stays a few kilobytes: models that publish pages often
 * have to read a file before they can publish it.
 *
 * The server writes no files and the page carries no rows: interfaces that
 * load datasets can't be shown this way (the rows would have to go through
 * the conversation, which is what datasets exist to avoid).
 */
import { lightTheme, darkTheme } from "../../src/theme";

/**
 * The sayshape release the page loads, pinned exactly so a page keeps working
 * as new versions come out.
 *
 * It is deliberately not this package's own version. Some chat apps only let
 * pages load a package version from a CDN once it has been public for two
 * weeks, so a page pointing at a release made the same day as this server
 * would fail exactly when people install it. At each release, move it to the
 * newest sayshape version that has been on npm for at least 14 days and has
 * dist/sayshape.global.js (0.1.1 is the first), and never later than the
 * version being released. docs/releasing.md has the step; `npm run verify:pack --
 * --registry <version>` checks the version exists and says how old it is.
 *
 * The cost: for up to one release the page draws with a slightly older engine
 * than the one that checked the spec, so a brand-new element can be skipped
 * on the page. The server's check still catches every mistake a model makes.
 */
export const PAGE_ENGINE_VERSION = "0.1.1";
export const PAGE_CDN = "https://cdn.jsdelivr.net/npm";
export const engineScriptUrl = (file: "sayshape.global.js" | "sayshape-map.global.js", version = PAGE_ENGINE_VERSION) =>
  `${PAGE_CDN}/sayshape@${version}/dist/${file}`;

/**
 * JSON that can sit inside a <script> element: "<" is written as <, so
 * nothing in it can close the script (</script>) or open a comment (<!--)
 * that changes how the browser reads the rest. U+2028 and U+2029 are escaped
 * too, for older browsers that treat them as line ends in scripts.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Does the spec use the map, which is a second script (it carries the world's outlines)? */
export const usesMap = (spec: string) => /^[ \t]*map(?=[ \t]|$)/m.test(spec);

export interface PageOptions {
  spec: string;
  title?: string | null;
  /** The server was started with --scene, so the page registers scenes too. */
  scenes?: boolean;
  version?: string;
}

/**
 * The page: a canvas, the engine from jsDelivr, and the spec. It follows the
 * viewer's light or dark mode, and data-theme="light|dark" on the root element
 * when the page it's published in sets one; its background is the engine
 * theme's own surface. The engine sizes the canvas to the page's width, so it
 * works on a phone with no sideways scrolling.
 */
export function fallbackPage({ spec, title, scenes = false, version = PAGE_ENGINE_VERSION }: PageOptions): string {
  const map = usesMap(spec);
  const light = lightTheme.colors;
  const dark = darkTheme.colors;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title?.trim() || "SayShape interface")}</title>
<style>
:root { color-scheme: light; --bg: ${light.surface}; --ink: ${light.ink}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --bg: ${dark.surface}; --ink: ${dark.ink}; } }
:root[data-theme="dark"] { color-scheme: dark; --bg: ${dark.surface}; --ink: ${dark.ink}; }
html, body { margin: 0; background: var(--bg); color: var(--ink); }
body { overflow-x: hidden; font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; }
canvas { display: block; max-width: 100%; }
#note { margin: 20px; }
</style>
</head>
<body>
<main><canvas id="view" aria-label="An interface drawn by SayShape"></canvas><p id="note" hidden></p></main>
<script src="${engineScriptUrl("sayshape.global.js", version)}"></script>
${map ? `<script src="${engineScriptUrl("sayshape-map.global.js", version)}"></script>\n` : ""}<script>
(function () {
  var spec = ${scriptJson(spec)};
  var S = window.sayshape, root = document.documentElement;
  if (!S) {
    var note = document.getElementById("note");
    // A failed script can't tell a missing version from no connection, so say both.
    note.textContent = ${scriptJson(`The SayShape engine (sayshape@${version}) didn't load from cdn.jsdelivr.net, so this interface can't be drawn. Either there's no internet connection, or that version isn't available from the CDN yet.`)};
    note.hidden = false;
    return;
  }
  var components = S.coreComponents${scenes ? ".concat(S.sceneComponents)" : ""}${map ? ".concat(window.sayshapeMap ? window.sayshapeMap.mapComponents : [])" : ""};
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function theme() {
    var chosen = root.getAttribute("data-theme");
    return chosen === "dark" || (chosen !== "light" && media && media.matches) ? S.darkTheme : S.lightTheme;
  }
  var ui = new S.SayShape(document.getElementById("view"), { components: components, theme: theme() });
  function apply() {
    var t = theme();
    root.style.setProperty("--bg", t.colors.surface);
    root.style.setProperty("--ink", t.colors.ink);
    ui.setTheme(t);
  }
  apply();
  if (media && media.addEventListener) media.addEventListener("change", apply);
  if (window.MutationObserver) new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  // This page is the host. A link the person presses in rich text (emit:link) opens in a new tab,
  // https only, as any link on a web page would. Any other emit: has no chat to reach; the server
  // asks for those to be removed, so this note is only a safety net.
  ui.on("action", function (a) {
    if (a.name === "link") {
      var url = null;
      try { url = new URL(String(a.value)); } catch (e) {}
      if (url && url.protocol === "https:") window.open(url.href, "_blank", "noopener,noreferrer");
      return;
    }
    ui.notify(${scriptJson(NOTHING_SENT)});
  });
  ui.setSpec(spec);
})();
</script>
</body>
</html>
`;
}

/** Shown on the page if an emit: action fires there anyway. */
export const NOTHING_SENT = "This page can't send that back to the chat. Tell the assistant in the chat instead.";

/** What the model is told to do with the page. It names no product or tool: it's the same for every chat app. */
export const PAGE_TEXT =
  "This chat app can't draw interfaces, so nothing is showing yet: the HTML page below draws it. " +
  "If you have a tool that publishes a web page for the person to open, publish this page exactly as it is; " +
  "otherwise save it as an .html file and give the person the file's full path to open in a web browser.";

/** A fence longer than any run of backticks in the page, so a spec can't end the code block early. */
export function fenced(html: string): string {
  const longest = Math.max(0, ...(html.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}html\n${html}${fence}`;
}

/** The same interface again: the page is already in an earlier result, so no second page. */
export const PAGE_REPEAT_TEXT =
  "An earlier show_interface result already has the page for this exact interface, so there's no new page. " +
  "Use that one, and don't call show_interface again unless the person asks for a change.";

/** An interface that loads datasets: the page can't fetch rows, and the rows must not come through the conversation. */
export const PAGE_DATASETS_TEXT =
  "This chat app can't draw interfaces, and an interface that loads a dataset (the data argument) can only be shown by an app that can, " +
  "because the rows never pass through the conversation. So nothing is showing, and there is no page to publish. " +
  "Tell the person this chat app can't show interfaces with data from the database or imported results, and answer them in text.";

/** The lead when there are problems to fix first: nothing shows in a text-only app until then. */
export const pageFixLead = (n: number) =>
  `${n} problem${n === 1 ? "" : "s"} leave${n === 1 ? "s" : ""} part of this interface wrong or missing, and this chat app can't draw interfaces, so nothing is showing yet. ` +
  `Fix ${n === 1 ? "it" : "them"} and call show_interface again with the whole corrected spec; once there's nothing to fix, the result has a page to show the person:`;
