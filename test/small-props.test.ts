/**
 * The small props sweep: icons, detail lines, sizes and variants added to
 * stat, button, badge, link, input, check, switch, accordion, callout, empty,
 * tab, progress, list-item, divider, image, code, card and step.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const c = lightTheme.colors;
const texts = (ui: ReturnType<typeof render>) => ui.drawOps.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
const textOp = (ui: ReturnType<typeof render>, s: string) => ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === s)!;
const fine = (spec: string, width = 400) => {
  const ui = render(spec, { width });
  expect(ui.diagnostics).toEqual([]);
  return ui;
};
/** Icons are paths: a stroke in the given color that isn't a text or a box edge. */
const strokes = (ui: ReturnType<typeof render>, color: string) => ui.drawOps.filter((o) => o.op === "stroke" && o.strokeStyle === color).length;

describe("stat", () => {
  it("writes a number of a million or more short, and keeps anything else as given", () => {
    const shown = (value: string, extra = "") => {
      const ui = fine(`stat label="Users" value="${value}"${extra}\n`);
      const out = texts(ui);
      ui.destroy();
      return out;
    };
    expect(shown("1,250,000")).toContain("1.25M");
    expect(shown("1250000")).toContain("1.25M");
    expect(shown("$1,250,000")).toContain("$1.25M");
    expect(shown("3400000000")).toContain("3.4B");
    expect(shown("48,200")).toContain("48,200");
    expect(shown("1.2M orders")).toContain("1.2M orders");
    expect(shown("12 of 20")).toContain("12 of 20");
    expect(shown("1,250,000", " short=false")).toContain("1,250,000");
  });

  it("keeps the exact figure for screen readers", () => {
    const ui = fine(`stat label="Users" value="1,250,000"\n`);
    expect(JSON.stringify(ui.accessibility())).toContain("Users: 1,250,000");
    ui.destroy();
  });

  it("shows a detail line under the figure and grows taller for it", () => {
    const plain = fine(`stat label="Orders" value=12\n`);
    const withDetail = fine(`stat label="Orders" value=12 detail="Last 30 days"\n`);
    expect(texts(withDetail)).toContain("Last 30 days");
    expect(textOp(withDetail, "Last 30 days").fillStyle).toBe(c.muted);
    expect(withDetail.find("stat").box!.h).toBeGreaterThan(plain.find("stat").box!.h);
    const withBoth = fine(`stat label="Orders" value=12 change="+4%" spark={[1,3,2,5]} detail="Last 30 days"\n`);
    const box = withBoth.find("stat").box!;
    expect(textOp(withBoth, "Last 30 days").args[2] as number).toBeLessThan(box.y + box.h);
    expect(JSON.stringify(withDetail.accessibility({ full: true }))).toContain("Last 30 days");
    for (const u of [plain, withDetail, withBoth]) u.destroy();
  });

  it("starts the label after an icon, and warns about an unknown icon name", () => {
    const plain = fine(`stat label="Users" value=12\n`);
    const withIcon = fine(`stat label="Users" value=12 icon=users\n`);
    expect(textOp(withIcon, "Users").args[1] as number).toBeGreaterThan(textOp(plain, "Users").args[1] as number);
    const bad = render(`stat label="Users" value=12 icon=nope\n`);
    expect(bad.diagnostics.some((d) => d.message.includes("isn't an icon"))).toBe(true);
    for (const u of [plain, withIcon, bad]) u.destroy();
  });
});

describe("button", () => {
  const box = (spec: string, width: number) => {
    const ui = render(spec, { width });
    // The button as drawn: on a phone its region is grown for fingers (ring is what it draws).
    const hit = ui.hits.find((h) => h.box.node.type === "button")!;
    const b = hit.ring ?? hit.box;
    ui.destroy();
    return b;
  };

  it("size=sm is a smaller control, from the theme's control height", () => {
    const md = box(`button "Save"\n`, 360);
    const sm = box(`button "Save" size=sm\n`, 360);
    expect(md.h).toBe(lightTheme.control.height);
    expect(sm.h).toBe(Math.round(lightTheme.control.height * 0.8));
    const wide = box(`button "Save" size=sm\n`, 1024);
    const wideMd = box(`button "Save"\n`, 1024);
    expect(wide.w).toBeLessThan(wideMd.w);
  });

  it("fit=true keeps the label's width on a phone, where a button fills its space", () => {
    expect(box(`button "Save"\n`, 360).w).toBe(320);
    const fit = box(`button "Save" fit=true\n`, 360);
    expect(fit.w).toBeLessThan(200);
    expect(fit.x).toBe(20);
  });

  it("an icon goes before the label and widens the button", () => {
    const plain = box(`button "Download report" fit=true\n`, 1024);
    const withIcon = box(`button "Download report" icon=download fit=true\n`, 1024);
    expect(withIcon.w).toBeGreaterThan(plain.w);
    const ui = fine(`button "Download" icon=download\n`, 1024);
    const label = textOp(ui, "Download");
    expect(label.textAlign).toBe("left");
    const b = ui.hits.find((h) => h.box.node.type === "button")!.box;
    expect(label.args[1] as number).toBeGreaterThan(b.x + 20);
    expect(strokes(ui, c.onAccent)).toBeGreaterThan(0);
    ui.destroy();
  });

  it("still runs its action", () => {
    const ui = fine(`state n=0\nbutton "Add" icon=plus size=sm fit=true on=inc:n\n`);
    ui.press({ type: "button", text: "Add" });
    expect(ui.state.n).toBe(1);
    ui.destroy();
  });
});

