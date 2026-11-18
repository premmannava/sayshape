/**
 * How the view sits in a chat (the chat look, on unless --no-chat-look): on
 * the chat app's own background, with no color of its own behind the
 * interface. Only cards the spec writes draw a surface.
 *
 * The view's colors are chosen for light or dark, so the background is left
 * to the chat app only when the app said which it is (McpUiHostContext.theme).
 * Otherwise the view guesses from the system setting, and a chat app in dark
 * mode on a light system would show dark text on its dark page: the theme's
 * surface is painted behind it then, as it always was.
 */
import type { Theme } from "../../../src/theme";

/** The CSS color painted behind the interface and the toolbar. */
export function viewBackground(theme: Theme, hostMode: string | undefined, chatLook: boolean): string {
  return chatLook && (hostMode === "light" || hostMode === "dark") ? "transparent" : theme.colors.surface;
}
