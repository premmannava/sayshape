/**
 * A deck as a file to send around (experimental, with --slides): a PDF or a
 * PowerPoint file with one page per slide, each a picture of the slide as
 * the engine draws it. Pictures, so nothing in the file can be edited, and
 * it looks exactly as it did in the chat.
 *
 * Both formats are written here by hand, because the view is one file with
 * nothing loaded from elsewhere: a PDF is a few numbered objects around each
 * picture, and a .pptx is a zip (stored, not compressed: its pictures are
 * compressed already) of small XML parts.
 *
 * Pictures go in without loss where the format allows, because JPEG smears
 * the edges of text: a PDF takes the pixels themselves, deflated ("rgb"), and
 * PowerPoint takes a PNG. JPEG is the fallback for a PDF where the browser
 * can't deflate.
 */

/**
 * One slide's picture and its size in pixels. "rgb" is three bytes a pixel,
 * row by row, deflated in the zlib format (deflated()); a PDF takes "rgb" or
 * "jpeg", a PowerPoint file "png" or "jpeg".
 */
export interface SlidePicture {
  data: Uint8Array;
  format: "jpeg" | "png" | "rgb";
  width: number;
  height: number;
}

/** Canvas pixels (four bytes each, as getImageData gives them) without their alpha: three bytes each. */
export function rgbOf(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4) {
    out[o++] = rgba[i] ?? 0;
    out[o++] = rgba[i + 1] ?? 0;
    out[o++] = rgba[i + 2] ?? 0;
  }
  return out;
}