describe("badge", () => {
  const ops = (variant: string, tone = "good") => {
    const ui = fine(`badge "Shipped" tone=${tone}${variant ? ` variant=${variant}` : ""}\n`);
    const out = { ops: ui.drawOps, label: textOp(ui, "Shipped") };
    ui.destroy();
    return out;
  };

  it("soft is today's look: a faint tint, the label in the tone's color", () => {
    const soft = ops("soft"), plain = ops("");
    expect(soft.ops.map((o) => [o.op, o.fillStyle, o.globalAlpha])).toEqual(plain.ops.map((o) => [o.op, o.fillStyle, o.globalAlpha]));
    expect(soft.label.fillStyle).toBe(c.good);
  });

  it("solid fills with the tone and writes in the on-accent color", () => {
    const solid = ops("solid");
    expect(solid.ops.some((o) => o.op === "fill" && o.fillStyle === c.good && o.globalAlpha === 1)).toBe(true);
    expect(solid.label.fillStyle).toBe(c.onAccent);
  });

  it("outline strokes the tone and leaves the inside empty", () => {
    const outline = ops("outline");
    expect(outline.ops.some((o) => o.op === "stroke" && o.strokeStyle === c.good)).toBe(true);
    // No tint: the only fill is the status dot, at full strength.
    expect(outline.ops.some((o) => o.op === "fill" && o.globalAlpha < 1)).toBe(false);
    expect(outline.label.fillStyle).toBe(c.good);
  });

  it("an icon replaces the status dot, and the badge grows to hold it", () => {
    const dot = fine(`badge "New"\n`), icon = fine(`badge "New" icon=star\n`);
    expect(icon.find("badge").box!.w).toBeGreaterThan(dot.find("badge").box!.w);
    expect(strokes(icon, c.accent)).toBeGreaterThan(strokes(dot, c.accent));
    for (const u of [dot, icon]) u.destroy();
  });

  it("draws in dark mode with theme colors only", () => {
    const ui = render(`badge "Late" tone=bad variant=solid icon=clock\n`, { theme: darkTheme });
    expect(textOp(ui, "Late").fillStyle).toBe(darkTheme.colors.onAccent);
    ui.destroy();
  });
});

describe("link, input", () => {
  it("a link's icon starts it, and the whole thing is pressable", () => {
    const ui = fine(`state n=0\nlink "Size guide" icon=file on=inc:n\n`);
    const plain = fine(`link "Size guide" on=emit:x\n`);
    expect(textOp(ui, "Size guide").args[1] as number).toBeGreaterThan(textOp(plain, "Size guide").args[1] as number);
    ui.press({ type: "link" });
    expect(ui.state.n).toBe(1);
    for (const u of [ui, plain]) u.destroy();
  });

  it("an input's icon sits inside the field and pushes the text in", () => {
    const plain = fine(`input "Search" bind=q placeholder="Find a trip"\n`);
    const ui = fine(`state q=""\ninput "Search" bind=q placeholder="Find a trip" icon=search\n`);
    expect(textOp(ui, "Find a trip").args[1] as number).toBeGreaterThan(textOp(plain, "Find a trip").args[1] as number);
    // The typing box starts after the icon, too.
    ui.press({ type: "input" });
    plain.press({ type: "input" });
    expect(ui.editor!.rect.x).toBeGreaterThan(plain.editor!.rect.x);
    expect(ui.editor!.rect.w).toBeLessThan(plain.editor!.rect.w);
    for (const u of [ui, plain]) u.destroy();
  });
});

