# React

`sayshape/react` renders a SayShape spec from a React component, in one line:

```tsx
<SayShape spec={spec} onAction={handle} />
```

It works with React 18 and 19. The component draws onto one canvas that fills the width of its container, and the engine follows the container's resizing. The core `sayshape` bundle has no React in it: the wrapper is its own entry point, and `react` and `react-dom` are optional peer dependencies.

## Install

```bash
npm install sayshape react react-dom
```

## The one-line example

```tsx
import { SayShape } from "sayshape/react";

const spec = `state n=0
card
  text "Clicked {n} times"
  button "Add" on=inc:n;emit:added`;

export function Counter() {
  return <SayShape spec={spec} onAction={(e) => console.log(e.name, e.value)} />;
}
```

## Props

| Prop | What it does |
|---|---|
| `spec` | The spec text. A new string replaces the screen and keeps state, unless `resetStateOnChange`. The same string again does nothing. |
| `resetStateOnChange` | Reset state to the spec's initial values whenever `spec` changes. Default `false`. |
| `streaming` | Treat `spec` as text still arriving. See [Streaming from a model](#streaming-from-a-model). |
| `theme` | A `Theme`, or `"auto"` to follow light and dark mode. Changing it restyles the running engine. |
| `options` | Engine options (`animate`, `imageHosts`, `loadImage`, ...). Read once. |
| `components` | Components to register. Default: the core components. Read once. |
| `onAction` `onChange` `onDiagnostics` `onNavigate` `onNotify` `onRender` | The engine's events: `action`, `change`, `diagnostics`, `navigate`, `notify` and `render`. |
| `className`, `style` | For the element around the canvas. |

`options` and `components` are read when the engine is created and never again. To change them, give the component a new `key`, which remounts it:

```tsx
<SayShape key={withMaps ? "maps" : "plain"} spec={spec} components={withMaps ? [...coreComponents, ...mapComponents] : undefined} />
```

Handlers are kept in a ref, so a new inline function on every render never resubscribes anything or recreates the engine.

## Streaming from a model

Set `streaming` while text is arriving and keep the whole text so far in `spec`. The wrapper starts a stream once and pushes only the characters added since the last render. When `streaming` turns false, it hands over the final text and ends the stream. If the text shrinks or stops being an extension of the old text, the stream starts over.

```tsx
import { useState } from "react";
import { SayShape } from "sayshape/react";

function Answer({ ask }: { ask: () => AsyncIterable<string> }) {
  const [spec, setSpec] = useState("");
  const [streaming, setStreaming] = useState(false);

  async function run() {
    setSpec("");
    setStreaming(true);
    let text = "";
    for await (const chunk of ask()) setSpec((text += chunk));
    setStreaming(false);
  }

  return (
    <>
      <button onClick={run}>Ask</button>
      <SayShape spec={spec} streaming={streaming} />
    </>
  );
}
```

A stream keeps state unless `resetStateOnChange` is set. To get the stream from an OpenAI-compatible endpoint, see [`sayshape/model`](../model.md).

## Reacting to actions

An `emit:` action in the spec reaches `onAction` with the name, the value and the node:

```tsx
<SayShape
  spec={`button "Book" on=emit:book`}
  onAction={({ name, value }) => {
    if (name === "book") bookIt(value);
  }}
/>
```

`onChange` reports every state change (`{ key, value }`), `onNotify` the `notify:` messages, `onNavigate` screen changes and `onDiagnostics` the spec's problems, which is handy while a person writes a spec.

## Theming

```tsx
import { darkTheme, lightTheme } from "sayshape";

<SayShape spec={spec} theme={dark ? darkTheme : lightTheme} />
```

Leave `theme` out, or pass `"auto"`, to follow the page's light and dark mode and its `--sayshape-*` CSS variables. Switching theme calls `setTheme` on the running engine; it never recreates it, so state, focus and scroll stay.

## Next.js

The entry begins with `"use client"`, so it can be imported from a Server Component file and the App Router treats it as a client component. The engine is created in an effect, so it never runs on the server: the server renders an empty holder, and the canvas fills in after hydration.

```tsx
// app/page.tsx (a Server Component)
import { SayShape } from "sayshape/react";

export default function Page() {
  return <SayShape spec={`text "Hello from the server's page"`} />;
}
```

Functions can't be passed from a Server Component to a client one, so put `onAction` and other handlers in your own `"use client"` component.

## The ref

The ref is the engine itself (the `SayShape` class from `sayshape`), set once the component has mounted and `null` after unmount:

```tsx
import { useRef } from "react";
import type { SayShape as Engine } from "sayshape";
import { SayShape } from "sayshape/react";

function WithCopy({ spec }: { spec: string }) {
  const ui = useRef<Engine>(null);
  return (
    <>
      <SayShape ref={ui} spec={spec} />
      <button onClick={() => navigator.clipboard.writeText(ui.current?.copyText() ?? "")}>Copy as text</button>
    </>
  );
}
```

Use it for `state`, `diagnostics`, `copyText()`, `go()` and the rest of the [engine API](../engine.md). Don't call `destroy()` on it: the component does that when it unmounts.

## StrictMode

The engine is created in an effect and destroyed in its cleanup, so React's development double mount makes one engine, tears it down and makes another: exactly one is ever live on the canvas.
