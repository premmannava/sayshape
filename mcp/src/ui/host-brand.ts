/**
 * A known chat app's brand color. The view learns the chat app's name from the
 * MCP Apps handshake (the host's name and version), so this lives here and not
 * in the server, which in the stateless HTTP mode never sees who connected.
 *
 * The table is the owner's. Names are matched loosely (lower-cased, by
 * substring, first match wins) because apps announce themselves in different
 * ways; the view logs what each one announces (`announce`) so entries can be
 * corrected from what real apps say.
 */
import { DEFAULT_PRESET } from "./theme-selection";
import { colorList } from "../../../playground/appearance/color";
import { colorEntries } from "./view-options";
import type { PresetId } from "../../../playground/appearance/presets";

/** Host name fragments to a brand color, in the order they are tried. */
export const HOST_BRANDS: readonly { readonly match: readonly string[]; readonly color: string }[] = [
  { match: ["claude"], color: "#D97757" },
  { match: ["chatgpt", "openai"], color: "#10A37F" },
  { match: ["visual studio code", "vscode"], color: "#007ACC" },
  { match: ["gemini"], color: "#4285F4" },
  { match: ["grok"], color: "#000000" },
];

/** The brand color for a host name, or undefined for an unknown host, a missing name or a name that isn't text. */
export function brandColorFor(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const lower = name.toLowerCase();
  return HOST_BRANDS.find((b) => b.match.some((m) => lower.includes(m)))?.color;
}

/** The one line the view logs per connection: the name and version exactly as the chat app announced them. */
export function announce(host: { name?: unknown; version?: unknown } | undefined): string {
  return `SayShape view: host announced name=${JSON.stringify(host?.name)} version=${JSON.stringify(host?.version)}`;
}

export interface ColorChoice {
  /** The colors argument of this view's show_interface call (conversation colors), already through toolColors. */
  conversationColors?: readonly string[];
  /** --colors (or --accent, a list of one) at server start (operator colors). */
  operatorColors?: readonly string[];
  /** True once the person has chosen a preset in the toolbar's theme selector. */
  picked: boolean;
  /** The preset the server started with (--theme, else the default). */
  startupPreset: PresetId;
  /** The brand color of the chat app, if it is a known one. */
  brand?: string;
}

/**
 * The brand colors to lay over the preset, or undefined for the preset's own.
 * Highest first: the colors argument of the tool call (the conversation's
 * colors), over everything below, a picked preset included; the operator's --colors (or --accent); a preset the person
 * picked (its own accent); the chat app's brand color, as a list of one so it
 * gets chart series worked out from it like any first color; the default
 * preset's accent.
 *
 * A preset other than the default at startup (--theme purple) is the
 * operator's choice of look, so it keeps its accent too; only the default
 * preset, which an operator who said nothing gets, gives way to the brand.
 * (--theme teal says the same as nothing, so it cannot be told apart.)
 */
export function chosenColors(c: ColorChoice): readonly string[] | undefined {
  if (c.conversationColors?.length) return c.conversationColors;
  if (c.operatorColors?.length) return c.operatorColors;
  if (c.picked || c.startupPreset !== DEFAULT_PRESET) return undefined;
  return c.brand ? [c.brand] : undefined;
}

/**
 * The usable colors in a tool call's arguments (show_interface's colors), or undefined when there are none:
 * not sent, neither a list nor a comma-separated string, nothing in it a hex color, or --no-model-colors
 * (allowed false). The shapes are read by colorEntries, which the server's schema uses too, and sloppy
 * entries are dropped and extras past six ignored (colorList), so both agree on what was used.
 *
 * partial: the arguments are still streaming in (ontoolinputpartial): see colorEntries.
 */
export function toolColors(args: Record<string, unknown> | undefined, allowed: boolean, partial = false): string[] | undefined {
  if (!allowed) return undefined;
  const list = colorList(colorEntries(args?.colors, partial));
  return list.length ? list : undefined;
}

/** Whether two color lists are the same (undefined is no list). */
export function sameColors(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return (a ?? []).join(",") === (b ?? []).join(",");
}

/** The console line when a call's colors first arrive: before or after the spec's first line was drawn. */
export function colorsArrival(colors: readonly string[], shownSoFar: string): string {
  const lines = shownSoFar.split("\n").filter((l) => l.trim() !== "").length;
  return `SayShape view: colors ${colors.join(", ")} arrived ${lines ? `after ${lines} line${lines === 1 ? "" : "s"} of the spec` : "before the spec's first line"}`;
}
