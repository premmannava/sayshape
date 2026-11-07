/**
 * The view's own settings, chosen by whoever installs the server, never by
 * the model or the person in the chat:
 *
 *   --theme-picker      show a theme selector above the interface (off by default)
 *   --theme <name>      the theme interfaces start in: teal, purple, blue, neutral or studio
 *   --no-save-image     hide the "Save image" button (shown where the chat app can download)
 *
 * main.ts reads them from the command line; the server writes them into the
 * view's HTML as one <meta> tag; the view reads them back. Pure, so the server,
 * the view and the tests share it.
 */
import { PRESETS, type PresetId } from "../../../playground/appearance/presets";

export interface ViewOptions {
  themePicker: boolean;
  theme: PresetId;
  saveImage: boolean;
}

export const DEFAULT_VIEW_OPTIONS: Readonly<ViewOptions> = Object.freeze({ themePicker: false, theme: "teal", saveImage: true });

const META = "sayshape-view";
const PRESET_IDS = PRESETS.map((p) => p.id) as readonly string[];
const isPreset = (v: string | null | undefined): v is PresetId => !!v && PRESET_IDS.includes(v);

/** Read the view's flags from the server's command line. Throws, in plain words, on a theme it doesn't know. */
export function parseViewArgs(args: readonly string[]): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  if (args.includes("--theme-picker")) out.themePicker = true;
  if (args.includes("--no-save-image")) out.saveImage = false;
  const at = args.indexOf("--theme");
  if (at >= 0) {
    const name = args[at + 1];
    if (!isPreset(name)) throw new Error(`--theme needs one of ${PRESET_IDS.join(", ")}${name && !name.startsWith("--") ? `; got "${name}"` : ""}.`);
    out.theme = name;
  }
  return out;
}

/** The settings as one short attribute value: "picker=0&theme=teal&save=1". */
export function encodeViewOptions(o: ViewOptions): string {
  return `picker=${o.themePicker ? 1 : 0}&theme=${o.theme}&save=${o.saveImage ? 1 : 0}`;
}

/** The settings from encodeViewOptions; anything missing or unknown keeps its default. */
export function decodeViewOptions(raw: string | null | undefined): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  if (!raw) return out;
  const p = new URLSearchParams(raw);
  if (p.get("picker") === "1") out.themePicker = true;
  if (p.get("save") === "0") out.saveImage = false;
  const theme = p.get("theme");
  if (isPreset(theme)) out.theme = theme;
  return out;
}

/** The view's HTML with the settings in a <meta name="sayshape-view"> tag at the start of <head>. */
export function withViewOptions(html: string, o: ViewOptions): string {
  const tag = `<meta name="${META}" content="${encodeViewOptions(o)}">`;
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (h) => h + tag);
  // Never before a doctype, which would put the page in quirks mode.
  return /<!doctype[^>]*>/i.test(html) ? html.replace(/<!doctype[^>]*>/i, (d) => d + tag) : tag + html;
}

/** The settings the server wrote into this page, or the defaults. */
export function readViewOptions(doc: Pick<Document, "querySelector">): ViewOptions {
  return decodeViewOptions(doc.querySelector<HTMLMetaElement>(`meta[name="${META}"]`)?.content);
}
