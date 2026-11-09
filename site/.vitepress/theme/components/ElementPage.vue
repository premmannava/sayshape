<script setup lang="ts">
/**
 * One element's interactive page, generated for every ComponentDef: the live
 * example (editable), controls for its props that rewrite the spec line, a
 * "try a typo" button that shows a real diagnostic, the props, and the exact
 * guide entry a model gets. All content comes from site/.generated/elements.json.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { withBase } from "vitepress";
import data from "../../../.generated/elements.json";
import { useSayShape } from "../sayshape/useSayShape";
import { toBase64Url, usesMap } from "../sayshape/runtime";
import { onHostEvents, type HostEvent } from "../sayshape/events";
import { editLine, findElementLine, readProp, readText, TYPO, writeProp, writeText } from "../sayshape/specEdit";
import type { Diagnostic } from "@sayshape/index";

type Element = (typeof data.elements)[number];
type Prop = Element["props"][number];

const props = defineProps<{ type: string }>();
const el = computed(() => data.elements.find((e) => e.type === props.type) as Element);
const category = computed(() => data.categories.find((c) => c.id === el.value.category)!);
const siblings = computed(() => data.elements.filter((e) => e.category === el.value.category && e.type !== el.value.type));
const href = (type: string) => withBase(`/docs/elements/${type}.html`);

const spec = ref(el.value.example);
const typo = ref(false);
const lineIndex = computed(() => findElementLine(spec.value, props.type));
const line = computed(() => spec.value.split("\n")[lineIndex.value] ?? "");

/** Props a control can set directly; the rest (state names, actions, expressions) are shown in the spec. */
const tweakable = computed(() => el.value.props.filter((p) => ["number", "enum", "boolean", "string"].includes(p.type) && p.name !== "bind"));
const bindsState = computed(() => el.value.props.some((p) => p.name === "bind" && p.type === "state"));

function current(p: Prop): string | null { return readProp(line.value, p.name); }
function setProp(name: string, value: string | number | boolean | null) {
  spec.value = editLine(spec.value, lineIndex.value, (l) => writeProp(l, name, value));
}
function nudge(p: Prop, by: number) {
  const now = Number(current(p) ?? p.default ?? 0);
  // No clamping: a value the element can't use shows up as the parser's own diagnostic.
  setProp(p.name, Number.isFinite(now) ? now + by : by);
}
const text = computed(() => readText(line.value, props.type));
function setText(v: string) { spec.value = editLine(spec.value, lineIndex.value, (l) => writeText(l, props.type, v)); }
function toggleTypo() {
  typo.value = !typo.value;
  setProp(TYPO.name, typo.value ? TYPO.value : null);
}
function reset() {
  spec.value = el.value.example;
  typo.value = false;
  sayshape.value?.setSpec(spec.value, { resetState: true });
}

const canvas = ref<HTMLCanvasElement | null>(null);
const root = ref<HTMLElement | null>(null);
const problems = shallowRef<Diagnostic[]>([]);
const events = ref<HostEvent[]>([]);
const stateView = ref<Array<[string, string]>>([]);

function readState() {
  const s = sayshape.value?.state.snapshot() ?? {};
  stateView.value = Object.entries(s).slice(0, 6).map(([k, v]) => [k, JSON.stringify(v).slice(0, 60)]);
}

const { sayshape, failed } = useSayShape(canvas, (l) => {
  const offDiag = l.on("diagnostics", (d) => { problems.value = d; });
  const offEvents = onHostEvents(l, (e) => { events.value = [e, ...events.value].slice(0, 3); });
  const offState = l.on("change", readState);
  l.setSpec(spec.value);
  l.renderNow();
  problems.value = l.diagnostics;
  readState();
  return () => { offDiag(); offEvents(); offState(); };
}, { lazy: root, map: usesMap(el.value.example), today: "2026-10-21" });

watch(spec, (s) => { sayshape.value?.setSpec(s); readState(); });

