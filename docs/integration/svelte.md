# Svelte

`sayshape/svelte` is a Svelte action: `use:sayshape`. It is plain JavaScript, so it needs no Svelte compiler in the library, and it works in Svelte 4 and Svelte 5. `svelte` is an optional peer dependency (the action imports nothing from it).

```bash
npm install sayshape svelte
```

```svelte
<script>
  import { sayshape } from "sayshape/svelte";

  let spec = `state days=2
card
  text "Yosemite weekend" style=title
  stat label="Days" value={days}
  button "Add day" on=inc:days
  button "Book" on=emit:book`;
</script>

<div use:sayshape={{ spec, theme: "auto", onAction: (e) => console.log(e.name, e.value) }}></div>
```

The action puts a canvas inside the element it is used on, and the canvas fills that element's width. See [`examples/svelte`](../../examples/svelte).

## Parameters

| Parameter | Type | Notes |
|---|---|---|
| `spec` | `string` | The spec text. Changing it keeps the state unless `resetStateOnChange` is set; the same string does nothing. |
| `streaming` | `boolean` | Treat `spec` as text that is still growing. |
| `theme` | `"auto" \| "light" \| "dark" \| Theme` | Changing it calls `setTheme`; the engine is not recreated. |
| `resetStateOnChange` | `boolean` | Start from the spec's own state each time `spec` changes. |
| `options` | engine options | `animate`, `imageHosts`, `minHeight`, and so on (everything but `components` and `theme`). |
| `components` | `ComponentDef[]` | Default: the core components. |
| `onReady` | `(engine) => void` | Called once, with the `SayShape` engine, right after it is created. |
| `onAction` | `(e) => void` | `{ name, value, node }`: an `emit:` action ran. |
| `onChange` | `(e) => void` | `{ key, value }` |
| `onDiagnostics` | `(list) => void` | The diagnostics, when they change. |
| `onNavigate` | `(e) => void` | `{ screen, from }` |
| `onNotify` | `(e) => void` | `{ text }` |
| `onRender` | `(metrics) => void` | After each frame. |

`options` and `components` are read once, when the action starts. To change them, recreate the element, for example with `{#key}`:

```svelte
{#key options}
  <div use:sayshape={{ spec, options }}></div>
{/key}
```

Callbacks are looked up when an event fires, so passing a new function takes effect without touching the engine.

## Streaming

```svelte
<div use:sayshape={{ spec: text, streaming: loading }}></div>
```

While `streaming` is true the action calls `beginStream()` once and `push()`es only the characters added to `spec`. When `streaming` becomes false it calls `endStream()`. If `spec` shrinks or stops being an extension of what was streamed, the stream starts again.

## The engine

An action cannot return a value to the component, so use `onReady`:

```svelte
<script>
  import { sayshape } from "sayshape/svelte";
  let engine;
</script>

<div use:sayshape={{ spec: 'text "Hello"', onReady: (e) => (engine = e) }}></div>
<button onclick={() => navigator.clipboard.writeText(engine.copyText())}>Copy</button>
```

(In Svelte 4 write `on:click` instead of `onclick`.)

## Lifecycle

`update()` runs whenever Svelte passes new parameters, which can be often; values that did not change do nothing. `destroy()` unsubscribes every listener, destroys the engine and removes the canvas. Actions do not run during server rendering, so nothing is drawn on the server.
