import { describe, expect, it } from "vitest";
import { MAX_INPUT_LINES } from "../src/components/input";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const FORM = `state name="" email="" seats=null note="" pw="" sent=0
card
  input "Name" bind=name required=true
  input "Email" bind=email kind=email required=true
  input "Seats" bind=seats kind=number
  input "Password" bind=pw kind=password error="{len(pw) < 8 ? 'At least 8 characters' : ''}"
  input "Note" bind=note lines=4 placeholder="Anything we should know?"
  button "Send" on=inc:sent
`;

type UI = ReturnType<typeof render>;
/** Text drawn in the bad color: the messages under fields. */
const problems = (ui: UI) => ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.bad).map((o) => String(o.args[0]));
const leave = (ui: UI) => ui.key("Escape");

describe("forms: required, email, number and error=", () => {
  it("parses with no problems", () => {
    expect(render(FORM).diagnostics).toEqual([]);
  });

  it("says nothing until a field has been typed in and left", () => {
    const ui = render(FORM, { width: 600 });
    expect(problems(ui)).toEqual([]);
    // Only passing through: nothing to say.
    ui.press({ type: "input", text: "Name" });
    leave(ui);
    expect(problems(ui)).toEqual([]);
    ui.type({ type: "input", text: "Name" }, "A");
    expect(problems(ui)).toEqual([]);
    ui.type({ type: "input", text: "Name" }, "", { replace: true });
    leave(ui);
    expect(problems(ui)).toEqual(["Required"]);
  });

  it("starts afresh when the value is written from elsewhere (a form cleared after sending)", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Email" }, "ana@");
    leave(ui);
    expect(problems(ui)).toEqual(["Enter an email like name@example.com"]);
    ui.set("email", "");
    expect(problems(ui)).toEqual([]);
  });

  it("keeps a password one line, so it stays hidden while typed, and warns about lines= on it", () => {
    const ui = render(`state pw=""\ninput "Password" bind=pw kind=password lines=3\n`, { width: 600 });
    expect(ui.diagnostics.map((d) => d.message).join(" ")).toMatch(/lines= works only on a text field/);
    ui.type("input", "secret");
    expect(ui.editor?.lines).toBeUndefined();
    expect(ui.editor?.kind).toBe("password");
  });

  it("tells the text box what's wrong, for screen readers while typing", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Email" }, "ana@");
    leave(ui);
    ui.press({ type: "input", text: "Email" });
    expect(ui.editor?.problem).toBe("Enter an email like name@example.com");
    expect(ui.editor?.required).toBe(true);
  });

  it("checks an email's form, and stops saying so once it's right", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Email" }, "ana@northwind");
    leave(ui);
    expect(problems(ui)).toEqual(["Enter an email like name@example.com"]);
    ui.type({ type: "input", text: "Email" }, ".example");
    leave(ui);
    expect(ui.state.email).toBe("ana@northwind.example");
    expect(problems(ui)).toEqual([]);
  });

  it("says when a number field holds something that isn't a number", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Seats" }, "two");
    leave(ui);
    expect(ui.state.seats).toBeNull();
    expect(problems(ui)).toEqual(["Enter a number, like 12 or 3.5"]);
    ui.type({ type: "input", text: "Seats" }, "2", { replace: true });
    leave(ui);
    expect(ui.state.seats).toBe(2);
    expect(problems(ui)).toEqual([]);
  });

  it("shows error= once the field has been left, while it isn't empty", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Password" }, "abc");
    leave(ui);
    expect(problems(ui)).toEqual(["At least 8 characters"]);
    ui.type({ type: "input", text: "Password" }, "defghij");
    expect(problems(ui)).toEqual([]);
  });

  it("makes room for the message under the field, pushing what follows down", () => {
    const ui = render(FORM, { width: 600 });
    const before = ui.find({ type: "input", text: "Email" }).box!.y;
    ui.type({ type: "input", text: "Name" }, "x");
    ui.type({ type: "input", text: "Name" }, "", { replace: true });
    leave(ui);
    expect(ui.find({ type: "input", text: "Email" }).box!.y).toBeGreaterThan(before + 10);
  });

  it("tells screen readers the field is required, and what's wrong with it", () => {
    const ui = render(FORM, { width: 600 });
    ui.type({ type: "input", text: "Name" }, "x");
    ui.type({ type: "input", text: "Name" }, "", { replace: true });
    leave(ui);
    const tree = ui.accessibility({ full: true });
    const all: Array<{ name?: string; required?: boolean; invalid?: boolean; description?: string }> = [];
    const walk = (n: typeof tree) => { all.push(n); n.children.forEach(walk); };
    walk(tree);
    const name = all.find((n) => n.name === "Name")!;
    expect(name).toMatchObject({ required: true, invalid: true, description: "Required" });
    expect(all.find((n) => n.name === "Email")).toMatchObject({ required: true });
    expect(all.find((n) => n.name === "Email")!.invalid).toBeUndefined();
  });

  it("wraps long messages at narrow widths", () => {
    const ui = render(`state e=""\ninput "Email" bind=e kind=email\n`, { width: 240 });
    ui.type("input", "x");
    leave(ui);
    expect(problems(ui).length).toBeGreaterThan(1);
  });
});