describe("check, switch, accordion detail", () => {
  it("shows a muted line under the label and is taller for it", () => {
    for (const [spec, type] of [
      [`state a=false\ncheck "Email me" bind=a detail="Order updates only"\n`, "check"],
      [`state a=false\nswitch "Email me" bind=a detail="Order updates only"\n`, "switch"],
      [`state a=true\naccordion "Returns" bind=a detail="Free for 30 days"\n  text "Unworn."\n`, "accordion"],
    ] as const) {
      const ui = fine(spec);
      const detail = ui.drawOps.find((o) => o.op === "fillText" && /Order updates only|Free for 30 days/.test(String(o.args[0])))!;
      expect(detail.fillStyle, type).toBe(c.muted);
      const plain = fine(spec.replace(/ detail="[^"]*"/, ""));
      expect(ui.find(type).box!.h, type).toBeGreaterThan(plain.find(type).box!.h);
      expect(JSON.stringify(ui.accessibility({ full: true })), type).toMatch(/Order updates only|Free for 30 days/);
      for (const u of [ui, plain]) u.destroy();
    }
  });

  it("still toggles", () => {
    const ui = fine(`state a=false\ncheck "Email me" bind=a detail="Order updates only"\nswitch "Texts" bind=b detail="Rare"\n`);
    ui.press({ type: "check" });
    expect(ui.state.a).toBe(true);
    ui.destroy();
  });
});

describe("callout action", () => {
  const spec = `state n=0\ncallout "Rock is 47% of revenue" detail="Up from 41%" tone=warn action="See why" on=inc:n\n`;

  it("draws a button under the text and runs on= when it is pressed", () => {
    const ui = fine(spec);
    const plain = fine(`callout "Rock is 47% of revenue" detail="Up from 41%" tone=warn\n`);
    expect(texts(ui)).toContain("See why");
    expect(ui.find("callout").box!.h).toBeGreaterThan(plain.find("callout").box!.h);
    const hit = ui.hits.find((h) => h.detail === "action")!;
    expect(hit).toBeTruthy();
    ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
    expect(ui.state.n).toBe(1);
    for (const u of [ui, plain]) u.destroy();
  });

  it("is reachable by keyboard, and read as a button", () => {
    const ui = fine(spec);
    ui.tab();
    ui.key("Enter");
    expect(ui.state.n).toBe(1);
    expect(JSON.stringify(ui.accessibility())).toContain("See why");
    ui.destroy();
  });

  it("with no on=, the label shows but nothing can be pressed", () => {
    const ui = fine(`callout "Heads up" action="Read more"\n`);
    expect(ui.hits.filter((h) => h.detail === "action")).toHaveLength(0);
    ui.destroy();
  });
});

describe("empty, tab, progress, list-item, divider, image", () => {
  it("empty icon replaces the tray, and warns about an unknown name", () => {
    const tray = fine(`empty "Nothing here"\n`), icon = fine(`empty "Nothing here" icon=search\n`);
    expect(icon.drawOps.filter((o) => o.op === "stroke").length).not.toBe(tray.drawOps.filter((o) => o.op === "stroke").length);
    expect(strokes(icon, c.muted)).toBeGreaterThan(0);
    const bad = render(`empty "x" icon=nope\n`);
    expect(bad.diagnostics.length).toBe(1);
    for (const u of [tray, icon, bad]) u.destroy();
  });

  it("tab badge is a pill after the label, and part of its accessible name", () => {
    const ui = fine(`state v=a\ntabs bind=v\n  tab "Inbox" value=a badge=3\n    text "x"\n  tab "Sent" value=b\n    text "y"\n`);
    expect(texts(ui)).toContain("3");
    expect(textOp(ui, "3").fillStyle).toBe(c.accent);
    expect(JSON.stringify(ui.accessibility())).toContain("Inbox, 3");
    ui.press({ type: "tabs" });
    ui.destroy();
  });

  it("progress show= reads out percent or value, with or without a label", () => {
    const percent = fine(`progress value=3 max=5 label="Steps" show=percent\n`);
    expect(texts(percent)).toEqual(["Steps", "60%"]);
    const value = fine(`progress value=3 max=5 show=value\n`);
    expect(texts(value)).toEqual(["3 / 5"]);
    expect(value.find("progress").box!.h).toBeGreaterThan(6);
    const none = fine(`progress value=3 max=5\n`);
    expect(none.find("progress").box!.h).toBe(6);
    for (const u of [percent, value, none]) u.destroy();
  });

  it("list-item tone draws the trailing value as a badge", () => {
    const plain = fine(`list\n  list-item "Order 1042" trailing="Late"\n`);
    const tagged = fine(`list\n  list-item "Order 1042" trailing="Late" tone=bad\n`);
    expect(textOp(plain, "Late").fillStyle).toBe(c.ink);
    expect(textOp(tagged, "Late").fillStyle).toBe(c.bad);
    expect(tagged.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.bad && o.globalAlpha < 1)).toBe(true);
    for (const u of [plain, tagged]) u.destroy();
  });

  it("divider with a label draws the line either side of it", () => {
    const plain = fine(`divider\n`), labelled = fine(`divider "or"\n`);
    expect(plain.find("divider").box!.h).toBe(1);
    expect(labelled.find("divider").box!.h).toBeGreaterThan(1);
    expect(texts(labelled)).toEqual(["or"]);
    expect(labelled.drawOps.filter((o) => o.op === "fillRect" && o.fillStyle === c.line)).toHaveLength(2);
    expect(JSON.stringify(labelled.accessibility())).toContain("or");
    for (const u of [plain, labelled]) u.destroy();
  });

  it("image caption sits under the picture in muted text", () => {
    const plain = fine(`image "Trail runners" src="/a.jpg" ratio=4:3\n`);
    const ui = fine(`image "Trail runners" src="/a.jpg" ratio=4:3 caption="Ridgeline, side view"\n`);
    const box = ui.find("image").box!;
    expect(box.h).toBeGreaterThan(plain.find("image").box!.h);
    const cap = textOp(ui, "Ridgeline, side view");
    expect(cap.fillStyle).toBe(c.muted);
    expect(cap.args[2] as number).toBeGreaterThan(box.y + plain.find("image").box!.h);
    expect(cap.args[2] as number).toBeLessThan(box.y + box.h);
    for (const u of [plain, ui]) u.destroy();
  });
});

