import { describe, expect, it } from "vitest";
import { accentNotes, decodeViewOptions, DEFAULT_VIEW_OPTIONS, encodeViewOptions, MAX_IMAGE_HOSTS, parseViewArgs, readViewOptions, withViewOptions } from "../src/ui/view-options";

describe("view options", () => {
  it("defaults to no theme picker, teal, and Save image and Copy text on", () => {
    expect(parseViewArgs([])).toEqual({ themePicker: false, theme: "teal", saveImage: true, copyText: true });
    expect(DEFAULT_VIEW_OPTIONS.themePicker).toBe(false);
  });

  it("reads the flags from the command line, next to the server's other flags", () => {
    expect(parseViewArgs(["--data", "x.db", "--theme-picker", "--theme", "blue", "--no-save-image"]))
      .toEqual({ themePicker: true, theme: "blue", saveImage: false, copyText: true });
    expect(parseViewArgs(["--no-copy-text"])).toEqual({ ...DEFAULT_VIEW_OPTIONS, copyText: false });
  });

  it("says which themes exist when --theme names one it doesn't know", () => {
    expect(() => parseViewArgs(["--theme", "red"])).toThrow(/--theme needs one of teal, purple, blue, neutral, studio; got "red"/);
    expect(() => parseViewArgs(["--theme"])).toThrow(/--theme needs one of/);
    expect(() => parseViewArgs(["--theme", "--theme-picker"])).toThrow(/--theme needs one of teal, purple, blue, neutral, studio\.$/);
  });

  it("travels to the view in one meta tag and comes back the same", () => {
    const o = { themePicker: true, theme: "purple" as const, saveImage: false, copyText: false };
    expect(decodeViewOptions(encodeViewOptions(o))).toEqual(o);
    const html = withViewOptions("<!doctype html><html><head><title>v</title></head><body></body></html>", o);
    expect(html).toContain('<head><meta name="sayshape-view" content="picker=1&theme=purple&save=0&copy=0">');
    const doc = { querySelector: () => ({ content: encodeViewOptions(o) }) } as unknown as Document;
    expect(readViewOptions(doc)).toEqual(o);
  });

  it("never puts the tag before a doctype", () => {
    expect(withViewOptions("<!doctype html><title>v</title>", DEFAULT_VIEW_OPTIONS)).toMatch(/^<!doctype html><meta name="sayshape-view"/);
  });

  it("keeps the defaults for a missing tag or values it doesn't know", () => {
    expect(readViewOptions({ querySelector: () => null } as unknown as Document)).toEqual(DEFAULT_VIEW_OPTIONS);
    expect(decodeViewOptions("picker=yes&theme=url(x)&save=maybe&copy=no")).toEqual(DEFAULT_VIEW_OPTIONS);
    // A page written before Copy text existed still gets the button.
    expect(decodeViewOptions("picker=0&theme=teal&save=1").copyText).toBe(true);
  });

  describe("--image-hosts", () => {
    it("reads a comma-separated list of hosts, lower-cased and without repeats", () => {
      expect(parseViewArgs(["--image-hosts", "images.unsplash.com, CDN.Example.com,*.img.example.com,images.unsplash.com"]).imageHosts)
        .toEqual(["images.unsplash.com", "cdn.example.com", "*.img.example.com"]);
      expect(parseViewArgs([]).imageHosts).toBeUndefined();
    });

    it("says what it takes when given a URL, a bare * or nothing", () => {
      for (const bad of ["https://cdn.example.com", "cdn.example.com/img", "cdn.example.com:8443", "*", "*.com", "localhost", "a b.com"]) {
        expect(() => parseViewArgs(["--image-hosts", bad]), bad).toThrow(new RegExp(`--image-hosts needs .*; got "${bad.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`));
      }
      expect(() => parseViewArgs(["--image-hosts"])).toThrow(/--image-hosts needs .*images\.example\.com\.$/);
      expect(() => parseViewArgs(["--image-hosts", "--scene"])).toThrow(/--image-hosts needs .*images\.example\.com\.$/);
      const many = Array.from({ length: MAX_IMAGE_HOSTS + 1 }, (_, i) => `h${i}.example.com`).join(",");
      expect(() => parseViewArgs(["--image-hosts", many])).toThrow(/up to 20 host names/);
    });

    it("travels to the view with the other settings", () => {
      const o = { ...DEFAULT_VIEW_OPTIONS, imageHosts: ["images.unsplash.com", "*.img.example.com"] };
      expect(encodeViewOptions(o)).toBe("picker=0&theme=teal&save=1&copy=1&images=images.unsplash.com,*.img.example.com");
      expect(decodeViewOptions(encodeViewOptions(o))).toEqual(o);
    });

    it("drops a list that was tampered with instead of loading from it", () => {
      expect(decodeViewOptions("images=https://evil.example.com").imageHosts).toBeUndefined();
      expect(decodeViewOptions("images=*").imageHosts).toBeUndefined();
    });
  });

  describe("--accent", () => {
    it("takes a hex color, with or without #, short or long, any case", () => {
      expect(parseViewArgs(["--accent", "#E4572E"]).accent).toBe("#e4572e");
      expect(parseViewArgs(["--accent", "e45"]).accent).toBe("#ee4455");
      expect(parseViewArgs(["--theme", "studio", "--accent", "#0a7"])).toMatchObject({ theme: "studio", accent: "#00aa77" });
      expect(parseViewArgs([]).accent).toBeUndefined();
    });

    it("says what it needs when the color is missing or isn't hex", () => {
      expect(() => parseViewArgs(["--accent", "red"])).toThrow(/--accent needs a hex color, such as "#e4572e" or "#e45"; got "red"/);
      expect(() => parseViewArgs(["--accent", "rgb(1,2,3)"])).toThrow(/got "rgb\(1,2,3\)"/);
      expect(() => parseViewArgs(["--accent"])).toThrow(/--accent needs a hex color/);
      expect(() => parseViewArgs(["--accent", "--theme-picker"])).toThrow(/--accent needs a hex color, such as "#e4572e" or "#e45"\.$/);
    });

    it("travels to the view in the meta tag and back", () => {
      const o = { ...DEFAULT_VIEW_OPTIONS, accent: "#e4572e" };
      expect(encodeViewOptions(o)).toBe("picker=0&theme=teal&accent=e4572e&save=1&copy=1");
      expect(decodeViewOptions(encodeViewOptions(o))).toEqual(o);
      // Without --accent the tag is exactly what it was, so existing views don't change.
      expect(encodeViewOptions(DEFAULT_VIEW_OPTIONS)).toBe("picker=0&theme=teal&save=1&copy=1");
    });

    it("never lets anything but six hex digits through to the canvas", () => {
      for (const bad of ["red", "e45", "#e4572e", "e4572e;x", "url(x)", "E4572E", ""]) {
        expect(decodeViewOptions(`accent=${encodeURIComponent(bad)}`).accent).toBeUndefined();
      }
    });

    it("says at startup what each mode uses, since text in it has to stay readable", () => {
      expect(accentNotes({ theme: "teal" })).toEqual([]);
      // A mid red reads on white but is too dark on the dark background.
      expect(accentNotes({ theme: "teal", accent: "#d93025" })).toEqual([
        "accent #d93025: light mode uses it as is; dark mode uses #df4f45, so text in it stays readable.",
      ]);
      // Pale yellow is the other way round.
      expect(accentNotes({ theme: "teal", accent: "#ffe066" })[0]).toMatch(/^accent #ffe066: light mode uses #[0-9a-f]{6}; dark mode uses it as is, so/);
    });
  });
});
