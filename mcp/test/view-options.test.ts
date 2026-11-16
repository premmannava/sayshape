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

  it("turns the text layer off with --no-select-text, and leaves it out of the tag when on", () => {
    expect(parseViewArgs([])).not.toHaveProperty("selectText");
    expect(parseViewArgs(["--no-select-text"])).toEqual({ ...DEFAULT_VIEW_OPTIONS, selectText: false });
    expect(encodeViewOptions(DEFAULT_VIEW_OPTIONS)).toBe("picker=0&theme=teal&save=1&copy=1");
    const off = { ...DEFAULT_VIEW_OPTIONS, selectText: false };
    expect(encodeViewOptions(off)).toBe("picker=0&theme=teal&save=1&copy=1&select=0");
    expect(decodeViewOptions(encodeViewOptions(off))).toEqual(off);
    // A tag written before the option existed keeps the layer on.
    expect(decodeViewOptions("picker=0&theme=teal&save=1&copy=1")).not.toHaveProperty("selectText");
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
      expect(parseViewArgs(["--accent", "#E4572E"]).colors).toEqual(["#e4572e"]);
      expect(parseViewArgs(["--accent", "e45"]).colors).toEqual(["#ee4455"]);
      expect(parseViewArgs(["--theme", "studio", "--accent", "#0a7"])).toMatchObject({ theme: "studio", colors: ["#00aa77"] });
      expect(parseViewArgs([]).colors).toBeUndefined();
    });

    it("says what it needs when the color is missing or isn't hex", () => {
      expect(() => parseViewArgs(["--accent", "red"])).toThrow(/--accent needs a hex color, such as "#e4572e" or "#e45"; got "red"/);
      expect(() => parseViewArgs(["--accent", "rgb(1,2,3)"])).toThrow(/got "rgb\(1,2,3\)"/);
      expect(() => parseViewArgs(["--accent"])).toThrow(/--accent needs a hex color/);
      expect(() => parseViewArgs(["--accent", "--theme-picker"])).toThrow(/--accent needs a hex color, such as "#e4572e" or "#e45"\.$/);
    });

    it("travels to the view in the meta tag and back", () => {
      const o = { ...DEFAULT_VIEW_OPTIONS, colors: ["#e4572e"] };
      expect(encodeViewOptions(o)).toBe("picker=0&theme=teal&accent=e4572e&save=1&copy=1");
      expect(decodeViewOptions(encodeViewOptions(o))).toEqual(o);
      // Without --accent the tag is exactly what it was, so existing views don't change.
      expect(encodeViewOptions(DEFAULT_VIEW_OPTIONS)).toBe("picker=0&theme=teal&save=1&copy=1");
    });

    it("never lets anything but six hex digits through to the canvas", () => {
      for (const bad of ["red", "e45", "#e4572e", "e4572e;x", "url(x)", "E4572E", ""]) {
        expect(decodeViewOptions(`accent=${encodeURIComponent(bad)}`).colors).toBeUndefined();
      }
    });

    it("says at startup what each mode uses, since text in it has to stay readable", () => {
      expect(accentNotes({ theme: "teal" })).toEqual([]);
      // A mid red reads on white but is too dark on the dark background.
      expect(accentNotes({ theme: "teal", colors: ["#d93025"] })).toEqual([
        "accent #d93025: light mode uses it as is; dark mode uses #df4f45, so text in it stays readable.",
      ]);
      // Pale yellow is the other way round.
      expect(accentNotes({ theme: "teal", colors: ["#ffe066"] })[0]).toMatch(/^accent #ffe066: light mode uses #[0-9a-f]{6}; dark mode uses it as is, so/);
    });
  });

  describe("--colors", () => {
    it("takes up to six hex colors, comma-separated, in order, in any form --accent takes", () => {
      expect(parseViewArgs(["--colors", "#E4572E,2e86ab,#fc4"]).colors).toEqual(["#e4572e", "#2e86ab", "#ffcc44"]);
      expect(parseViewArgs(["--colors", "#e4572e"]).colors).toEqual(["#e4572e"]);
      expect(parseViewArgs(["--theme", "studio", "--colors", "#0a7,#07a"])).toMatchObject({ theme: "studio", colors: ["#00aa77", "#0077aa"] });
      const six = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"];
      expect(parseViewArgs(["--colors", six.join(",")]).colors).toEqual(six);
    });

    it("allows spaces around the colors when the list is quoted as one argument", () => {
      expect(parseViewArgs(["--colors", " #e4572e , #2e86ab ,#f2c14e "]).colors).toEqual(["#e4572e", "#2e86ab", "#f2c14e"]);
    });

    it("names the entry that isn't a color, and says how to write one", () => {
      expect(() => parseViewArgs(["--colors", "#e4572e,red,#f2c14e"])).toThrow(/--colors: "red" is not a hex color\. Write each color as #rrggbb or #rgb and separate them with commas.*got "#e4572e,red,#f2c14e"/);
      expect(() => parseViewArgs(["--colors", "#e4572e,#12345"])).toThrow(/"#12345" is not a hex color/);
      expect(() => parseViewArgs(["--colors", "rgb(1,2,3)"])).toThrow(/"rgb\(1" is not a hex color/);
    });

    it("refuses an empty entry, a missing list and a missing value", () => {
      expect(() => parseViewArgs(["--colors", "#e4572e,,#f2c14e"])).toThrow(/entry 2 is empty/);
      expect(() => parseViewArgs(["--colors", "#e4572e,"])).toThrow(/entry 2 is empty/);
      expect(() => parseViewArgs(["--colors", ""])).toThrow(/--colors needs up to 6 hex colors/);
      expect(() => parseViewArgs(["--colors"])).toThrow(/--colors needs up to 6 hex colors.*"#e4572e,#2e86ab,#f2c14e"\.$/);
      expect(() => parseViewArgs(["--colors", "--theme-picker"])).toThrow(/--colors needs up to 6 hex colors/);
    });

    it("refuses more than six at startup instead of dropping some, since the operator can fix it", () => {
      const seven = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"];
      expect(() => parseViewArgs(["--colors", seven.join(",")])).toThrow(/--colors takes up to 6 colors \(one per chart series\); got 7\. Remove the least important ones: the first is the accent\./);
    });

    it("cannot be combined with --accent, in either order, and says to use one", () => {
      for (const args of [["--accent", "#e4572e", "--colors", "#2e86ab"], ["--colors", "#2e86ab", "--accent", "#e4572e"]]) {
        expect(() => parseViewArgs(args)).toThrow(/Use --colors or --accent, not both/);
      }
      // Even when one of them is wrong, the choice between them comes first.
      expect(() => parseViewArgs(["--accent", "red", "--colors", "blue"])).toThrow(/not both/);
    });

    it("travels to the view in the meta tag and back, as colors=, and a single color stays accent=", () => {
      const many = { ...DEFAULT_VIEW_OPTIONS, colors: ["#e4572e", "#2e86ab", "#f2c14e"] };
      expect(encodeViewOptions(many)).toBe("picker=0&theme=teal&colors=e4572e,2e86ab,f2c14e&save=1&copy=1");
      expect(decodeViewOptions(encodeViewOptions(many))).toEqual(many);
      const one = { ...DEFAULT_VIEW_OPTIONS, colors: ["#e4572e"] };
      expect(encodeViewOptions(one)).toBe("picker=0&theme=teal&accent=e4572e&save=1&copy=1");
      expect(decodeViewOptions(encodeViewOptions(one))).toEqual(one);
      // --accent and --colors with one color give the very same tag.
      expect(encodeViewOptions(parseViewArgs(["--colors", "#E4572E"]))).toBe(encodeViewOptions(parseViewArgs(["--accent", "e4572e"])));
      const html = withViewOptions("<!doctype html><html><head></head></html>", many);
      expect(html).toContain('content="picker=0&theme=teal&colors=e4572e,2e86ab,f2c14e&save=1&copy=1"');
      const doc = { querySelector: () => ({ content: encodeViewOptions(many) }) } as unknown as Document;
      expect(readViewOptions(doc)).toEqual(many);
    });

    it("still reads a tag written before lists existed", () => {
      expect(decodeViewOptions("picker=1&theme=blue&accent=e4572e&save=1&copy=1")).toEqual({ ...DEFAULT_VIEW_OPTIONS, themePicker: true, theme: "blue", colors: ["#e4572e"] });
    });

    it("never lets anything but up to six runs of six hex digits through to the canvas", () => {
      for (const bad of ["red", "e4572e,red", "e4572e,", ",e4572e", "e4572e,#2e86ab", "e4572e;x", "url(x)", "E4572E", "", "111111,222222,333333,444444,555555,666666,777777"]) {
        expect(decodeViewOptions(`colors=${encodeURIComponent(bad)}`).colors, bad).toBeUndefined();
      }
      // A bad list doesn't hide a good accent beside it.
      expect(decodeViewOptions("colors=red&accent=e4572e").colors).toEqual(["#e4572e"]);
    });

    it("says at startup what the first color becomes in each mode, and what happens to the rest", () => {
      const notes = accentNotes({ theme: "teal", colors: ["#d93025", "#2e86ab", "#f2c14e"] });
      expect(notes).toHaveLength(2);
      expect(notes[0]).toBe("colors #d93025, #2e86ab, #f2c14e: the first, #d93025, is the accent and the first chart series (light mode uses it as is; dark mode uses #df4f45, so text in it stays readable).");
      expect(notes[1]).toMatch(/^The others are chart series in that order, .*; the last 3 series are worked out from the first color\.$/);
      expect(accentNotes({ theme: "teal", colors: ["#d93025", "#2e86ab", "#f2c14e", "#111111", "#999999"] })[1]).toMatch(/the last series is worked out from the first color\.$/);
      const six = accentNotes({ theme: "teal", colors: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"] });
      expect(six[1]).not.toContain("worked out");
      // Nothing usable behaves as nothing.
      expect(accentNotes({ theme: "teal", colors: [] })).toEqual([]);
    });
  });
});
