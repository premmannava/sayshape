/**
 * The view's own settings, chosen by whoever installs the server, never by
 * the model or the person in the chat:
 *
 *   --theme-picker      show a theme selector above the interface (off by default)
 *   --theme <name>      the theme interfaces start in: teal, purple, blue, neutral or studio
 *   --accent <color>    a brand color (#rrggbb or #rgb) for buttons, highlights and charts' first series;
 *                       made readable in light and dark (presets.ts resolveTheme). The same as --colors
 *                       with one color
 *   --colors <list>     up to six brand colors, comma-separated, most important first: the first is the
 *                       accent and the first chart series, the rest follow it as series, and series the list
 *                       doesn't cover are worked out from the first (presets.ts resolveTheme, color.ts deriveSeries)
 *   --no-model-colors   no colors argument on show_interface: the conversation can't change the colors, and the
 *                       view ignores any it is sent anyway
 *   --no-save-image     hide the "Save image" button (shown where the chat app can download)
 *   --no-copy-text      hide the "Copy text" button (shown by default)
 *   --no-select-text    no invisible text layer over the canvas: the words can't be selected, copied by
 *                       dragging or found with Ctrl/Cmd+F, and nothing extra is added to the page (on by default)
 *   --scene             turn on experimental scenes: pictures and animations the model paints (off by default)
 *   --logo <https url>  a logo in the corner of every slide of a deck; its host is added to --image-hosts
 *   --slides            accepted and ignored: slide decks are always on
 *   --behavior          turn on experimental behavior: rules that tick, and dragging in scenes (off by default)
 *   --image-hosts <list>  hosts images may load from, comma-separated: cdn.example.com,*.images.example.com (none by default)
 *
 * main.ts reads them from the command line; the server writes them into the
 * view's HTML as one <meta> tag; the view reads them back. Pure, so the server,
 * the view and the tests share it.
 */
import { PRESETS, resolveTheme, type PresetId } from "../../../playground/appearance/presets";
import { colorList, MAX_COLORS, normalizeHex } from "../../../playground/appearance/color";

export interface ViewOptions {
  themePicker: boolean;
  theme: PresetId;
  /**
   * Brand colors as #rrggbb, 1 to 6, most important first, laid over the theme in light and dark
   * (--colors, or --accent as a list of one). Absent means the theme's own.
   */
  colors?: string[];
  /**
   * False with --no-model-colors: show_interface has no colors argument, and the view ignores colors in a
   * tool call's arguments even if a chat app passes them on. Absent means on.
   */
  modelColors?: boolean;
  saveImage: boolean;
  /** The "Copy text" button: this copies the screen's words as plain text (selected text copies as it is). */
  copyText: boolean;
  /**
   * False with --no-select-text: the engine adds no text layer, so nothing over the canvas can be selected or found.
   * Absent means on.
   */
  selectText?: boolean;
  /** Experimental scenes are registered (the server must agree: setScenes). Absent means off. */
  scene?: boolean;
  /** Experimental behavior: rules and scene dragging (the server must agree: setBehavior). Absent means off. */
  behavior?: boolean;
  /** A logo drawn in the corner of every slide (an https address; its host is in imageHosts). Absent means none. */
  logo?: string;
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
  if (args.includes("--no-select-text")) out.selectText = false;
  if (args.includes("--no-model-colors")) out.modelColors = false;
  if (args.includes("--scene")) out.scene = true;
  if (args.includes("--behavior")) out.behavior = true;
  // --slides is still accepted so existing setups keep starting, but decks no longer need it.
  const at = args.indexOf("--theme");
  if (at >= 0) {
    const name = args[at + 1];
    if (!isPreset(name)) throw new Error(`--theme needs one of ${PRESET_IDS.join(", ")}${name && !name.startsWith("--") ? `; got "${name}"` : ""}.`);
    out.theme = name;
  }
  const accentAt = args.indexOf("--accent");
  const colorsAt = args.indexOf("--colors");
  if (accentAt >= 0 && colorsAt >= 0) {
    throw new Error(`Use --colors or --accent, not both: --accent "#e4572e" is the same as --colors "#e4572e", and --colors takes up to ${MAX_COLORS} colors, such as --colors "#e4572e,#2e86ab".`);
  }
  if (accentAt >= 0) {
    const raw = args[accentAt + 1];
    const accent = raw && !raw.startsWith("--") ? normalizeHex(raw) : null;
    if (!accent) throw new Error(`--accent needs a hex color, such as "#e4572e" or "#e45"${raw && !raw.startsWith("--") ? `; got "${raw}"` : ""}.`);
    out.colors = [accent];
  }
  if (colorsAt >= 0) out.colors = parseColors(args[colorsAt + 1]);
  const hostsAt = args.indexOf("--image-hosts");
  if (hostsAt >= 0) {
    const raw = args[hostsAt + 1];
    const hosts = raw && !raw.startsWith("--") ? hostList(raw) : null;
    if (!hosts) {
      throw new Error(`--image-hosts needs up to ${MAX_IMAGE_HOSTS} host names separated by commas, without https:// or a path, such as cdn.example.com,*.images.example.com${raw && !raw.startsWith("--") ? `; got "${raw}"` : ""}.`);
    }
    out.imageHosts = hosts;
  }
  const logoAt = args.indexOf("--logo");
  if (logoAt >= 0) {
    const raw = args[logoAt + 1];
    const logo = raw && !raw.startsWith("--") ? logoAddress(raw) : null;
    if (!logo) throw new Error(`--logo needs the https address of an image, such as https://cdn.example.com/logo.png${raw && !raw.startsWith("--") ? `; got "${raw}"` : ""}.`);
    const host = new URL(logo).hostname;
    const hosts = [...new Set([...(out.imageHosts ?? []), host])];
    if (hosts.length > MAX_IMAGE_HOSTS) throw new Error(`--logo's host, ${host}, would be one more than the ${MAX_IMAGE_HOSTS} hosts --image-hosts allows.`);
    out.logo = logo;
    // The logo loads like any image: the engine and the chat app's sandbox must allow its host.
    out.imageHosts = hosts;
  }
  return out;
}