/** Room for every line as it wraps at about 56 characters, so the whole spec shows without scrolling. */
const rows = computed(() => Math.min(18, spec.value.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 56)), 0) + 1));
const playgroundHref = computed(() => withBase("/playground.html") + "#spec=" + toBase64Url(spec.value));
const copied = ref("");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(what: "spec" | "guide") {
  try {
    await navigator.clipboard.writeText(what === "spec" ? spec.value : el.value.guide);
    copied.value = what;
  } catch {
    copied.value = "failed";
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = ""; }, 1800);
}
onBeforeUnmount(() => clearTimeout(copyTimer));

const typeLabel = (p: Prop) => (p.type === "enum" && p.values ? p.values.join(" · ") : p.type);
const defaultLabel = (p: Prop) => (p.required ? "required" : p.default === null ? "—" : String(p.default));
</script>

<template>
  <div ref="root" class="ep">
    <header class="ep-head">
      <a class="ss-eyebrow ep-crumb" :href="withBase('/docs/elements/')">Elements / {{ category.title }}</a>
      <div class="ep-titlerow">
        <h1 class="ep-name">{{ el.type }}</h1>
        <span v-if="bindsState" class="ep-pill">binds state</span>
        <span v-if="el.parents" class="ep-pill quiet">inside {{ el.parents.join(", ") }}</span>
      </div>
      <p class="ep-desc">{{ el.description }}</p>
    </header>

    <section class="ep-live ss-card" aria-label="Live example">
      <div class="ep-split">
        <div class="ep-code">
          <div class="ep-bar">
            <span class="ss-eyebrow">Spec · edit me</span>
            <span class="ep-bar-actions">
              <button type="button" class="sayshape-btn-text" @click="copy('spec')">{{ copied === "spec" ? "Copied" : "Copy" }}</button>
              <button type="button" class="sayshape-btn-text" @click="reset">Reset</button>
            </span>
          </div>
          <label class="sr-only" :for="`spec-${el.type}`">Spec for the {{ el.type }} example</label>
          <textarea :id="`spec-${el.type}`" v-model="spec" class="ep-textarea" spellcheck="false" :rows="rows"></textarea>
          <ul v-if="problems.length" class="ep-problems" aria-live="polite" aria-label="Problems the parser reported">
            <li v-for="d in problems" :key="d.line + d.message" :class="d.severity"><span class="ln">Line {{ d.line }}</span>{{ d.message }}</li>
          </ul>
          <p v-else class="ep-ok">No problems. The parser accepted every line.</p>
        </div>
        <div class="ep-result">
          <div class="ep-bar"><span class="ss-eyebrow">Result · try it</span><a class="sayshape-btn-text" :href="playgroundHref">Open in playground</a></div>
          <div class="sayshape-stage">
            <!-- Examples that load a photo point at a file this site doesn't ship, so they aren't drawn here. -->
            <div v-if="el.live" class="sayshape-canvas-wrap"><canvas ref="canvas" :aria-label="`Live ${el.type} example, drawn on a canvas`"></canvas></div>
            <p v-else class="ep-note">This example loads a photo from your app's own site, so it isn't drawn here. In your app, images load from your origin and the hosts you allow.</p>
            <p v-if="failed" class="sayshape-live__failed">The preview couldn't start: {{ failed }}</p>
          </div>
          <dl v-if="stateView.length" class="ep-state" aria-label="State right now">
            <div v-for="[k, v] in stateView" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></div>
          </dl>
          <ol v-if="events.length" class="sayshape-events" aria-live="polite" aria-label="Events sent to the page">
            <li v-for="e in events" :key="e.id"><code>{{ e.text }}</code></li>
          </ol>
        </div>
      </div>

      <div class="ep-tweak">
        <span class="ss-eyebrow">Tweak the props</span>
        <label v-if="el.text && text !== null" class="ep-ctl">
          <span>"text"</span>
          <input :value="text" type="text" maxlength="40" @input="setText(($event.target as HTMLInputElement).value)">
        </label>
        <template v-for="p in tweakable" :key="p.name">
          <div v-if="p.type === 'enum' && p.values" class="ep-ctl" role="group" :aria-label="p.name">
            <span>{{ p.name }}</span>
            <div class="ep-seg">
              <button v-for="v in p.values" :key="v" type="button" :aria-pressed="(current(p) ?? p.default) === v" @click="setProp(p.name, v)">{{ v }}</button>
            </div>
          </div>
          <div v-else-if="p.type === 'number'" class="ep-ctl" role="group" :aria-label="p.name">
            <span>{{ p.name }}</span>
            <div class="ep-num">
              <button type="button" :aria-label="`Lower ${p.name}`" @click="nudge(p, -1)">−</button>
              <output>{{ current(p) ?? (p.default ?? "—") }}</output>
              <button type="button" :aria-label="`Raise ${p.name}`" @click="nudge(p, 1)">+</button>
            </div>
          </div>
          <div v-else-if="p.type === 'boolean'" class="ep-ctl" role="group" :aria-label="p.name">
            <span>{{ p.name }}</span>
            <div class="ep-seg">
              <button v-for="v in ['true', 'false']" :key="v" type="button" :aria-pressed="(current(p) ?? String(p.default ?? false)) === v" @click="setProp(p.name, v === 'true')">{{ v }}</button>
            </div>
          </div>
          <label v-else-if="p.type === 'string' && !(current(p) ?? '').startsWith('{')" class="ep-ctl">
            <span>{{ p.name }}</span>
            <input :value="current(p) ?? ''" type="text" maxlength="40" :placeholder="p.default === null ? 'not set' : String(p.default)" @input="setProp(p.name, ($event.target as HTMLInputElement).value || null)">
          </label>
        </template>
        <button type="button" class="ep-typo" :aria-pressed="typo" @click="toggleTypo">{{ typo ? "Fix the typo" : "Try a typo" }}</button>
      </div>
    </section>

    <div class="ep-cols">
      <section class="ep-props" aria-labelledby="props-h">
        <h2 id="props-h">Props</h2>
        <div class="ep-rows">
          <div v-if="el.text" class="ep-row">
            <code class="nm">"text"</code><span class="ty">text</span><span class="ds">{{ el.text.description }}</span><span class="df" :class="{ req: el.text.required }">{{ el.text.required ? "required" : "optional" }}</span>
          </div>
          <div v-for="p in el.props" :key="p.name" class="ep-row">
            <code class="nm">{{ p.name }}</code><span class="ty">{{ typeLabel(p) }}</span><span class="ds">{{ p.description }}</span><span class="df" :class="{ req: p.required }">{{ defaultLabel(p) }}</span>
          </div>
          <div v-for="c in data.common" :key="c.name" class="ep-row muted">
            <code class="nm">{{ c.name }}</code><span class="ty">{{ c.type }}</span><span class="ds">{{ c.description }} Every element takes it.</span><span class="df">—</span>
          </div>
        </div>
        <p v-if="el.children && el.children !== 'any'" class="ep-rel">Children:
          <a v-for="c in el.children" :key="c" :href="href(c)"><code>{{ c }}</code></a>
        </p>
        <p v-else-if="el.children === 'any'" class="ep-rel">Children: any elements.</p>
        <p v-if="el.parents" class="ep-rel">Only inside:
          <template v-for="c in el.parents" :key="c"><a v-if="c !== 'root'" :href="href(c)"><code>{{ c }}</code></a><code v-else>the top level</code></template>
        </p>
      </section>

      <aside class="ep-aside" aria-label="More">
        <div class="ep-model">
          <strong>For your model</strong>
          <p>The exact guide entry a model gets for <code>{{ el.type }}</code>, generated from the same definition.</p>
          <pre class="ep-guide" tabindex="0">{{ el.guide }}</pre>
          <button type="button" class="sayshape-btn primary small" @click="copy('guide')">{{ copied === "guide" ? "Copied" : "Copy guide entry" }}</button>
        </div>
        <div class="ep-more">
          <span class="ss-eyebrow">More {{ category.title.toLowerCase() }}</span>
          <div class="ep-chips"><a v-for="s in siblings" :key="s.type" :href="href(s.type)">{{ s.type }}</a></div>
          <a class="ep-ref" :href="withBase(`/docs/components/${el.category}.html#${el.type}`)">All {{ category.title.toLowerCase() }} elements on one page →</a>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ep { max-width: var(--ss-content); margin: 0 auto; padding: var(--ss-page-top) var(--ss-gutter) var(--ss-page-bottom); display: grid; gap: 32px }
