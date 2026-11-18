/**
 * Checking a form on submit: button validate=true shows every pending problem in its card
 * (required=, error=, kind=) and runs on= only when there are none; check required= and error=.
 * The sign-up form is test/fixtures/sign-up.sayshape.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const SIGN_UP = readFileSync(new URL("./fixtures/sign-up.sayshape", import.meta.url), "utf8");

type UI = ReturnType<typeof render>;
/** Text drawn in the bad color: the messages under fields. */
const problems = (ui: UI) => ui.drawOps.filter((o) => o.op === "fillText" && o.fillStyle === lightTheme.colors.bad).map((o) => String(o.args[0]));
const create = { type: "button", text: "Create account" } as const;
const terms = { type: "check", text: "I accept the terms" } as const;

/** Fill every field of the sign-up form correctly, except what's left out. */
function fill(ui: UI, skip: string[] = []): void {
  const fields: [string, string][] = [["Name", "Ana"], ["Email", "ana@example.com"], ["Password", "correct horse"], ["Confirm password", "correct horse"]];
  for (const [label, text] of fields) if (!skip.includes(label)) ui.type({ type: "input", text: label }, text);
  ui.key("Escape");
  if (!skip.includes("terms")) ui.press(terms);
}

describe("check required= and error=", () => {
  it("parses the sign-up form with no problems", () => {
    expect(render(SIGN_UP).diagnostics).toEqual([]);
  });

  it("says nothing about the terms until the box has been toggled", () => {
    const ui = render(SIGN_UP, { width: 600 });
    expect(problems(ui)).toEqual([]);
    ui.press(terms);
    expect(ui.state.terms).toBe(true);
    expect(problems(ui)).toEqual([]);
    ui.press(terms);
    expect(problems(ui)).toEqual(["Accept the terms to continue"]);
  });

  it("hides the message when the value is written from elsewhere, as input does (a form cleared after sending)", () => {
    const ui = render(SIGN_UP, { width: 600 });
    ui.press(terms);
    ui.set("terms", false);
    expect(problems(ui)).toEqual([]);
  });

  it("says Required without error=, and shows a plain error= while it isn't empty", () => {
    const ui = render(`state a=true b=false\ncheck "Keep me posted" bind=a required=true\ncheck "Gift wrap" bind=b error="{b ? 'Not for this item' : ''}"\n`, { width: 400 });
    ui.press({ type: "check", text: "Keep me posted" });
    expect(problems(ui)).toEqual(["Required"]);
    ui.press({ type: "check", text: "Gift wrap" });
    expect(problems(ui)).toEqual(["Required", "Not for this item"]);
  });

  it("tells screen readers it's required, and what's wrong once it shows", () => {
    const ui = render(SIGN_UP, { width: 600 });
    const node = () => ui.accessibility({ full: true });
    const find = (n: ReturnType<typeof node>): ReturnType<typeof node> | undefined => n.role === "checkbox" ? n : n.children.map(find).find(Boolean);
    expect(find(node())).toMatchObject({ name: "I accept the terms", required: true });
    expect(find(node())?.invalid).toBeFalsy();
    ui.press(terms);
    ui.press(terms);
    expect(find(node())).toMatchObject({ invalid: true, description: "Accept the terms to continue" });
  });

  it("takes room for its message, so nothing below overlaps it", () => {
    const ui = render(SIGN_UP, { width: 320 });
    const box = (q: Parameters<UI["find"]>[0]) => ui.find(q).box!;
    const before = box(terms).h;
    ui.press(terms);
    ui.press(terms);
    expect(box(terms).h).toBeGreaterThan(before);
    expect(box(create).y).toBeGreaterThanOrEqual(box(terms).y + box(terms).h);
  });
});

