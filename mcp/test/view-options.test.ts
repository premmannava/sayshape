import { describe, expect, it } from "vitest";
import { decodeViewOptions, DEFAULT_VIEW_OPTIONS, encodeViewOptions, parseViewArgs, readViewOptions, withViewOptions } from "../src/ui/view-options";

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
});
