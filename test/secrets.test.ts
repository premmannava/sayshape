import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { HIDDEN, hideSecrets } from "../src/secrets";
import { eventMessage } from "../mcp/src/ui/messages";

const SIGNUP = `state name="" email="" plan="Pro" terms=false pw="" pw2=""
card
  input "Name" bind=name
  input "Email" bind=email kind=email
  input "Password" bind=pw kind=password
  input "Confirm password" bind=pw2 kind=password
  select "Plan" bind=plan options="Free,Pro"
  check "I accept the terms" bind=terms
  button "Create account" on=emit:signup
`;

describe("passwords stay out of what an emit shares", () => {
  it("a sign-up form shares name, email, plan and terms, but no password or confirmation", () => {
    const ui = render(SIGNUP, { width: 600 });
    ui.type({ type: "input", text: "Name" }, "Ana");
    ui.type({ type: "input", text: "Email" }, "ana@example.com");
    ui.type({ type: "input", text: "Password" }, "Secret123");
    ui.type({ type: "input", text: "Confirm password" }, "Secret123");
    ui.press({ type: "check" });
    ui.press({ type: "button", text: "Create account" });
    expect(ui.emitted).toEqual([{ name: "signup", value: undefined }]);
    expect(ui.state.pw).toBe("Secret123");
    const shared = ui.shareableState;
    expect(shared).toMatchObject({ name: "Ana", email: "ana@example.com", plan: "Pro", terms: true, pw: HIDDEN, pw2: HIDDEN });
    expect(JSON.stringify(shared)).not.toContain("Secret123");
    // The message the MCP view sends the model with the emit.
    expect(eventMessage("signup", undefined, shared)).not.toContain("Secret123");
  });

  it("follows a renamed bind path into a record", () => {
    const ui = render(`state login={user: "", secret: ""}\ninput "User" bind=login.user\ninput "Pass" bind=login.secret kind=password\nbutton "Go" on=emit:go:{login}\n`, { width: 600 });
    ui.type({ type: "input", text: "User" }, "ana");
    ui.type({ type: "input", text: "Pass" }, "hunter22");
    ui.press({ type: "button", text: "Go" });
    expect(ui.shareableState.login).toEqual({ user: "ana", secret: HIDDEN });
    // A record that holds a password is sent with it hidden.
    expect(ui.emitted[0]!.value).toEqual({ user: "ana", secret: HIDDEN });
  });

  it("hides a password field inside each, and a copy of it elsewhere in state", () => {
    const spec = `state accounts=[{name: "a", pw: ""}, {name: "b", pw: ""}] main="" last=""
each items=accounts as=acc
  input "Password for {acc.name}" bind=acc.pw kind=password
input "Main password" bind=main kind=password
button "Save" on=set:last:{main};emit:save
`;
    const ui = render(spec, { width: 600 });
    ui.type({ type: "input", text: "Password for a" }, "first-secret");
    ui.type({ type: "input", text: "Password for b" }, "second-secret");
    ui.type({ type: "input", text: "Main password" }, "main-secret");
    ui.press({ type: "button", text: "Save" });
    expect(ui.state.last).toBe("main-secret");
    const shared = JSON.stringify(ui.shareableState);
    expect(shared).not.toContain("first-secret");
    expect(shared).not.toContain("second-secret");
    expect(shared).not.toContain("main-secret");
    expect(ui.shareableState.accounts).toEqual([{ name: "a", pw: HIDDEN }, { name: "b", pw: HIDDEN }]);
  });

  it("finds password fields on screens not shown and in if blocks", () => {
    const spec = `state pw="abc12345" show=false
screen main
  text "Hi"
screen login
  if {show}
    input "Password" bind=pw kind=password
`;
    expect(render(spec).shareableState.pw).toBe(HIDDEN);
  });

  it("sends a password named as the whole emitted value, on purpose", () => {
    const ui = render(`state pw=""\ninput "Password" bind=pw kind=password\nbutton "Log in" on=emit:login:{pw}\n`, { width: 600 });
    ui.type({ type: "input", text: "Password" }, "on-purpose");
    ui.press({ type: "button", text: "Log in" });
    expect(ui.emitted[0]).toEqual({ name: "login", value: "on-purpose" });
    expect(ui.shareableState.pw).toBe(HIDDEN);
  });

  it("leaves state alone when there's no password, and empty passwords aren't secrets", () => {
    const ui = render(`state a="x" pw=""\ninput "P" bind=pw kind=password\n`);
    expect(ui.shareableState).toEqual({ a: "x", pw: "" });
    expect(hideSecrets("x", new Set())).toBe("x");
  });

  it("keeps a password hidden after it's copied elsewhere and the field cleared", () => {
    const ui = render(`state pw="" tries=[] saved="" copy=""\ninput "Password" bind=pw kind=password\nbutton "Try" on="add:tries:{pw};set:saved:{pw};set:copy:{pw + '!'};set:pw:''"\nbutton "Send" on=emit:send\n`, { width: 600 });
    ui.type({ type: "input", text: "Password" }, "S3cret");
    ui.press({ type: "button", text: "Try" });
    ui.press({ type: "button", text: "Send" });
    expect(ui.state.pw).toBe("");
    const shared = ui.shareableState;
    expect(JSON.stringify(shared)).not.toContain("S3cret");
    expect(shared).toMatchObject({ tries: [HIDDEN], saved: HIDDEN, copy: HIDDEN + "!" });
  });

  it("hides a password named in a notify: message", () => {
    const ui = render(`state pw=""\ninput "Password" bind=pw kind=password\nbutton "Save" on="notify:Saved {pw} for you"\n`, { width: 600 });
    const told: string[] = [];
    ui.sayshape.on("notify", ({ text }) => told.push(text));
    ui.type({ type: "input", text: "Password" }, "S3cret");
    ui.press({ type: "button", text: "Save" });
    expect(told).toEqual([`Saved ${HIDDEN} for you`]);
  });

  it("hides a short password only where it's the whole value", () => {
    expect(hideSecrets("abc", new Set(["abc"]))).toBe(HIDDEN);
    expect(hideSecrets("abcdef", new Set(["abc"]))).toBe("abcdef");
    expect(hideSecrets("my S3cret!", new Set(["S3cret"]))).toBe(`my ${HIDDEN}!`);
  });
});
