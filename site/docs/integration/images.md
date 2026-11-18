---
title: Images
description: SayShape's image source restrictions. Same origin by default, allowed hosts, CORS, and what a blocked image shows.
---

# Images

A spec can name any image URL, and a model writes specs, so SayShape is strict about where images come from. It loads images only from **your own site** (the page's origin) and from **hosts you list**. Everything else, including `data:` and `javascript:` URLs, is blocked: the `image` shows its description instead, and `onWarning` says which host to allow.

```ts
const ui = new SayShape(canvas, {
  components: coreComponents,
  imageHosts: ["cdn.example.com", "*.images.example.com"], // * allows subdomains; https only
});
```

Images load with CORS (`crossOrigin="anonymous"`), so their server must send `Access-Control-Allow-Origin`. The space for each image is kept from its `ratio=` while it loads, so the screen doesn't jump.

```sayshape live warns
card
  text "Same-origin image" weight=semibold
  image "Screenshot of the development playground: a spec on the left, a world map rendered on the right" src="/sayshape/images/playground.png" ratio=16:9 fit=contain
  image "This one is blocked: its host isn't allowed" src="https://example.com/photo.jpg" ratio=3:2
```

The first image is served by this site (it's the screenshot from the repository's README, `docs/images/playground.png`). The second names a host this site doesn't allow, so SayShape never requests it and shows its description instead.

`COMMON_IMAGE_HOSTS` is a ready-made list of the sites models know image addresses on (reference pictures, photos, placeholders, flags, posters, covers). An app can pass it as `imageHosts: COMMON_IMAGE_HOSTS`, alone or with its own hosts. The engine's own default is still none. Only sites that serve their own files and send CORS headers are on it, never image proxies or storage anyone can rent.

Tell the model which hosts work with the guide's `imageHosts` option ([The model guide](./model-guide)). With none, the guide tells it to use images only with URLs it was given, because a model will otherwise invent plausible-looking URLs that don't exist.

## On this site

The chat page allows the common hosts (`COMMON_IMAGE_HOSTS`), so an answer written there can show an image from one of them; each of those sites sees the visitor's IP address when it does. The examples allow none and use no photographs, so nothing in them loads images from elsewhere. The development playground in the repository allows `images.unsplash.com` for two of its samples; those samples are left out of the public playground.
