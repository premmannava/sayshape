/**
 * The engine as one classic script for the widget file (widget-file.ts): the
 * same exports as ../../src/browser.ts, which is what the page for text-only
 * chat apps loads from a CDN, and so the slide elements too (deck, slide are
 * in coreComponents). The CDN page loads an older pinned build that has no
 * slides; this file carries the server's own. Built when this package is built (scripts/pack-widget-engine.mjs)
 * and shipped inside it, so it always matches the server that checked the spec.
 * The map's outlines stay in their own script, as in the CDN build.
 */
export * from "../../src/browser";
