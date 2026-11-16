import { afterEach, describe, expect, it, vi } from "vitest";
import { fitRect, ratioValue } from "../src/components/media";
import { COMMON_IMAGE_HOSTS, resolveImageUrl, type LoadedImage } from "../src/images";
import { coreComponents } from "../src/components";
import { SayShape } from "../src/engine";
import { FakeCanvas, render } from "../src/testing";

const policy = { origin: "https://shop.example", base: "https://shop.example/products/", hosts: ["cdn.example.com", "*.imgs.example.net"] };
const allowed = (src: string) => "url" in resolveImageUrl(src, policy);

describe("the common image hosts", () => {
  const common = { origin: "https://app.example", base: "https://app.example/", hosts: COMMON_IMAGE_HOSTS };
  const loads = (src: string) => "url" in resolveImageUrl(src, common);

  it("is a list of plain host names, each once, that nothing uses unless a host passes it", () => {
    const host = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
    for (const h of COMMON_IMAGE_HOSTS) expect(h, h).toMatch(host);
    expect(new Set(COMMON_IMAGE_HOSTS).size).toBe(COMMON_IMAGE_HOSTS.length);
    expect(Object.isFrozen(COMMON_IMAGE_HOSTS)).toBe(true);
    // The engine's own default is still the page's site only.
    const ui = render(`image "Fox" src="https://upload.wikimedia.org/fox.jpg"\n`, { loadImage: async () => { throw new Error("not asked"); } });
    expect(ui.warnings).toEqual([expect.stringMatching(/upload\.wikimedia\.org isn't in imageHosts/)]);
  });

  it("loads the sites models write, and still nothing else", () => {
    for (const src of [
      "https://upload.wikimedia.org/wikipedia/commons/4/47/Fox.png",
      "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800",
      "https://picsum.photos/seed/trail/600/400",
      "https://flagcdn.com/w320/jp.png",
      "https://image.tmdb.org/t/p/w500/poster.jpg",
      "https://covers.openlibrary.org/b/isbn/9780140328721-M.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg",
    ]) expect(loads(src), src).toBe(true);
    for (const src of [
      "https://tracker.example.org/p.gif",
      "http://upload.wikimedia.org/a.png",
      "https://upload.wikimedia.org.evil.example/a.png",
      "https://mzstatic.com.evil.example/a.png",
      "data:image/png;base64,AAAA",
    ]) expect(loads(src), src).toBe(false);
  });

  it("leaves out hosts that fetch an address for you, and storage anyone can rent", () => {
    // Either would let a spec reach any server again: see the list's comment in src/images.ts.
    const never = [
      "wsrv.nl", "images.weserv.nl", "i0.wp.com", "res.cloudinary.com", "www.gravatar.com", "img.shields.io", "icon.horse", "www.google.com",
      "image.thum.io", "api.microlink.io", "storage.googleapis.com", "firebasestorage.googleapis.com", "s3.amazonaws.com",
    ];
    for (const h of never) expect(loads(`https://${h}/x.png`), h).toBe(false);
    for (const h of COMMON_IMAGE_HOSTS) expect(h, h).not.toMatch(/^\*\.(amazonaws\.com|cloudfront\.net|googleapis\.com|github\.io|vercel\.app|netlify\.app|pages\.dev|workers\.dev|r2\.dev|web\.app|herokuapp\.com)$/);
  });
});

describe("image URL policy", () => {
  it("allows the page's own origin, including relative paths", () => {
    expect(resolveImageUrl("/a.jpg", policy)).toEqual({ url: "https://shop.example/a.jpg" });
    expect(resolveImageUrl("b.jpg", policy)).toEqual({ url: "https://shop.example/products/b.jpg" });
  });

  it("allows listed hosts over https, with * for subdomains", () => {
    expect(allowed("https://cdn.example.com/x.png")).toBe(true);
    expect(allowed("https://eu.imgs.example.net/x.png")).toBe(true);
    expect(allowed("https://imgs.example.net/x.png")).toBe(false);
    expect(allowed("http://cdn.example.com/x.png")).toBe(false);
  });

  it("blocks everything else", () => {
    for (const src of [
      "https://tracker.example.org/pixel.gif",
      "https://cdn.example.com.evil.org/x.png",
      "https://user:pass@cdn.example.com/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "blob:https://shop.example/123",
      "file:///etc/passwd",
      "http://192.168.0.1/admin.png",
      "http://[",
    ]) expect(allowed(src), src).toBe(false);
  });
});

describe("fitting", () => {
  it("reads ratios", () => {
    expect(ratioValue("16:9")).toBeCloseTo(1.778, 3);
    expect(ratioValue("3:4")).toBe(0.75);
  });

  it("covers by cropping equally, and contains by letterboxing", () => {
    expect(fitRect(200, 100, 100, 100, "cover")).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100 });
    expect(fitRect(200, 100, 100, 100, "contain")).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50 });
  });
});

