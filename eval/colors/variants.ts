/**
 * Wordings to try in place of the server's own, for an A/B run of `npm run colors-eval`. The server's
 * text is never changed: the script swaps the colors argument's description in the tool list it hands the
 * model, and the final "Colors: …" line of a result, and records which it used. The default is the
 * server's real text.
 *
 * The named variants are starting points for a proposal, to be tried only when a model drops colors
 * often (the numbers decide); `--description-text` and `--note-text` take any wording.
 */

export interface TextVariant {
  /** The description of the colors argument, or undefined to leave the server's. */
  description?: string;
  /** The note that ends a result drawn in colors; {colors} stands for the list. Undefined leaves the server's. */
  note?: string;
}

/** The note the server writes, for finding it in a result (mcp/src/server.ts colorsNote). */
export const NOTE_PATTERN = /(^|\n)Colors: [^\n]*$/;

export const NOTE_VARIANTS: Record<string, string | undefined> = {
  /** The server's own words. */
  real: undefined,
  /** Says what to do, with the argument written out. */
  explicit: "Colors in use in this conversation: {colors}. Send colors with exactly these values on every later show_interface call, with no reminder from the person, until they ask for different colors or for the normal look.",
  /** Shorter and in the imperative. */
  short: "Keep sending colors={colors} on show_interface until the person says otherwise.",
  /** Gives the reason. */
  reason: "These colors are the person's choice for this conversation, and the interface only draws in them when you send them again: nothing remembers them but you. Send colors={colors} on every show_interface call from now on, until they ask for different ones or for the normal colors.",
};

export const DESCRIPTION_VARIANTS: Record<string, string | undefined> = {
  real: undefined,
  /** Says they last for the whole conversation. */
  lasting:
    'Brand colors as hex, most important first, such as ["#e4572e", "#2e86ab"]. Send them when the person, or the instructions you were given, named colors to use, and send the same colors on every later call in the conversation until they ask for something else or for the normal look. Otherwise leave this out.',
};

export function variantList(map: Record<string, string | undefined>): string {
  return Object.keys(map).join(", ");
}

/** A note in a variant's words: {colors} becomes the list written as the argument takes it, ["#aaaaaa", "#bbbbbb"]. */
export function noteText(template: string, colors: readonly string[]): string {
  return template.replaceAll("{colors}", JSON.stringify(colors));
}

/** The colors the server's own note names (its "Colors: #aaa, #bbb. Pass the same…" line). */
export function colorsInNote(line: string): string[] {
  const m = /^Colors: (.*?)\. Pass the same colors/.exec(line.trim());
  return m ? m[1]!.split(", ").map((c) => c.trim()).filter(Boolean) : [];
}
