# Plain HTML

`index.html` uses the `<say-shape>` element with no build step. It loads `sayshape/element` from jsDelivr:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/sayshape/dist/element.js"></script>
```

That URL works once a version of `sayshape` that includes `sayshape/element` is published to npm. Before then, build the repository (`npm run build`), serve the repository root with any static server, and change the URL in `index.html` to `/dist/element.js`.

See [`docs/integration/web-component.md`](../../docs/integration/web-component.md).