describe("button validate=true", () => {
  it("shows every problem in its card and emits nothing while any is left", () => {
    const ui = render(SIGN_UP, { width: 600 });
    ui.press(create);
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Required", "Required", "Required", "Required", "Accept the terms to continue"]);
  });

  it("emits once everything is valid", () => {
    const ui = render(SIGN_UP, { width: 600 });
    fill(ui);
    ui.press(create);
    expect(ui.emitted.map((e) => e.name)).toEqual(["signup"]);
    expect(problems(ui)).toEqual([]);
  });

  it("holds back while one field is wrong, and names it", () => {
    const ui = render(SIGN_UP, { width: 600 });
    fill(ui, ["terms"]);
    ui.type({ type: "input", text: "Password" }, "short", { replace: true });
    ui.key("Escape");
    ui.press(create);
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["At least 8 characters", "The passwords differ", "Accept the terms to continue"]);
    ui.press(terms);
    ui.type({ type: "input", text: "Password" }, "correct horse", { replace: true });
    ui.key("Escape");
    ui.press(create);
    expect(ui.emitted.map((e) => e.name)).toEqual(["signup"]);
  });

  it("checks an email's form too", () => {
    const ui = render(SIGN_UP, { width: 600 });
    fill(ui, ["Email"]);
    ui.type({ type: "input", text: "Email" }, "ana@");
    ui.key("Escape");
    ui.press(create);
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Enter an email like name@example.com"]);
  });

  it("moves focus to the first wrong field and announces it", () => {
    const ui = render(SIGN_UP, { width: 600 });
    fill(ui, ["Email"]);
    ui.press(create);
    expect(ui.focused?.props.bind).toBe("email");
    expect(ui.editor?.problem).toBe("Required");
    expect(ui.announcements.at(-1)?.text).toBe("Email: Required");
  });

  it("counts the fields that need attention when there are several", () => {
    const ui = render(SIGN_UP, { width: 600 });
    ui.press(create);
    expect(ui.focused?.props.bind).toBe("name");
    expect(ui.announcements.at(-1)?.text).toBe("5 fields need attention. Name: Required");
  });

  it("focuses a checkbox when it's the first wrong field", () => {
    const ui = render(SIGN_UP, { width: 600 });
    fill(ui, ["terms"]);
    ui.press(create);
    expect(ui.focused?.type).toBe("check");
    expect(ui.announcements.at(-1)?.text).toBe("I accept the terms: Accept the terms to continue");
  });

  it("works from the keyboard: Enter and Space on the button", () => {
    for (const key of ["Enter", " "]) {
      const ui = render(SIGN_UP, { width: 600 });
      fill(ui, ["terms"]);
      ui.tab(); // wherever focus is, move it to the button
      while (ui.focused?.type !== "button") ui.tab();
      ui.key(key);
      expect(ui.emitted).toEqual([]);
      expect(problems(ui)).toEqual(["Accept the terms to continue"]);
      expect(ui.focused?.type).toBe("check");
      ui.key(" ");
      expect(ui.state.terms).toBe(true);
      while (ui.focused?.type !== "button") ui.tab();
      ui.key(key);
      expect(ui.emitted.map((e) => e.name)).toEqual(["signup"]);
    }
  });

  it("checks only its own card", () => {
    const spec = `state a="" b=""
card
  input "A" bind=a required=true
  button "Save A" validate=true on=emit:a
card
  input "B" bind=b required=true
  button "Save B" validate=true on=emit:b
`;
    const ui = render(spec, { width: 600 });
    ui.type({ type: "input", text: "A" }, "x");
    ui.key("Escape");
    ui.press({ type: "button", text: "Save A" });
    expect(ui.emitted.map((e) => e.name)).toEqual(["a"]);
    expect(problems(ui)).toEqual([]);
  });

  it("checks the whole screen when there's no card", () => {
    const ui = render(`state a=""\ninput "A" bind=a required=true\nbutton "Save" validate=true on=emit:save\n`, { width: 600 });
    ui.press({ type: "button", text: "Save" });
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Required"]);
  });

  it("checks fields inside each and shown if blocks, and not hidden ones", () => {
    const spec = `state guests=[{name: ""}, {name: "Bo"}] company=false org="" extra=false note=""
card
  each items=guests as=g
    input "Guest name" bind=g.name required=true
  check "Booking for a company" bind=company
  if={company}
    input "Company" bind=org required=true
  if={extra}
    input "Note" bind=note required=true
  button "Book" validate=true on=emit:book
`;
    const ui = render(spec, { width: 600 });
    ui.press({ type: "button", text: "Book" });
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Required"]);
    ui.type({ id: ui.findAll({ type: "input", text: "Guest name" })[0]!.node.id }, "Ana");
    ui.key("Escape");
    ui.press({ type: "check", text: "Booking for a company" });
    ui.press({ type: "button", text: "Book" });
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Required"]);
    expect(ui.focused?.props.bind).toBe("org");
    ui.type({ type: "input", text: "Company" }, "Acme");
    ui.key("Escape");
    ui.press({ type: "button", text: "Book" });
    expect(ui.emitted.map((e) => e.name)).toEqual(["book"]);
  });

  it("doesn't let a disabled field block", () => {
    const ui = render(`state a="" locked=true\ncard\n  input "A" bind=a required=true disabled={locked}\n  button "Go" validate=true on=emit:go\n`, { width: 600 });
    ui.press({ type: "button", text: "Go" });
    expect(ui.emitted.map((e) => e.name)).toEqual(["go"]);
  });

  it("checks inside an open dialog", () => {
    const spec = `state open=true a=""
dialog "Rename" bind=open
  input "Name" bind=a required=true
  button "Save" validate=true on=emit:save
`;
    const ui = render(spec, { width: 600 });
    ui.press({ type: "button", text: "Save" });
    expect(ui.emitted).toEqual([]);
    expect(problems(ui)).toEqual(["Required"]);
  });
});

describe("buttons without validate=", () => {
  it("run on= as before, whatever the fields hold", () => {
    const spec = SIGN_UP.replace(" validate=true", "");
    const ui = render(spec, { width: 600 });
    ui.press(create);
    expect(ui.emitted.map((e) => e.name)).toEqual(["signup"]);
    expect(problems(ui)).toEqual([]);
    expect(ui.announcements).toEqual([]);
  });

  it("run on= from Enter and Space as before", () => {
    const ui = render(`state n=0\nbutton "Add" on=inc:n\n`, { width: 600 });
    ui.tab();
    ui.key("Enter");
    ui.key(" ");
    expect(ui.state.n).toBe(2);
  });
});