.ep-head { display: grid; gap: 12px }
.ep-crumb { text-decoration: none }
.ep-titlerow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px }
.ep-name { margin: 0; font: 500 clamp(44px, 7vw, 72px)/1 var(--vp-font-family-mono); letter-spacing: -0.04em; color: var(--vp-c-text-1) }
.ep-pill { font-size: 13px; font-weight: 600; border: 1.5px solid var(--ss-rule); border-radius: 999px; padding: 4px 12px }
.ep-pill.quiet { border-color: var(--vp-c-divider); color: var(--vp-c-text-2); font-weight: 500 }
.ep-desc { margin: 0; max-width: 60ch; font-size: 20px; line-height: 1.5; color: var(--vp-c-text-2); text-wrap: pretty }

.ep-live { overflow: hidden }
.ep-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) }
.ep-code { border-right: 1px solid var(--vp-c-divider); display: flex; flex-direction: column; min-width: 0 }
.ep-result { display: flex; flex-direction: column; min-width: 0 }
.ep-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px 10px }
.ep-bar-actions { display: inline-flex; gap: 16px }
.ep-textarea {
  field-sizing: content; max-height: 520px;
  margin: 0 18px; padding: 12px 14px; resize: vertical; min-height: 120px;
  font: 14px/1.75 var(--vp-font-family-mono); color: var(--vp-c-text-1);
  background: var(--vp-c-bg); border: 1.5px solid var(--vp-c-divider); border-radius: 10px; tab-size: 2;
}
.ep-textarea:focus { outline: 2px solid var(--vp-c-brand-1); outline-offset: 1px; border-color: transparent }
.ep-problems { list-style: none; margin: 12px 18px 18px; padding: 10px 12px; border-radius: 10px; background: var(--ss-mark-soft); font-size: 14px; line-height: 1.5; display: grid; gap: 4px }
.ep-problems .ln { font: 500 12px var(--vp-font-family-mono); margin-right: 10px; color: var(--sayshape-warn) }
.ep-problems .error .ln { color: var(--sayshape-bad) }
.ep-ok { margin: 12px 18px 18px; font-size: 13px; color: var(--vp-c-text-3) }
.ep-result .sayshape-stage { flex: 1; min-height: 160px }
.ep-note { margin: 10px 0 0; font-size: 13px; color: var(--vp-c-text-2) }
.ep-state { margin: 0; padding: 10px 18px 14px; display: flex; flex-wrap: wrap; gap: 6px 18px; font: 12px var(--vp-font-family-mono); border-top: 1px solid var(--vp-c-divider) }
.ep-state div { display: flex; gap: 6px; min-width: 0 }
.ep-state dt { color: var(--vp-c-text-3) }
.ep-state dd { margin: 0; color: var(--vp-c-brand-1); overflow-wrap: anywhere }

