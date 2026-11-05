/**
 * The A2UI side of the live comparison: what a model is told so it answers in
 * A2UI (Google's Agent-to-User Interface protocol, v0.9) instead of SayShape
 * or HTML.
 *
 * Nothing here is written by hand about A2UI's components: the message schema,
 * the common types, the basic catalog and the examples are A2UI's own files,
 * read from @a2ui/web_core, so the prompt says exactly what the protocol says.
 * Only the framing lines (one message per line, the surface id, the width)
 * are ours, and they match what the SayShape and HTML prompts are told.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** The basic catalog every A2UI renderer ships, by its id. */
export const A2UI_CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

/** Official examples shown to the model, from the basic catalog's examples folder. */
const EXAMPLES = ["27_stats-card.json", "00_simple-login-form.json"];

function schemas(): string {
  // The package exports no package.json, so find its folder from its entry point.
  const entry = createRequire(import.meta.url).resolve("@a2ui/web_core");
  const root = entry.slice(0, entry.lastIndexOf("@a2ui/web_core") + "@a2ui/web_core".length);
  return join(root, "src", "v0_9", "schemas");
}

/** A JSON file from A2UI's schemas, without its whitespace, so the prompt carries no padding. */
function compact(path: string): string {
  return JSON.stringify(JSON.parse(readFileSync(path, "utf8")));
}

/** An official example as the model should write it: one message per line. */
function example(name: string): string {
  const ex = JSON.parse(readFileSync(join(schemas(), "catalogs", "basic", "examples", name), "utf8")) as { name: string; messages: unknown[] };
  return `${ex.name}:\n${ex.messages.map((m) => JSON.stringify(m)).join("\n")}`;
}

export function a2uiPrompt(): string {
  const dir = schemas();
  return [
    "You write interactive UI for a chat app as A2UI v0.9 messages, drawn by the app's A2UI renderer with the basic catalog.",
    `Reply with JSONL: one complete JSON message per line. Start with createSurface (surfaceId "main", catalogId "${A2UI_CATALOG}"), then updateComponents with a component whose id is "root", then updateDataModel for the data.`,
    "It renders about 600px wide, in light or dark mode. Make every control work with the catalog's data bindings, functions and actions.",
    "Output only the messages: no explanation and no Markdown fences.",
    "",
    "MESSAGES (JSON Schema)",
    compact(join(dir, "server_to_client.json")),
    "",
    "COMMON TYPES (JSON Schema)",
    compact(join(dir, "common_types.json")),
    "",
    "BASIC CATALOG (JSON Schema)",
    compact(join(dir, "catalogs", "basic", "catalog.json")),
    "",
    "EXAMPLES",
    ...EXAMPLES.map(example),
  ].join("\n");
}