/**
 * The value of --colors: hex colors (#rrggbb or #rgb, # optional) separated by commas, spaces around them
 * allowed, most important first. Throws, naming the entry, on one that isn't a color, an empty one, none at
 * all, or more than six. (An operator starting a server should hear about a typo, so unlike the colors a
 * model sends in a conversation, nothing here is silently ignored.)
 */
function parseColors(raw: string | undefined): string[] {
  const about = `, such as --colors "#e4572e,#2e86ab,#f2c14e"`;
  if (!raw || raw.startsWith("--")) throw new Error(`--colors needs up to ${MAX_COLORS} hex colors separated by commas, most important first${about}.`);
  const entries = raw.split(",").map((e) => e.trim());
  const out: string[] = [];
  entries.forEach((entry, i) => {
    const hex = normalizeHex(entry);
    if (!hex) {
      const what = entry ? `"${entry}" is not a hex color` : `entry ${i + 1} is empty`;
      throw new Error(`--colors: ${what}. Write each color as #rrggbb or #rgb and separate them with commas${about}; got "${raw}".`);
    }
    out.push(hex);
  });
  if (out.length > MAX_COLORS) {
    throw new Error(`--colors takes up to ${MAX_COLORS} colors (one per chart series); got ${out.length}. Remove the least important ones: the first is the accent.`);
  }
  return out;
}

/**
 * The entries of show_interface's colors argument, whatever shape a model sent it in, so a sloppy value is
 * ignored instead of refused (bad colors never cost a retry): a list keeps its strings and drops anything
 * else in it; a string is read as comma-separated colors ("#e4572e, #2e86ab"); anything else (a number, an
 * object, null) is no colors. The entries still have to be hex colors: colorList picks those out. The
 * server's schema and the view both read the argument through this, so they agree on what was used.
 *
 * partial: the arguments are still streaming in (the view's ontoolinputpartial), so the last entry may be
 * cut short, and "#e45" could be the start of "#e4572e": it counts only once it has all six digits, so the
 * drawing never shows a color that is about to change. The entries before it are complete.
 */
