# Vue

`sayshape/vue` is a Vue 3 component (Vue 3.3 or newer, an optional peer dependency). It is written with `defineComponent` and `h()`, so it needs no `.vue` compiler of its own.

```bash
npm install sayshape vue
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { SayShape } from "sayshape/vue";

const spec = ref(`state days=2
card
  text "Yosemite weekend" style=title
  stat label="Days" value={days}
  button "Add day" on=inc:days
  button "Book" on=emit:book`);

function onAction(e: { name: string; value: unknown }) {
  console.log(e.name, e.value);
}
</script>

<template>
  <SayShape :spec="spec" theme="auto" @action="onAction" />
</template>
```

`SayShape` is also the default export. See [`examples/vue`](../../examples/vue).

## Props

| Prop | Type | Notes |
|---|---|---|
| `spec` | `string` | The spec text. Changing it keeps the state unless `resetStateOnChange` is set; the same string does nothing. |
| `streaming` | `boolean` | Treat `spec` as text that is still growing. |
| `theme` | `"auto" \| "light" \| "dark" \| Theme` | Changing it calls `setTheme`; the engine is not recreated. |
| `resetStateOnChange` | `boolean` | Start from the spec's own state each time `spec` changes. |
| `options` | engine options | `animate`, `imageHosts`, `minHeight`, and so on (everything but `components` and `theme`). |
| `components` | `ComponentDef[]` | Default: the core components. |

`options` and `components` are read once, when the component mounts. Changing them later does nothing: give the component a new `key` to remount it.

The canvas fills the width of its container, and the engine tracks resizing. Attributes you add (`class`, `style`) go to the wrapping `<div>`.

## Events

The component emits `action`, `change`, `diagnostics`, `navigate`, `notify` and `render`, each with the engine event's payload.

| Event | Payload |
|---|---|
| `action` | `{ name, value, node }`: an `emit:` action ran |
| `change` | `{ key, value }` |
| `diagnostics` | the list of diagnostics, when it changes |
| `navigate` | `{ screen, from }` |
| `notify` | `{ text }` |
| `render` | the frame's metrics |

## Streaming

```vue
<SayShape :spec="text" :streaming="loading" />
```

While `streaming` is true the component calls `beginStream()` once and `push()`es only the characters added to `spec`. When `streaming` becomes false it calls `endStream()`. If `spec` shrinks or stops being an extension of what was streamed, the stream starts again.

## The engine

The component exposes its engine to a template ref. Because it is written with `defineComponent` and `setup()` rather than a `<script setup>` block, it uses the `expose()` function from the setup context, which does the same job as `defineExpose`.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { SayShape } from "sayshape/vue";
import type { SayShape as Engine } from "sayshape";

const view = ref<{ engine: Engine | null } | null>(null);
const copy = () => navigator.clipboard.writeText(view.value?.engine?.copyText() ?? "");
</script>

<template>
  <SayShape ref="view" spec='text "Hello"' />
  <button @click="copy">Copy</button>
</template>
```

`engine` is `null` until the component has mounted. Vue does not know what `expose()` adds, so type the ref as above.

## Lifecycle

The engine is created in `onMounted` and destroyed in `onBeforeUnmount`, which unsubscribes every listener and removes the canvas. Nothing is drawn on the server: the component renders an empty `<div>` and a `<canvas>`, and the engine starts in the browser.