/** Bytes deflated in the zlib format, which is what a PDF's FlateDecode reads; null where the browser can't. */
export async function deflated(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Bytes as base64, in pieces so a long file doesn't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The bytes of a data: URL's base64 part. */
export function fromDataUrl(url: string): Uint8Array {
  return Uint8Array.from(atob(url.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------- PDF

/** The page's width in points; its height follows each picture's shape (540 for 16:9). */
const PAGE_W = 960;

/** A PDF with a page per picture, each filling its page. */
export function pdfOf(slides: readonly SlidePicture[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (bytes: Uint8Array) => { parts.push(bytes); size += bytes.length; };
  // Objects: 1 the catalog, 2 the page list, then a page, its picture and its drawing commands per slide.
  const begin = (id: number) => { offsets[id] = size; put(ascii(`${id} 0 obj\n`)); };
  const end = () => put(ascii("\nendobj\n"));
  // A comment of high bytes right after the header tells tools the file isn't plain text.
  put(join([ascii("%PDF-1.4\n%"), Uint8Array.of(0xe2, 0xe3, 0xcf, 0xd3), ascii("\n")]));
  begin(1); put(ascii("<< /Type /Catalog /Pages 2 0 R >>")); end();
  begin(2); put(ascii(`<< /Type /Pages /Count ${slides.length} /Kids [${slides.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`)); end();
  slides.forEach((s, i) => {
    const page = 3 + i * 3, image = page + 1, content = page + 2;
    const h = Math.round((PAGE_W * s.height) / Math.max(1, s.width) * 100) / 100;
    begin(page);
    put(ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${h}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    end();
    begin(image);
    put(ascii(`<< /Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${s.format === "jpeg" ? "DCTDecode" : "FlateDecode"} /Length ${s.data.length} >>\nstream\n`));
    put(s.data);
    put(ascii("\nendstream"));
    end();
    const draw = `q ${PAGE_W} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    begin(content); put(ascii(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)); end();
  });
  const count = 3 + slides.length * 3;
  const xref = size;
  const rows = Array.from({ length: count - 1 }, (_, i) => `${String(offsets[i + 1] ?? 0).padStart(10, "0")} 00000 n \n`).join("");
  put(ascii(`xref\n0 ${count}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return join(parts);
}

// ---------------------------------------------------------------- zip

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function record(fields: ReadonlyArray<readonly [size: 2 | 4, value: number]>): Uint8Array {
  const out = new Uint8Array(fields.reduce((n, [s]) => n + s, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [s, v] of fields) {
    if (s === 2) view.setUint16(at, v, true); else view.setUint32(at, v >>> 0, true);
    at += s;
  }
  return out;
}

/** A zip of files stored as they are. Names are plain ASCII paths. */
export function zipOf(files: ReadonlyArray<readonly [name: string, data: Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  // A fixed date (1 January 2026), so the same deck always gives the same bytes.
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of files) {
    const n = ascii(name), crc = crc32(data);
    const local = record([[4, 0x04034b50], [2, 20], [2, 0], [2, 0], [2, time], [2, date], [4, crc], [4, data.length], [4, data.length], [2, n.length], [2, 0]]);
    central.push(join([
      record([[4, 0x02014b50], [2, 20], [2, 20], [2, 0], [2, 0], [2, time], [2, date], [4, crc], [4, data.length], [4, data.length], [2, n.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, at]]),
      n,
    ]));
    parts.push(local, n, data);
    at += local.length + n.length + data.length;
  }
  const dir = join(central);
  return join([...parts, dir, record([[4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, dir.length], [4, at], [2, 0]])]);
}

// ---------------------------------------------------------------- PowerPoint

/** A 16:9 slide in PowerPoint's units (914,400 to the inch): 13.333 by 7.5 inches. */
const EMU_W = 12192000, EMU_H = 6858000;

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TYPE = "application/vnd.openxmlformats-officedocument";

const escapeXml = (s: string): string => s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));

const rels = (items: ReadonlyArray<readonly [id: string, type: string, target: string]>): string =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** An empty group every slide, layout and master starts with. */
const TREE_START = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const fill = (color: string): string => `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>`;
const line = `<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`;
const fonts = (name: string): string => `<a:${name}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:${name}>`;

/** The plainest theme PowerPoint accepts: every part of it is required, none of it shows on a picture. */
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SayShape"><a:themeElements>`
  + `<a:clrScheme name="SayShape"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>`
  + `<a:accent1><a:srgbClr val="0F766E"/></a:accent1><a:accent2><a:srgbClr val="2563EB"/></a:accent2><a:accent3><a:srgbClr val="7C3AED"/></a:accent3><a:accent4><a:srgbClr val="D97706"/></a:accent4><a:accent5><a:srgbClr val="DC2626"/></a:accent5><a:accent6><a:srgbClr val="4B5563"/></a:accent6>`
  + `<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>`
  + `<a:fontScheme name="SayShape">${fonts("majorFont")}${fonts("minorFont")}</a:fontScheme>`
  + `<a:fmtScheme name="SayShape"><a:fillStyleLst>${fill("phClr").repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line.repeat(3)}</a:lnStyleLst>`
  + `<a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill("phClr").repeat(3)}</a:bgFillStyleLst></a:fmtScheme>`
  + `</a:themeElements></a:theme>`;

const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${TREE_START}</p:spTree></p:cSld>`
  + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
  + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${TREE_START}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** One slide: its picture over the whole page, described by the slide's title for screen readers. */
function slideXml(title: string): string {
  return `${XML}<p:sld ${NS}><p:cSld><p:spTree>${TREE_START}`
    + `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide" descr="${escapeXml(title)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU_W}" cy="${EMU_H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** A PowerPoint file with a slide per picture, each filling its slide. titles name the pictures for screen readers. */
export function pptxOf(slides: readonly SlidePicture[], titles: readonly string[] = []): Uint8Array {
  const n = slides.map((_, i) => i + 1);
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>`
    + `<Override PartName="/ppt/presentation.xml" ContentType="${TYPE}.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${TYPE}.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${TYPE}.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="${TYPE}.theme+xml"/>`
    + n.map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${TYPE}.presentationml.slide+xml"/>`).join("")
    + `</Types>`;
  // rId1 is the master and rId2 the theme; slides follow from rId3.
  const presentation = `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${n.map((i) => `<p:sldId id="${255 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>`
    + `<p:sldSz cx="${EMU_W}" cy="${EMU_H}"/><p:notesSz cx="${EMU_H}" cy="${EMU_W}"/></p:presentation>`;
  const files: Array<readonly [string, Uint8Array]> = [
    ["[Content_Types].xml", utf8(types)],
    ["_rels/.rels", utf8(rels([["rId1", "officeDocument", "ppt/presentation.xml"]]))],
    ["ppt/presentation.xml", utf8(presentation)],
    ["ppt/_rels/presentation.xml.rels", utf8(rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "theme", "theme/theme1.xml"], ...n.map((i) => [`rId${i + 2}`, "slide", `slides/slide${i}.xml`] as const)]))],
    ["ppt/theme/theme1.xml", utf8(THEME)],
    ["ppt/slideMasters/slideMaster1.xml", utf8(MASTER)],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", utf8(rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]))],
    ["ppt/slideLayouts/slideLayout1.xml", utf8(LAYOUT)],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", utf8(rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]))],
  ];
  slides.forEach((s, k) => {
    const i = k + 1;
    files.push([`ppt/slides/slide${i}.xml`, utf8(slideXml(titles[k] || `Slide ${i}`))]);
    const ext = s.format === "png" ? "png" : "jpg";
    files.push([`ppt/slides/_rels/slide${i}.xml.rels`, utf8(rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "image", `../media/image${i}.${ext}`]]))]);
    files.push([`ppt/media/image${i}.${ext}`, s.data]);
  });
  return zipOf(files);
}
