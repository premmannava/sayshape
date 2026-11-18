# Web component (`<say-shape>`)

`sayshape/element` defines a `<say-shape>` custom element. It works in plain HTML, and in any framework that can render a custom element. Importing the module defines the element; importing it twice is safe.

```bash
npm install sayshape
```

```html
<script type="module">
  import "sayshape/element";
</script>

<say-shape theme="auto">
  <script type="text/sayshape">
    state days=2
    card
      text "Yosemite weekend" style=title
      stat label="Days" value={days}
      button "Add day" on=inc:days
  </script>
</say-shape>
```

With no build step, load it from a CDN. See [`examples/html`](../../examples/html).

## Giving it a spec

Three ways. If more than one is present, a property you set wins over the attribute, and the attribute wins over the script.

| Where | Example |
|---|---|
| Property | `el.spec = 'text "Hello"'` |
| Attribute | `<say-shape spec='text "Hello"'>` |
| Child script | `<script type="text/sayshape">…</script>` as a direct child. The indentation every line has in common is removed, so you can indent the spec in your page. Changing the script's text updates the view. |

Changing the spec keeps the state (a counter stays where it was) unless `reset-state-on-change` is set. A spec that is the same string as before does nothing.

## Properties and attributes

| Property | Attribute | Notes |
|---|---|---|
| `spec` | `spec` | The spec text. |
| `streaming` | `streaming` | Treat `spec` as text that is still growing. See below. |
| `theme` | `theme` | `"auto"`, `"light"` or `"dark"` (`"light"` and `"dark"` are SayShape's built-in themes). The property also takes a `Theme` object, or the host page's own tokens (see [Host tokens](#host-tokens)). Changing it calls `setTheme`; the engine is not recreated. |
| `resetStateOnChange` | `reset-state-on-change` | Start from the spec's own state each time `spec` changes. |
| `options` | none | Engine options (`animate`, `imageHosts`, `minHeight`, and so on). |
| `components` | none | The components to register. Default: the core components. Pass `[...coreComponents, ...mapComponents]` for maps. |
| `engine` (read only) | none | The `SayShape` instance, or `null` before the element is connected and after it is removed. |

`options` and `components` are read once, when the element connects. Set them before you add the element to the page. Changing them afterwards does nothing until the element is removed and added again (a remount).

Boolean attributes are on when present; `streaming="false"` is off. Several property changes in the same task are applied together, in one update.

## Host tokens

To look like part of the page it sits in, give the `theme` property the page's own design tokens: `background`, `surface`, `text`, `textSecondary` (or `textMuted`), `border`, `accent`, `onAccent`, `radius` (px), `fontFamily`, `fontSize` (body text, px), `series` (chart colors) and `dark`. Each is optional. They become an ordinary theme (`themeFromTokens` in `sayshape`), so every element follows them: text that wouldn't reach WCAG AA on the background is darkened or lightened until it does, and with no `series` the chart colors are worked out from the accent, apart in hue and at 3:1 against the background. Values that aren't plain colors, numbers or font stacks are ignored. Set a new object when the page switches between light and dark.

In Angular, bind it like any property (with `CUSTOM_ELEMENTS_SCHEMA` on the component):

```html
<say-shape [spec]="spec" [theme]="portalTokens"></say-shape>
```

```ts
portalTokens = { background: "#f4f6f9", surface: "#ffffff", text: "#1b2533", textSecondary: "#5a6678",
  border: "#d5dbe3", accent: "#00695c", radius: 4, fontFamily: "'Source Sans 3', Arial, sans-serif", fontSize: 15 };
```

## Streaming

With `streaming` on, `spec` is text that is still arriving, such as a model's answer. The element calls `beginStream()` once, then `push()` with only the characters added since last time, and `endStream()` when `streaming` turns off.

```js
const el = document.querySelector("say-shape");
el.streaming = true;
for await (const chunk of answer) el.spec += chunk;
el.streaming = false;
```

If the text shrinks or stops being an extension of what was streamed, the stream starts again from the new text. State is kept across a restart unless `reset-state-on-change` is set.

## Events

The engine's events are re-dispatched on the element as bubbling `CustomEvent`s, with the payload in `detail`:

| Event | `detail` |
|---|---|
| `sayshape-action` | `{ name, value, node }`: an `emit:` action ran |
| `sayshape-change` | `{ key, value }`: a state value changed |
| `sayshape-diagnostics` | the list of diagnostics, when it changes |
| `sayshape-navigate` | `{ screen, from }` |
| `sayshape-notify` | `{ text }` |
| `sayshape-render` | the frame's metrics |

```js
el.addEventListener("sayshape-action", (e) => {
  console.log(e.detail.name, e.detail.value);
});
```

## Moving and removing

Moving an element in the DOM disconnects and reconnects it. The element waits a microtask before tearing the engine down and cancels that if it is connected again, so a move keeps the state. Removing it for good unsubscribes every listener, calls `destroy()` and removes the canvas. Adding it again later builds a new engine.

## Sizing

The element is `display: block` (a zero-specificity rule, so any rule of yours wins) and the canvas fills its width. The engine watches the container and redraws when it resizes. The height follows the content.

## Light DOM, not shadow DOM

`<say-shape>` renders into the page's own DOM. This was decided by testing the engine's accessibility output, not by taste.

The engine adds two kinds of real DOM beside its canvas: the accessibility mirror (live regions and an invisible element for each button, field and heading) and the text layer (selectable, findable text). Both rely on the page's `document`:

- The mirror moves screen-reader focus with `element.focus()` and checks it with `document.activeElement`. Inside a shadow root, `document.activeElement` is the shadow host, never the element inside it, so the engine could not tell where focus was and would lose it on every update.
- The text layer reads `document.getSelection()` and asks `document` for the caret position under the pointer. The browser retargets both at a shadow boundary, so selecting and copying text would stop working.

[`test/element.test.ts`](../../test/element.test.ts) shows the focus case with the real engine in a shadow root and in the light DOM. A shadow root would give style isolation, but the element draws only on a canvas and its DOM is invisible, so there is little style to isolate.

The one thing to know about light DOM: your page's CSS can reach the element's own `<canvas>` and wrapper `<div>`. Style `say-shape` itself (size, margin, display) and leave what is inside alone.

## Server rendering

Importing `sayshape/element` where there is no `HTMLElement` (Node) does not throw and defines nothing. The element draws in the browser once it is connected.

## TypeScript

The module adds `say-shape` to `HTMLElementTagNameMap` and the six events to `HTMLElementEventMap`, so `document.querySelector("say-shape")` and `addEventListener("sayshape-action", …)` are typed.
