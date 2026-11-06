/**
 * A2UI answers on a Screen, like SayShape and HTML (screens.ts): the model's
 * messages go through A2UI's own MessageProcessor and are drawn by Google's
 * own Lit renderer (@a2ui/lit, basic catalog), in jsdom. Text, typing and
 * pressing walk into the renderer's shadow roots, so the same task checks run
 * on all three formats.
 *
 * Lit registers its elements on the global customElements once per process,
 * so one jsdom window is set up the first time and every screen gets a fresh
 * container in it.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import type { Screen } from "./screens";

type Core = typeof import("@a2ui/web_core/v0_9");
type Lit = typeof import("@a2ui/lit/v0_9");

let env: { dom: JSDOM; core: Core; lit: Lit; errors: string[] } | null = null;

const GLOBALS = [
  "window", "document", "navigator", "HTMLElement", "Element", "Node", "Text", "Document", "DocumentFragment", "ShadowRoot",
  "customElements", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent", "MutationObserver",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CSSStyleSheet", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLButtonElement", "HTMLSelectElement", "HTMLTemplateElement", "NodeFilter", "TreeWalker", "Range", "DOMParser", "HTMLSlotElement",
] as const;

async function setup() {
  if (env) return env;
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e: Error) => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errors.push(e.message); });
  vc.on("error", (...a: unknown[]) => errors.push(a.map(String).join(" ")));
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true, virtualConsole: vc, url: "https://bench.invalid/" });
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of GLOBALS) if (w[k] !== undefined) {
    try { g[k] = k === "getComputedStyle" || k === "requestAnimationFrame" || k === "cancelAnimationFrame" ? (w[k] as (...a: unknown[]) => unknown).bind(w) : w[k]; }
    catch { Object.defineProperty(g, k, { value: w[k], configurable: true, writable: true }); }
  }
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  (w as Record<string, unknown>).matchMedia ??= g.matchMedia;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  (w as Record<string, unknown>).ResizeObserver ??= g.ResizeObserver;
  const core = await import("@a2ui/web_core/v0_9");
  const lit = await import("@a2ui/lit/v0_9");
  // Set up the way A2UI's own renderers are: its styles and its Markdown renderer for Text.
  try { core.injectBasicCatalogStyles(dom.window.document); } catch { /* styles don't change text or behavior */ }
  const md = await import("@a2ui/markdown-it");
  core.setMarkdownRenderer(md.renderMarkdown);
  env = { dom, core, lit, errors };
  return env;
}

/** The complete top-level JSON objects in a reply, in order, whatever lines or fences surround them (as the site does). */
export function completeObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && depth > 0) { if (--depth === 0) out.push(text.slice(start, i + 1)); }
  }
  return out;
}

/** The A2UI messages in a reply: thinking removed, one JSON object per message. */
export function cleanA2ui(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "");
  return completeObjects(text).join("\n");
}

const pause = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Every element under root, through open shadow roots, in document order. */
function* deep(root: Node): Generator<Element> {
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i]!;
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    yield el;
    if (el.shadowRoot) yield* deep(el.shadowRoot);
    yield* deep(el);
  }
}

export async function a2uiScreen(code: string): Promise<Screen> {
  const { dom, core, lit, errors: shared } = await setup();
  const w = dom.window, d = w.document;
  const startErrors = shared.length;
  const errors: string[] = [];
  const processor = new core.MessageProcessor([lit.basicCatalog]);
  let surface: unknown = null;
  processor.onSurfaceCreated((s: unknown) => { surface ??= s; });
  const messages = completeObjects(code);
  if (!messages.length) errors.push("no A2UI messages");
  messages.forEach((m, i) => {
    try { processor.processMessages(JSON.parse(m)); }
    catch (e) { errors.push(`message ${i + 1}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
  });
  const host = d.createElement("div");
  d.body.appendChild(host);
  if (surface) {
    const el = d.createElement("a2ui-surface") as HTMLElement & { surface: unknown };
    el.surface = surface;
    host.appendChild(el);
  } else if (messages.length) errors.push("no surface was created");
  await settle();

  async function settle() {
    for (let i = 0; i < 6; i++) {
      await pause(15);
      const pending = [...deep(host)].map((e) => (e as unknown as { updateComplete?: Promise<unknown> }).updateComplete).filter(Boolean);
      await Promise.all(pending);
    }
  }

  const shown = (el: Element) => !(el.hasAttribute("hidden") || w.getComputedStyle(el).display === "none");

  const text = (): string[] => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) { const t = n.textContent?.trim(); if (t) out.push(t); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      if (n.nodeType === 1) {
        const el = n as Element;
        if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName) || !shown(el)) return;
        if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && (el as HTMLInputElement).value && !/^(checkbox|radio|range)$/.test((el as HTMLInputElement).type)) out.push((el as HTMLInputElement).value);
        if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "range") out.push((el as HTMLInputElement).value);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
      n.childNodes.forEach(walk);
    };
    walk(host);
    return out;
  };

  const labelOf = (el: Element): string[] => {
    const own = (n: Node): string => n.nodeType === 3 ? n.textContent ?? "" : n.nodeType === 1 ? [...((n as Element).shadowRoot?.childNodes ?? []), ...n.childNodes].map(own).join(" ") : n.nodeType === 11 ? [...n.childNodes].map(own).join(" ") : "";
    return [own(el), el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? "", (el as HTMLInputElement).value ?? ""]
      .map((t) => String(t).replace(/\s+/g, " ").trim()).filter(Boolean);
  };

  return {
    get errors() { return [...errors, ...shared.slice(startErrors)]; },
    text,
    async type(nth, value) {
      const fields = [...deep(host)].filter((e) => (e.tagName === "INPUT" && /^(text|search|email|number|)$/.test((e as HTMLInputElement).type)) || e.tagName === "TEXTAREA") as HTMLInputElement[];
      const f = fields[nth];
      if (!f) return false;
      f.focus();
      f.value = value;
      for (const ev of ["input", "keyup", "change"]) f.dispatchEvent(new w.Event(ev, { bubbles: true, composed: true }));
      await settle();
      return true;
    },
    async press(label) {
      const pressable = [...deep(host)].filter((e) => e.matches("button, [role=button], [role=tab], [role=radio], [role=option], [role=switch], a, label, input[type=checkbox], input[type=radio]") && !(e as HTMLButtonElement).disabled);
      const matching = pressable.filter((e) => labelOf(e).some((l) => label.test(l)));
      const best = matching.sort((a, b) => (labelOf(a)[0]?.length ?? 0) - (labelOf(b)[0]?.length ?? 0))[0] as HTMLElement | undefined;
      if (best) { best.click(); await settle(); return true; }
      // A choice picker drawn as a native select: choose the matching option.
      for (const sel of [...deep(host)].filter((e) => e.tagName === "SELECT") as HTMLSelectElement[]) {
        const opt = [...sel.options].find((o) => label.test(o.textContent?.replace(/\s+/g, " ").trim() ?? ""));
        if (!opt || sel.disabled) continue;
        sel.value = opt.value;
        for (const ev of ["input", "change"]) sel.dispatchEvent(new w.Event(ev, { bubbles: true, composed: true }));
        await settle();
        return true;
      }
      return false;
    },
    injected: () => [...deep(host)].some((e) => e.matches("[onerror], [onload], img[src='x']")),
    destroy() { try { processor.dispose(); } catch { /* already gone */ } host.remove(); },
  };
}
