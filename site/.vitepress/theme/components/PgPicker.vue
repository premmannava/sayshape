<script setup lang="ts">
/**
 * The playground's own dropdown: a button that opens a list in the site's
 * style, where a native <select> would open the operating system's. Long
 * lists (`search`) get a box that filters as you type. The parent decides
 * whether a pick takes effect, so it can ask before throwing edits away.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";

export interface PickerItem { value: string; label: string }
export interface PickerGroup { label?: string; items: PickerItem[] }

const props = defineProps<{
  modelValue: string;
  groups: PickerGroup[];
  /** What the control is for, read by screen readers. */
  label: string;
  /** Shown on the button when the value isn't one of the items. */
  placeholder?: string;
  search?: boolean;
  small?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const id = useId();
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const popup = ref<HTMLElement | null>(null);
const field = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref("");
const active = ref("");
const place = ref<Record<string, string>>({});

const all = computed(() => props.groups.flatMap((g) => g.items));
const current = computed(() => all.value.find((i) => i.value === props.modelValue));
const shown = computed<PickerGroup[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.groups;
  return props.groups
    .map((g) => ({ label: g.label, items: g.label?.toLowerCase().includes(q) ? g.items : g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);
});
const flat = computed(() => shown.value.flatMap((g) => g.items));
const optionId = (value: string) => `${id}-${value.replace(/[^\w-]/g, "_")}`;

/** Under the button, kept on screen; position: fixed, so a pane's overflow: hidden doesn't cut it off. */
function position() {
  const b = button.value?.getBoundingClientRect();
  if (!b) return;
  const below = window.innerHeight - b.bottom - 14;
  const above = b.top - 14;
  const up = below < 220 && above > below;
  const width = Math.max(b.width, popup.value?.offsetWidth ?? 0);
  place.value = {
    left: `${Math.max(8, Math.min(b.left, window.innerWidth - width - 8))}px`,
    minWidth: `${b.width}px`,
    maxHeight: `${Math.min(420, Math.max(160, up ? above : below))}px`,
    ...(up ? { bottom: `${window.innerHeight - b.top + 6}px` } : { top: `${b.bottom + 6}px` }),
  };
}

function show() {
  if (open.value) return;
  query.value = "";
  active.value = current.value?.value ?? all.value[0]?.value ?? "";
  open.value = true;
  position();
  void nextTick(() => {
    position();
    field.value?.focus();
    reveal();
  });
  document.addEventListener("pointerdown", onOutside);
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", onScroll, true);
}
function hide() {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("resize", hide);
  window.removeEventListener("scroll", onScroll, true);
}
function close(refocus: boolean) {
  hide();
  if (refocus) button.value?.focus();
}
const onOutside = (e: PointerEvent) => { if (!root.value?.contains(e.target as Node)) hide(); };
// The page scrolling moves the button out from under the list; scrolling the list itself is fine.
const onScroll = (e: Event) => { if (!popup.value?.contains(e.target as Node)) hide(); };
function onFocusOut(e: FocusEvent) {
  const next = e.relatedTarget as Node | null;
  if (next && !root.value?.contains(next)) hide();
}
onBeforeUnmount(hide);

function pick(value: string) {
  close(true);
  if (value !== props.modelValue) emit("update:modelValue", value);
}

function reveal() {
  popup.value?.querySelector(`#${CSS.escape(optionId(active.value))}`)?.scrollIntoView({ block: "nearest" });
}
function move(to: number) {
  const items = flat.value;
  if (!items.length) return;
  active.value = items[Math.max(0, Math.min(items.length - 1, to))]!.value;
  void nextTick(reveal);
}
watch(query, () => { active.value = flat.value[0]?.value ?? ""; });

function onKeydown(e: KeyboardEvent) {
  const at = flat.value.findIndex((i) => i.value === active.value);
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
  else if (e.key === "ArrowDown") { e.preventDefault(); move(at + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); move(at - 1); }
  else if (e.key === "Home" && !props.search) { e.preventDefault(); move(0); }
  else if (e.key === "End" && !props.search) { e.preventDefault(); move(flat.value.length - 1); }
  else if (e.key === "Enter" || (e.key === " " && !props.search)) { e.preventDefault(); if (active.value) pick(active.value); }
  else if (!props.search && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    // A letter jumps to the next item that starts with it, as a native list does.
    const items = flat.value;
    const next = [...items.slice(at + 1), ...items.slice(0, at + 1)].find((i) => i.label.toLowerCase().startsWith(e.key.toLowerCase()));
    if (next) { active.value = next.value; void nextTick(reveal); }
  }
}
function onButtonKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); }
}
</script>

