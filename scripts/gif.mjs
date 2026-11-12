/**
 * Screenshots to an animated GIF, for the README's pictures
 * (scripts/readme-hero.mjs and scripts/readme-demos.mjs).
 */
import gifenc from "gifenc";
import { inflateSync } from "node:zlib";

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** A screenshot's pixels as RGBA. Chromium writes plain 8-bit PNGs, which is all this reads. */
export function decodePng(buf) {
  let p = 8, w = 0, h = 0, kind = 0;
  const data = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4); kind = body[9];
      if (body[8] !== 8 || (kind !== 2 && kind !== 6) || body[12] !== 0) throw new Error("Unexpected PNG format from the screenshot");
    } else if (type === "IDAT") data.push(body);
    p += 12 + len;
  }
  const bpp = kind === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(data));
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * bpp;
      out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

/**
 * Frames to a GIF. Each frame stores only the pixels that changed since the
 * one before, with its own palette for just those pixels, so gradients and
 * small text keep their colors; a frame where nothing changed is folded into
 * the wait before it.
 */
export function encode(frames) {
  const { w, h } = frames[0];
  const gif = GIFEncoder();
  let prev = null, written = 0;
  const pending = [];
  for (const f of frames) {
    const now = new Uint32Array(f.rgba.buffer), was = prev && new Uint32Array(prev.buffer);
    const changed = [];
    for (let i = 0; i < now.length; i++) if (!was || now[i] !== was[i]) changed.push(i);
    if (!changed.length) { pending[pending.length - 1].delay += f.delay; continue; }
    const pixels = new Uint8Array(changed.length * 4);
    for (let k = 0; k < changed.length; k++) pixels.set(f.rgba.subarray(changed[k] * 4, changed[k] * 4 + 4), k * 4);
    const palette = quantize(pixels, 255), CLEAR = palette.length;
    // Flat areas (backgrounds, borders) must come out exactly, or text that was there leaves a faint mark.
    const counts = new Map();
    const colors = new Uint32Array(pixels.buffer);
    for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
    const taken = new Set();
    for (const [c] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, 16)) {
      const rgb = [c & 255, (c >> 8) & 255, (c >> 16) & 255];
      let best = -1, far = Infinity;
      palette.forEach((q, i) => { const d = (q[0] - rgb[0]) ** 2 + (q[1] - rgb[1]) ** 2 + (q[2] - rgb[2]) ** 2; if (d < far && !taken.has(i)) { far = d; best = i; } });
      if (best >= 0) { palette[best] = rgb; taken.add(best); }
    }
    const picked = applyPalette(pixels, palette);
    const index = new Uint8Array(w * h).fill(CLEAR);
    for (let k = 0; k < changed.length; k++) index[changed[k]] = picked[k];
    pending.push({ index, palette: [...palette, [0, 0, 0]], delay: f.delay, clear: CLEAR, first: !prev });
    prev = f.rgba;
  }
  for (const f of pending) {
    gif.writeFrame(f.index, w, h, f.first ? { palette: f.palette, delay: f.delay, repeat: 0 } : { palette: f.palette, delay: f.delay, transparent: true, transparentIndex: f.clear, dispose: 1 });
    written++;
  }
  gif.finish();
  return { bytes: gif.bytes(), written };
}