export function colorEntries(raw: unknown, partial = false): string[] {
  const entries = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
  const last = entries[entries.length - 1];
  if (partial && last !== undefined && !/^#?[0-9a-f]{6}$/i.test(last.trim())) entries.pop();
  return entries;
}

/** An https address with a plain host name and nothing that could break out of the view's settings; null otherwise. */
function logoAddress(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || !HOST.test(u.hostname) || u.hostname.includes("*")) return null;
    return u.href.length <= 500 ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * What --accent or --colors becomes in each mode, for the startup message. Text in the
 * first color (the accent) must read at 4.5:1 on the background, and no color does that on
 * both white and a near-black, so most brand colors are moved a little in one mode: a pale
 * one darkened for light mode, a deep one lightened for dark. For a list, the other colors
 * are chart series, which need less (3:1), and the series the list doesn't cover are worked
 * out from the first.
 */
export function accentNotes(o: Pick<ViewOptions, "theme" | "colors">): string[] {
  const colors = colorList(o.colors);
  if (!colors.length) return [];
  const first = colors[0]!;
  const modes = (["light", "dark"] as const).map((scheme) => {
    const r = resolveTheme(o.theme, scheme, colors);
    return r.accentAdjusted ? `${scheme} mode uses ${r.theme.colors.accent}` : `${scheme} mode uses it as is`;
  });
  if (colors.length === 1) return [`accent ${first}: ${modes.join("; ")}, so text in it stays readable.`];
  const rest = MAX_COLORS - colors.length;
  return [
    `colors ${colors.join(", ")}: the first, ${first}, is the accent and the first chart series (${modes.join("; ")}, so text in it stays readable).`,
    `The others are chart series in that order, darkened or lightened where they would be hard to see (one that looks too like an earlier one is replaced)${rest ? `; ${rest === 1 ? "the last series is" : `the last ${rest} series are`} worked out from the first color` : ""}.`,
  ];
}

/** The settings as one short attribute value: "picker=0&theme=teal&save=1&copy=1". Host names need no escaping. */
export function encodeViewOptions(o: ViewOptions): string {
  const images = o.imageHosts?.length ? `&images=${o.imageHosts.join(",")}` : "";
  // Without their #, so the values are plain letters and digits. One color keeps the old name, accent=rrggbb,
  // so a tag written before lists existed reads the same way; several are colors=rrggbb,rrggbb.
  const list = colorList(o.colors).map((c) => c.slice(1));
  const accent = list.length === 1 ? `&accent=${list[0]}` : list.length ? `&colors=${list.join(",")}` : "";
  return `picker=${o.themePicker ? 1 : 0}&theme=${o.theme}${accent}&save=${o.saveImage ? 1 : 0}&copy=${o.copyText ? 1 : 0}${o.modelColors === false ? "&model=0" : ""}${o.selectText === false ? "&select=0" : ""}${o.scene ? "&scene=1" : ""}${o.behavior ? "&behavior=1" : ""}${o.logo ? `&logo=${encodeURIComponent(o.logo)}` : ""}${images}`;
}

/** The settings from encodeViewOptions; anything missing or unknown keeps its default. */
export function decodeViewOptions(raw: string | null | undefined): ViewOptions {
  const out: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  if (!raw) return out;
  const p = new URLSearchParams(raw);
  if (p.get("picker") === "1") out.themePicker = true;
  if (p.get("save") === "0") out.saveImage = false;
  if (p.get("copy") === "0") out.copyText = false;
  if (p.get("select") === "0") out.selectText = false;
  if (p.get("model") === "0") out.modelColors = false;
  if (p.get("scene") === "1") out.scene = true;
  if (p.get("behavior") === "1") out.behavior = true;
  const images = p.get("images");
  const hosts = images ? hostList(images) : null;
  if (hosts) out.imageHosts = hosts;
  const logo = p.get("logo");
  const address = logo ? logoAddress(logo) : null;
  // Only with its host allowed: without that the engine would refuse it anyway.
  if (address && out.imageHosts?.includes(new URL(address).hostname)) out.logo = address;
  const theme = p.get("theme");
  if (isPreset(theme)) out.theme = theme;
  // Six hex digits each, and no more than six colors: anything else would reach the canvas as a color.
  const list = p.get("colors")?.split(",") ?? [];
  const colors = list.length <= MAX_COLORS && list.every((c) => /^[0-9a-f]{6}$/.test(c)) ? list : [];
  const accent = p.get("accent");
  if (!colors.length && accent && /^[0-9a-f]{6}$/.test(accent)) colors.push(accent);
  if (colors.length) out.colors = colors.map((c) => "#" + c);
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