<template>
  <div ref="root" class="pk" :class="{ small }" @focusout="onFocusOut">
    <button ref="button" class="pk-button" type="button" aria-haspopup="listbox" :aria-expanded="open" :aria-label="`${label}: ${current?.label ?? placeholder ?? ''}`" @click="open ? close(false) : show()" @keydown="onButtonKeydown">
      <span class="pk-value">{{ current?.label ?? placeholder }}</span>
      <span class="pk-caret" aria-hidden="true"></span>
    </button>
    <div v-if="open" ref="popup" class="pk-popup" :style="place" @keydown="onKeydown">
      <input
        v-if="search"
        ref="field"
        v-model="query"
        class="pk-search"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="Search"
        :aria-label="`Search: ${label}`"
        :aria-controls="`${id}-list`"
        :aria-activedescendant="active ? optionId(active) : undefined"
      >
      <div
        :id="`${id}-list`"
        :ref="(el) => { if (!search) field = el as HTMLElement | null }"
        class="pk-list"
        role="listbox"
        :tabindex="search ? undefined : -1"
        :aria-label="label"
        :aria-activedescendant="!search && active ? optionId(active) : undefined"
      >
        <div v-for="(g, gi) in shown" :key="g.label ?? gi" role="group" :aria-label="g.label">
          <div v-if="g.label" class="pk-group" aria-hidden="true">{{ g.label }}</div>
          <div
            v-for="i in g.items"
            :id="optionId(i.value)"
            :key="i.value"
            class="pk-option"
            role="option"
            :class="{ active: i.value === active }"
            :aria-selected="i.value === modelValue"
            @pointermove="active = i.value"
            @click="pick(i.value)"
          >
            <span>{{ i.label }}</span>
          </div>
        </div>
        <p v-if="!flat.length" class="pk-none">Nothing matches “{{ query.trim() }}”.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pk { position: relative; display: inline-flex; min-width: 0 }
.pk-button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 14px;
  border: 1.5px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--ss-card);
  color: var(--vp-c-text-1);
  font: 500 14px var(--vp-font-family-base);
  cursor: pointer;
  transition: border-color 0.15s;
}
.pk-button:hover, .pk-button[aria-expanded="true"] { border-color: var(--vp-c-text-3) }
.pk-button:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 2px }
.pk.small .pk-button { height: 30px; padding: 0 12px; font-size: 13px }
.pk-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pk-caret { flex: none; width: 7px; height: 7px; margin-top: -4px; border: solid var(--vp-c-text-2); border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); transition: transform 0.15s, margin 0.15s }
.pk-button[aria-expanded="true"] .pk-caret { transform: rotate(225deg); margin-top: 4px }

.pk-popup {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: max-content;
  max-width: min(340px, calc(100vw - 16px));
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  background: var(--ss-card);
  box-shadow: var(--ss-lift-sm);
  overflow: hidden;
}
.pk-search {
  flex: none;
  box-sizing: border-box;
  width: calc(100% - 12px);
  height: 36px;
  margin: 6px 6px 0;
  padding: 0 12px;
  border: 1.5px solid var(--vp-c-divider);
  border-radius: 9px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  /* 16px: smaller text makes iOS zoom the page when the box is focused. */
  font: 16px var(--vp-font-family-base);
}
.pk-search:focus { outline: none; border-color: var(--vp-c-brand-1) }
.pk-list { overflow-y: auto; overscroll-behavior: contain; padding: 6px; outline: none }
.pk-group { padding: 10px 10px 4px; font: 500 10.5px var(--vp-font-family-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--vp-c-text-3) }
.pk-list > div:first-child .pk-group { padding-top: 4px }
.pk-option { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 34px; padding: 0 10px; border-radius: 9px; font: 500 14px var(--vp-font-family-base); color: var(--vp-c-text-1); cursor: pointer; white-space: nowrap }
.pk-option.active { background: color-mix(in srgb, var(--vp-c-text-1) 7%, transparent) }
.pk-option[aria-selected="true"] { color: var(--vp-c-brand-1); font-weight: 600 }
.pk-option[aria-selected="true"]::after { content: ""; flex: none; width: 5px; height: 10px; margin: -3px 4px 0 0; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(45deg) }
.pk-none { margin: 0; padding: 10px; font-size: 13.5px; color: var(--vp-c-text-2) }
.pk-list:focus-visible .pk-option.active { outline: 2px solid var(--vp-c-brand-1); outline-offset: -2px }

@media (max-width: 900px) {
  .pk-option { min-height: 40px }
}
</style>