.ep-tweak { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 22px; padding: 16px 18px 18px; border-top: 1px solid var(--vp-c-divider) }
.ep-tweak > .ss-eyebrow { align-self: center; flex-basis: 100% }
.ep-ctl { display: grid; gap: 6px; font: 500 12px var(--vp-font-family-mono); color: var(--vp-c-text-3) }
.ep-ctl input { width: 160px; height: 36px; padding: 0 10px; font: 14px var(--vp-font-family-base); color: var(--vp-c-text-1); background: var(--vp-c-bg); border: 1.5px solid var(--vp-c-divider); border-radius: 8px }
.ep-seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border: 1.5px solid var(--vp-c-divider); border-radius: 9px }
.ep-seg button { height: 32px; padding: 0 10px; border-radius: 7px; font: 13px var(--vp-font-family-mono); color: var(--vp-c-text-1) }
.ep-seg button[aria-pressed="true"] { background: var(--vp-c-text-1); color: var(--ss-on-ink) }
.ep-num { display: flex; align-items: center; border: 1.5px solid var(--vp-c-divider); border-radius: 9px }
.ep-num button { width: 36px; height: 34px; font-size: 16px; color: var(--vp-c-text-1) }
.ep-num output { min-width: 40px; text-align: center; font: 14px var(--vp-font-family-mono); color: var(--vp-c-text-1) }
.ep-typo { margin-left: auto; height: 38px; padding: 0 16px; border: 1.5px dashed var(--sayshape-warn); border-radius: 999px; font-weight: 600; font-size: 14px; color: var(--vp-c-text-1) }
.ep-typo[aria-pressed="true"] { background: var(--ss-mark-soft) }

