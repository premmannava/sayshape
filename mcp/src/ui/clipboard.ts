/**
 * Putting text on the clipboard from inside a chat app's sandboxed iframe.
 *
 * The server asks for clipboard-write (the view resource's
 * permissions.clipboardWrite), but a chat app may not grant it, so this tries
 * the Clipboard API first and falls back to the older copy command on a
 * hidden text box, which sandboxes often still allow during a press. Both run
 * only in response to the person pressing Copy text or Ctrl/Cmd+C.
 */

/** What copying needs from the page, so tests can stand in for a browser. */
export interface ClipboardEnv {
  /** navigator.clipboard.writeText, when the page has it. */
  writeText?: (text: string) => Promise<void>;
  /** The legacy route: put the text in a hidden field, select it, run the copy command. */
  copyCommand?: (text: string) => boolean;
}

/** Whether the text reached the clipboard. */
export async function writeClipboard(text: string, env: ClipboardEnv): Promise<boolean> {
  if (env.writeText) {
    try {
      await env.writeText(text);
      return true;
    } catch {
      // Not granted here: try the older way.
    }
  }
  try {
    return env.copyCommand?.(text) ?? false;
  } catch {
    return false;
  }
}

/** The page's own clipboard routes. */
export function browserClipboard(doc: Document): ClipboardEnv {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    writeText: clip?.writeText ? (text) => clip.writeText(text) : undefined,
    copyCommand: (text) => {
      // Invisible and gone straight away: it only holds the text for the copy command.
      const area = doc.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.setAttribute("aria-hidden", "true");
      area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
      const before = doc.activeElement as HTMLElement | null;
      doc.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = doc.execCommand("copy");
      } finally {
        area.remove();
        before?.focus?.({ preventScroll: true });
      }
      return ok;
    },
  };
}
