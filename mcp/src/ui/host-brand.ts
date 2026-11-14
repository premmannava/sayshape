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
 * Highest first: the operator's --colors (or --accent); a preset the person
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
  if (c.operatorColors?.length) return c.operatorColors;
  if (c.picked || c.startupPreset !== DEFAULT_PRESET) return undefined;
  return c.brand ? [c.brand] : undefined;
}
