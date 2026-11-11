/**
 * The view's own settings, chosen by whoever installs the server, never by
 * the model or the person in the chat:
 *
 *   --theme-picker      show a theme selector above the interface (off by default)
 *   --theme <name>      the theme interfaces start in: teal, purple, blue, neutral or studio
 *   --accent <color>    a brand color (#rrggbb or #rgb) for buttons, highlights and charts' first series;
 *                       made readable in light and dark (presets.ts resolveTheme)
 *   --no-save-image     hide the "Save image" button (shown where the chat app can download)
 *   --no-copy-text      hide the "Copy text" button (shown by default)
 *   --scene             turn on experimental scenes: pictures and animations the model paints (off by default)
 *   --image-hosts <list>  hosts images may load from, comma-separated: cdn.example.com,*.images.example.com (none by default)
 *
 * main.ts reads them from the command line; the server writes them into the
 * view's HTML as one <meta> tag; the view reads them back. Pure, so the server,
 * the view and the tests share it.
 */
import { PRESETS, resolveTheme, type PresetId } from "../../../playground/appearance/presets";
import { normalizeHex } from "../../../playground/appearance/color";

export interface ViewOptions {
  themePicker: boolean;
  theme: PresetId;
  /** A brand color as #rrggbb, laid over the theme in light and dark. Absent means the theme's own. */
  accent?: string;
  saveImage: boolean;
  /** The "Copy text" button: a canvas has no text to select, so this copies the screen's words instead. */
  copyText: boolean;
  /** Experimental scenes are registered (the server must agree: setScenes). Absent means off. */
  scene?: boolean;
  /**
   * Hosts images may load from (the engine's imageHosts; the server must agree:
   * setImageHosts, and the view resource's CSP). Absent means none: the view has
   * no origin of its own to load from, so no images show.
   */
  imageHosts?: string[];
}

export const DEFAULT_VIEW_OPTIONS: Readonly<ViewOptions> = Object.freeze({ themePicker: false, theme: "teal", saveImage: true, copyText: true });

const META = "sayshape-view";
const PRESET_IDS = PRESETS.map((p) => p.id) as readonly string[];
const isPreset = (v: string | null | undefined): v is PresetId => !!v && PRESET_IDS.includes(v);

/** A host name, or "*.example.com" for its subdomains: no scheme, port, path or bare "*". */
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** More would make the CSP and the guide long for no real use. */
export const MAX_IMAGE_HOSTS = 20;

/** The hosts in a comma-separated list, lower-cased, without repeats; null if any isn't a host name. */
function hostList(raw: string): string[] | null {
  const hosts = [...new Set(raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean))];
  return hosts.length && hosts.length <= MAX_IMAGE_HOSTS && hosts.every((h) => HOST.test(h)) ? hosts : null;
}

/** Read the view's flags from the server's command line. Throws, in plain words, on a theme or color it doesn't know. */
export function parseViewArgs(args: readonly string[]): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  if (args.includes("--theme-picker")) out.themePicker = true;
  if (args.includes("--no-save-image")) out.saveImage = false;
  if (args.includes("--no-copy-text")) out.copyText = false;
  if (args.includes("--scene")) out.scene = true;
  const at = args.indexOf("--theme");
  if (at >= 0) {
    const name = args[at + 1];
    if (!isPreset(name)) throw new Error(`--theme needs one of ${PRESET_IDS.join(", ")}${name && !name.startsWith("--") ? `; got "${name}"` : ""}.`);
    out.theme = name;
  }
  const accentAt = args.indexOf("--accent");
  if (accentAt >= 0) {
    const raw = args[accentAt + 1];
    const accent = raw && !raw.startsWith("--") ? normalizeHex(raw) : null;
    if (!accent) throw new Error(`--accent needs a hex color, such as "#e4572e" or "#e45"${raw && !raw.startsWith("--") ? `; got "${raw}"` : ""}.`);
    out.accent = accent;
  }
  const hostsAt = args.indexOf("--image-hosts");
  if (hostsAt >= 0) {
    const raw = args[hostsAt + 1];
    const hosts = raw && !raw.startsWith("--") ? hostList(raw) : null;
    if (!hosts) {
      throw new Error(`--image-hosts needs up to ${MAX_IMAGE_HOSTS} host names separated by commas, without https:// or a path, such as cdn.example.com,*.images.example.com${raw && !raw.startsWith("--") ? `; got "${raw}"` : ""}.`);
    }
    out.imageHosts = hosts;
  }
  return out;
}

/**
 * What --accent becomes in each mode, for the startup message. Text in it
 * must read at 4.5:1 on the background, and no color does that on both white
 * and a near-black, so most brand colors are moved a little in one mode: a
 * pale one darkened for light mode, a deep one lightened for dark.
 */
export function accentNotes(o: Pick<ViewOptions, "theme" | "accent">): string[] {
  if (!o.accent) return [];
  const modes = (["light", "dark"] as const).map((scheme) => {
    const r = resolveTheme(o.theme, scheme, o.accent!);
    return r.accentAdjusted ? `${scheme} mode uses ${r.theme.colors.accent}` : `${scheme} mode uses it as is`;
  });
  return [`accent ${o.accent}: ${modes.join("; ")}, so text in it stays readable.`];
}

/** The settings as one short attribute value: "picker=0&theme=teal&save=1&copy=1". Host names need no escaping. */
export function encodeViewOptions(o: ViewOptions): string {
  const images = o.imageHosts?.length ? `&images=${o.imageHosts.join(",")}` : "";
  // Without its #, so the value is plain letters and digits.
  const accent = o.accent ? `&accent=${o.accent.slice(1)}` : "";
  return `picker=${o.themePicker ? 1 : 0}&theme=${o.theme}${accent}&save=${o.saveImage ? 1 : 0}&copy=${o.copyText ? 1 : 0}${o.scene ? "&scene=1" : ""}${images}`;
}

/** The settings from encodeViewOptions; anything missing or unknown keeps its default. */
export function decodeViewOptions(raw: string | null | undefined): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  if (!raw) return out;
  const p = new URLSearchParams(raw);
  if (p.get("picker") === "1") out.themePicker = true;
  if (p.get("save") === "0") out.saveImage = false;
  if (p.get("copy") === "0") out.copyText = false;
  if (p.get("scene") === "1") out.scene = true;
  const images = p.get("images");
  const hosts = images ? hostList(images) : null;
  if (hosts) out.imageHosts = hosts;
  const theme = p.get("theme");
  if (isPreset(theme)) out.theme = theme;
  // Six hex digits only: anything else would reach the canvas as a color.
  const accent = p.get("accent");
  if (accent && /^[0-9a-f]{6}$/.test(accent)) out.accent = "#" + accent;
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