describe("image component", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const picture: LoadedImage = { source: {} as CanvasImageSource, width: 800, height: 600 };
  const draws = (ui: ReturnType<typeof render>) => ui.drawOps.filter((d) => d.op === "drawImage");

  it("keeps its space from the ratio before anything loads", () => {
    const ui = render(`image "Shoe" src="/s.jpg" ratio=4:3\n`, { width: 440, padding: 20 });
    expect(ui.find("image").box!.h).toBe(300);
  });

  it("shows a placeholder while loading, then the picture", async () => {
    let finish!: (img: LoadedImage) => void;
    const ui = render(`image "Shoe" src="/s.jpg"\n`, { loadImage: () => new Promise((r) => { finish = r; }) });
    expect(draws(ui)).toHaveLength(0);
    expect(ui.text()).toEqual([]);
    finish(picture);
    await ui.sayshape.imagesLoaded();
    expect(draws(ui)).toHaveLength(1);
  });

  it("crops to cover the box by default", async () => {
    const ui = render(`image "Shoe" src="/s.jpg" ratio=1:1\n`, { width: 440, padding: 20, loadImage: async () => picture });
    await ui.sayshape.imagesLoaded();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = draws(ui)[0]!.args as number[];
    expect([sx, sy, sw, sh]).toEqual([100, 0, 600, 600]);
    expect([dx, dy, dw, dh]).toEqual([20, 20, 400, 400]);
  });

  it("shows its description when the image fails", async () => {
    const ui = render(`image "Blue trail runners" src="/missing.jpg"\n`, { loadImage: async () => { throw new Error("404"); } });
    await ui.sayshape.imagesLoaded();
    expect(ui.text()).toEqual(["Blue trail runners"]);
    expect(draws(ui)).toHaveLength(0);
  });

  it("never asks the loader for a blocked image, and says why once", async () => {
    const loadImage = vi.fn(async () => picture);
    const ui = render(`image "Pixel" src="https://tracker.example.org/p.gif"\n`, { loadImage });
    ui.sayshape.invalidate("paint");
    ui.sayshape.renderNow();
    expect(loadImage).not.toHaveBeenCalled();
    expect(ui.text()).toEqual(["Pixel"]);
    expect(ui.warnings).toEqual([expect.stringMatching(/tracker\.example\.org isn't in imageHosts/)]);
  });

  it("warns on the console by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // render() collects warnings itself, so build an engine with the defaults.
    const sayshape = new SayShape(new FakeCanvas() as unknown as HTMLCanvasElement, { components: coreComponents, width: 400, animate: false });
    sayshape.setSpec(`image "Pixel" src="https://tracker.example.org/p.gif"\n`);
    sayshape.renderNow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^SayShape: Image .* isn't in imageHosts/);
    sayshape.destroy();
  });

  it("loads from hosts the app allows", async () => {
    const loadImage = vi.fn(async () => picture);
    const ui = render(`image "Shoe" src="https://cdn.example.com/s.jpg"\n`, { loadImage, imageHosts: ["cdn.example.com"] });
    await ui.sayshape.imagesLoaded();
    expect(loadImage).toHaveBeenCalledWith("https://cdn.example.com/s.jpg");
    expect(draws(ui)).toHaveLength(1);
  });

  it("loads each URL once, however often it's drawn", async () => {
    const loadImage = vi.fn(async () => picture);
    const ui = render(`state n=0\nimage "A" src="/a.jpg"\nimage "A again" src="/a.jpg"\nbutton "Go" on=inc:n\n`, { loadImage });
    await ui.sayshape.imagesLoaded();
    ui.press("button");
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(draws(ui)).toHaveLength(2);
  });

  it("follows a src that changes with state", async () => {
    const loadImage = vi.fn(async (_url: string) => picture);
    const ui = render(`state c=blue\nimage "Shoe" src="/shoe-{c}.jpg"\nbutton "Red" on=set:c:red\n`, { loadImage });
    await ui.sayshape.imagesLoaded();
    ui.press("button");
    await ui.sayshape.imagesLoaded();
    expect(loadImage.mock.calls.map((c) => c[0])).toEqual(["http://localhost/shoe-blue.jpg", "http://localhost/shoe-red.jpg"]);
  });
});