describe("code title and copy", () => {
  it("a title is a header line above the code", () => {
    const plain = fine(`code "npm install sayshape"\n`);
    const ui = fine(`code "npm install sayshape" title="Terminal"\n`);
    expect(textOp(ui, "Terminal").fillStyle).toBe(c.muted);
    expect(textOp(ui, "Terminal").args[2] as number).toBeLessThan(textOp(ui, "npm install sayshape").args[2] as number);
    expect(ui.find("code").box!.h).toBeGreaterThan(plain.find("code").box!.h);
    for (const u of [plain, ui]) u.destroy();
  });

  it("the copy button emits copy with the whole code, by press and by keyboard", () => {
    const ui = fine(`code "npm install sayshape" copy=true\n`);
    const hit = ui.hits.find((h) => h.detail === "copy")!;
    expect(hit).toBeTruthy();
    ui.click(hit.box.x + hit.box.w / 2, hit.box.y + hit.box.h / 2);
    expect(ui.emitted).toEqual([{ name: "copy", value: "npm install sayshape" }]);
    expect(JSON.stringify(ui.accessibility())).toContain("Copy code");
    ui.destroy();
    const keys = fine(`code "ls -la" copy=true\n`);
    keys.tab();
    keys.key("Enter");
    expect(keys.emitted).toEqual([{ name: "copy", value: "ls -la" }]);
    keys.destroy();
  });

  it("keeps the text clear of the button and passes it on exactly, quotes and all", () => {
    const code = `echo "a: b; c" && ls`;
    const ui = fine(`code "echo \\"a: b; c\\" && ls" copy=true title="Shell"\n`, 220);
    const hit = ui.hits.find((h) => h.detail === "copy")!;
    ui.click(hit.box.x + 4, hit.box.y + 4);
    expect(ui.emitted[0]).toEqual({ name: "copy", value: code });
    const box = ui.find("code").box!;
    expect(hit.box.x + hit.box.w).toBeLessThanOrEqual(box.x + box.w);
    ui.destroy();
  });

  it("has no button unless asked", () => {
    const ui = fine(`code "ls"\n`);
    expect(ui.hits.filter((h) => h.detail === "copy")).toHaveLength(0);
    ui.destroy();
  });
});

describe("card tone and step blocked", () => {
  it("card tone draws a stripe on the left edge in the tone's color", () => {
    const plain = fine(`card\n  text "Hi"\n`), ui = fine(`card tone=warn\n  text "Hi"\n`);
    const box = ui.find("card").box!;
    const stripe = ui.drawOps.find((o) => o.op === "fillRect" && o.fillStyle === c.warn)!;
    expect(stripe.args[0]).toBe(box.x);
    expect(stripe.args[2]).toBe(lightTheme.space.xs);
    expect(stripe.args[3]).toBe(box.h);
    expect(plain.drawOps.some((o) => o.op === "fillRect" && o.fillStyle === c.warn)).toBe(false);
    for (const u of [plain, ui]) u.destroy();
  });

  it("a blocked step has its marker in the bad color and is read as blocked", () => {
    const ui = fine(`timeline\n  step "Ordered" status=done\n  step "Payment" status=blocked detail="Card declined"\n  step "Shipped" status=upcoming\n`);
    expect(ui.drawOps.some((o) => o.op === "fill" && o.fillStyle === c.bad)).toBe(true);
    expect(JSON.stringify(ui.accessibility())).toContain("Payment, blocked, Card declined");
    ui.destroy();
  });
});