describe("lines=: a box of several lines", () => {
  it("is as tall as its rows, and Enter starts a new line", () => {
    const ui = render(FORM, { width: 600 });
    const one = ui.find({ type: "input", text: "Name" }).box!;
    const note = ui.find({ type: "input", text: "Note" }).box!;
    expect(note.h).toBeGreaterThan(one.h * 1.6);
    ui.type({ type: "input", text: "Note" }, "Window seats\nNo nuts");
    ui.key("Enter");
    expect(ui.state.sent).toBe(0);
    expect(ui.editor?.lines).toBe(4);
    expect(ui.state.note).toBe("Window seats\nNo nuts");
  });

  it("draws each line, and cuts what doesn't fit with an ellipsis", () => {
    const ui = render(`state n=""\ninput "Note" bind=n lines=3\n`, { width: 600 });
    ui.set("n", Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join("\n"));
    const drawn = ui.text();
    expect(drawn).toContain("Line 1");
    expect(drawn).toContain("Line 2");
    expect(drawn.some((t) => t.startsWith("Line 3") && t.endsWith("…"))).toBe(true);
    expect(drawn).not.toContain("Line 4");
  });

  it("wraps a long word inside the box at 240px", () => {
    const ui = render(`state n=""\ninput "Note" bind=n lines=3\n`, { width: 240 });
    ui.set("n", "https://northwind.example/" + "a".repeat(120));
    const f = ui.find("input").box!;
    for (const o of ui.drawOps.filter((d) => d.op === "fillText" && String(d.args[0]).includes("aaa"))) {
      expect(Number(o.args[1])).toBeGreaterThanOrEqual(f.x);
    }
    expect(ui.text().filter((t) => t.includes("aaa")).length).toBeGreaterThan(1);
  });

  it("warns that on= doesn't run from a field of several lines", () => {
    const r = render(`state n=""\ninput "Note" bind=n lines=3 on=emit:send\n`);
    expect(r.diagnostics.map((d) => d.message).join(" ")).toMatch(/on= doesn't run from a field of several lines/);
  });

  it(`keeps lines between 1 and ${MAX_INPUT_LINES}`, () => {
    const ui = render(`state n=""\ninput "Note" bind=n lines=99\ninput "One" bind=n lines=0\n`, { width: 600 });
    const [big, one] = ui.findAll("input").map((f) => f.box!.h);
    expect(big).toBeLessThan(MAX_INPUT_LINES * 30 + 60);
    expect(one).toBeLessThan(80);
  });

  it("streams: every prefix parses", () => {
    const lines = FORM.split("\n");
    for (let i = 1; i <= lines.length; i++) {
      const ui = render(lines.slice(0, i).join("\n") + "\n", { width: 400 });
      expect(ui.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      ui.destroy();
    }
  });
});