.ep-cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 40px; align-items: start }
.ep-props h2 { margin: 0 0 4px; font: 600 30px/1.1 var(--sayshape-display); letter-spacing: -0.03em }
.ep-rows { border-top: 1px solid var(--vp-c-divider); margin-top: 12px }
.ep-row { display: grid; grid-template-columns: 120px 150px minmax(0, 1fr) 90px; gap: 16px; align-items: baseline; padding: 13px 0; border-bottom: 1px solid var(--vp-c-divider) }
.ep-row .nm { font-size: 15px; font-weight: 500; color: var(--vp-c-brand-1); background: none; padding: 0 }
.ep-row .ty { font: 12px/1.5 var(--vp-font-family-mono); color: var(--vp-c-text-3); overflow-wrap: anywhere }
.ep-row .ds { font-size: 15px; line-height: 1.5; color: var(--vp-c-text-2) }
.ep-row .df { font: 12px var(--vp-font-family-mono); color: var(--vp-c-text-3); text-align: right }
.ep-row .df.req { color: var(--sayshape-warn); font-weight: 500 }
.ep-row.muted { opacity: 0.7 }
.ep-rel { margin: 16px 0 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; color: var(--vp-c-text-2) }
.ep-rel a { text-decoration: none }

.ep-aside { display: grid; gap: 20px; position: sticky; top: calc(var(--vp-nav-height) + 24px) }
.ep-model { display: grid; gap: 10px; padding: 18px; border: 1.5px solid var(--vp-c-divider); border-radius: 14px; background: var(--ss-card) }
.ep-model p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2) }
.ep-guide { margin: 0; max-height: 180px; overflow: auto; padding: 10px 12px; font: 12px/1.6 var(--vp-font-family-mono); white-space: pre-wrap; background: var(--vp-c-bg); border-radius: 8px; color: var(--vp-c-text-2) }
.ep-more { display: grid; gap: 10px }
.ep-chips { display: flex; flex-wrap: wrap; gap: 6px }
.ep-chips a { font: 13px var(--vp-font-family-mono); text-decoration: none; color: var(--vp-c-text-1); border: 1.5px solid var(--vp-c-divider); border-radius: 999px; padding: 4px 10px }
.ep-chips a:hover { border-color: var(--ss-rule) }
.ep-ref { font-size: 14px; font-weight: 600 }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }

@media (max-width: 960px) {
  .ep-split, .ep-cols { grid-template-columns: 1fr }
  .ep-code { border-right: 0; border-bottom: 1px solid var(--vp-c-divider) }
  .ep-aside { position: static }
  .ep-row { grid-template-columns: 1fr auto; gap: 4px 12px }
  .ep-row .ty { grid-column: 1 / -1; order: 3 }
  .ep-row .ds { grid-column: 1 / -1; order: 4 }
  .ep-typo { margin-left: 0 }
}
</style>
