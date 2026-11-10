import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

/**
 * Client capabilities announcing MCP Apps, as chat apps that draw views send
 * them when they connect. Most tests are about those clients; a client
 * created without them is a text-only one, which gets a page to show instead.
 */
export const UI_CLIENT = { capabilities: { extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } } } };
