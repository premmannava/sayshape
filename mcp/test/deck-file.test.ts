import { describe, expect, it } from "vitest";
import { render } from "../../src/testing";
import { coreComponents } from "../../src/components";
import { crc32, deflated, fromDataUrl, pdfOf, pptxOf, rgbOf, toBase64, zipOf, type SlidePicture } from "../src/ui/deck-file";
import { inflateSync } from "node:zlib";
import { DECK_ACTION, PRESENT_ACTION, SAVE_ACTION, toolbarSpec, toolbarWidth, TOOLBAR_PADDING } from "../src/ui/theme-selection";
import { toolButton } from "../src/ui/tool-button";
import { imageName } from "../src/ui/messages";

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
// Not real JPEGs: the writers only wrap the bytes they're given.
const SLIDES: SlidePicture[] = [
  { data: Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), format: "jpeg", width: 1920, height: 1080 },
  { data: Uint8Array.from([0xff, 0xd8, 9, 8, 7, 6, 0xff, 0xd9]), format: "jpeg", width: 1920, height: 1080 },
];

/** The files in a stored zip, read back from its central directory. */
function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const out = new Map<string, Uint8Array>();
  let at = v.getUint32(end + 16, true);
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const size = v.getUint32(at + 24, true), nameLen = v.getUint16(at + 28, true), local = v.getUint32(at + 42, true);
    const name = text(zip.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const data = zip.subarray(local + 30 + nameLen, local + 30 + nameLen + size);
    expect(crc32(data)).toBe(v.getUint32(at + 16, true));
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

describe("a deck as a file", () => {
  it("checksums and base64 round trip", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
    expect(fromDataUrl(`data:image/jpeg;base64,${toBase64(bytes)}`)).toEqual(bytes);
  });

  it("writes a PDF with a page per slide and offsets that point at its objects", () => {
    const pdf = pdfOf(SLIDES);
    const s = text(pdf);
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.endsWith("%%EOF\n")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(s).toContain("/MediaBox [0 0 960 540]");
    const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const rows = [...s.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(rows).toHaveLength(8);
    rows.forEach((at, i) => expect(s.slice(at, at + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // The picture's bytes go in untouched, at the length the object says.
    const image = s.indexOf("/Length 7 >>\nstream\n") + "/Length 7 >>\nstream\n".length;
    expect(pdf.subarray(image, image + 7)).toEqual(SLIDES[0]!.data);
  });

  it("puts pixels in a PDF without loss, deflated the way a PDF reads them", async () => {
    // Two pixels, as a canvas gives them: red and half-clear blue; the alpha is dropped.
    const rgb = rgbOf(Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 128]));
    expect([...rgb]).toEqual([255, 0, 0, 0, 0, 255]);
    const packed = await deflated(rgb);
    expect(packed).not.toBeNull();
    expect([...inflateSync(packed!)]).toEqual([...rgb]);
    const s = text(pdfOf([{ data: packed!, format: "rgb", width: 2, height: 1 }]));
    expect(s).toContain(`/Filter /FlateDecode /Length ${packed!.length}`);
    expect(s).not.toContain("DCTDecode");
  });

  it("keeps a PNG a PNG in a PowerPoint file", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2);
    const files = unzip(pptxOf([{ data: png, format: "png", width: 2880, height: 1620 }]));
    expect(files.get("ppt/media/image1.png")).toEqual(png);
    expect(text(files.get("ppt/slides/_rels/slide1.xml.rels")!)).toContain('Target="../media/image1.png"');
    expect(text(files.get("[Content_Types].xml")!)).toContain('Extension="png" ContentType="image/png"');
  });

  it("writes a zip whose entries read back with matching checksums", () => {
    const files = unzip(zipOf([["a.txt", new TextEncoder().encode("hello")], ["dir/b.bin", Uint8Array.of(1, 2, 3)]]));
    expect([...files.keys()]).toEqual(["a.txt", "dir/b.bin"]);
    expect(text(files.get("a.txt")!)).toBe("hello");
  });

  it("writes a PowerPoint file with a slide and a picture per slide", () => {
    const files = unzip(pptxOf(SLIDES, ['Q3 <review> & "more"']));
    // The content types come first: readers look for them at the start.
    expect([...files.keys()][0]).toBe("[Content_Types].xml");
    for (const name of ["ppt/presentation.xml", "ppt/theme/theme1.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]) {
      expect(files.has(name), name).toBe(true);
    }
    expect(files.get("ppt/media/image2.jpg")).toEqual(SLIDES[1]!.data);
    const types = text(files.get("[Content_Types].xml")!);
    expect(types.match(/presentationml\.slide\+xml/g)).toHaveLength(2);
    expect(text(files.get("ppt/presentation.xml")!)).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    expect(text(files.get("ppt/slides/slide1.xml")!)).toContain('descr="Q3 &lt;review&gt; &amp; &quot;more&quot;"');
    expect(text(files.get("ppt/slides/slide2.xml")!)).toContain('descr="Slide 2"');
    expect(text(files.get("ppt/slides/_rels/slide2.xml.rels")!)).toContain('Target="../media/image2.jpg"');
  });

  it("gives the same bytes for the same deck", () => {
    expect(pptxOf(SLIDES)).toEqual(pptxOf(SLIDES));
  });
});

describe("the toolbar with deck files on", () => {
  const OFF = { picker: false, save: true, copy: true, theme: "teal" } as const;
  const ON = { ...OFF, deck: true } as const;
  const TOOLS = [...coreComponents, toolButton];

  it("is unchanged without them", () => {
    expect(toolbarSpec(OFF)).not.toMatch(/deck|PowerPoint/);
    expect(toolbarSpec({ ...OFF, save: false, deck: true })).not.toMatch(/deck|PowerPoint/);
    expect(toolbarWidth({ ...OFF, save: false, deck: true })).toBe(toolbarWidth({ ...OFF, save: false }));
  });

  it("offers PowerPoint and PDF only while a deck is showing", () => {
    const ui = render(toolbarSpec(ON), { components: TOOLS, width: toolbarWidth(ON), padding: TOOLBAR_PADDING });
    try {
      expect(ui.diagnostics).toEqual([]);
      const names = () => JSON.stringify(ui.accessibility());
      expect(ui.hits).toHaveLength(2);
      expect(names()).toContain("Save image");
      expect(names()).not.toMatch(/PowerPoint|PDF/);
      ui.sayshape.state.set("deck", true);
      ui.sayshape.renderNow();
      expect(ui.hits).toHaveLength(3);
      expect(names()).toContain("Save as PowerPoint");
      expect(names()).toContain("Save as PDF");
      expect(names()).not.toContain("Save image");
      ui.press({ text: "Save as PowerPoint" });
      ui.press({ text: "Save as PDF" });
      expect(ui.emitted.map((e) => e.name)).toEqual([DECK_ACTION, SAVE_ACTION]);
    } finally {
      ui.destroy();
    }
  });

  it("offers Present where the chat app has a full-screen mode, while a deck is showing", () => {
    const tools = { ...ON, present: true } as const;
    expect(toolbarWidth(tools)).toBeGreaterThan(toolbarWidth(ON));
    expect(toolbarSpec({ ...OFF, present: true })).toBe(toolbarSpec(OFF));
    const ui = render(toolbarSpec(tools), { components: TOOLS, width: toolbarWidth(tools), padding: TOOLBAR_PADDING });
    try {
      expect(ui.diagnostics).toEqual([]);
      expect(ui.hits).toHaveLength(2);
      ui.sayshape.state.set("deck", true);
      ui.sayshape.renderNow();
      expect(ui.hits).toHaveLength(4);
      ui.press({ text: "Present" });
      expect(ui.emitted.map((e) => e.name)).toEqual([PRESENT_ACTION]);
      ui.sayshape.state.set("full", true);
      ui.sayshape.renderNow();
      expect(JSON.stringify(ui.accessibility())).toContain("Leave full screen");
    } finally {
      ui.destroy();
    }
  });

  it("names the file after the first slide", () => {
    expect(imageName('state page=0\ndeck bind=page\n  slide "Q3 business review" layout=title')).toBe("q3-business-review.png");
  });
});
