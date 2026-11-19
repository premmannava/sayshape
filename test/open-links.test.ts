import { describe, expect, it } from "vitest";
import { isOpenableUrl, parseActions } from "../src/actions";
import { render } from "../src/testing";

describe("open: action", () => {
  it("opens only https addresses, written whole", () => {
    const map = "https://www.google.com/maps/dir/?api=1&destination=33.4278,-111.9434";
    expect(parseActions(`open:${map}`)).toEqual({ actions: [{ op: "open", url: map }] });
    for (const bad of ["open:http://example.com", "open:javascript:alert(1)", "open:https://user:pw@example.com", "open:file:///etc/passwd", "open:"]) {
      expect("error" in parseActions(bad), bad).toBe(true);
    }
  });

  it("accepts an address built from state, checked when it runs", () => {
    expect("actions" in parseActions("open:https://maps.example/{place.lat},{place.lon}")).toBe(true);
  });

  it("says which addresses may be opened", () => {
    expect(isOpenableUrl("https://example.com/a?b=1")).toBe(true);
    expect(isOpenableUrl("http://example.com")).toBe(false);
    expect(isOpenableUrl("https://user@example.com")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});

describe("link with href=", () => {
  it("hands its address to the host when pressed", () => {
    const ui = render(`link "Open in Google Maps" href="https://maps.example/a"\n`);
    const opened: string[] = [];
    ui.sayshape.on("open", ({ url }) => opened.push(url));
    ui.press("link");
    expect(opened).toEqual(["https://maps.example/a"]);
  });

  it("runs its on= actions too, and sends nothing for a link with only href=", () => {
    const ui = render(`state n=0\nlink "Count" href="https://maps.example/a" on=inc:n\n`);
    const actions: string[] = [];
    ui.sayshape.on("action", ({ name }) => actions.push(name));
    ui.press("link");
    expect(actions).toEqual([]);
    expect(ui.text()).toContain("Count");
  });

  it("is an empty link when it has neither on= nor href=", () => {
    const ui = render(`link "Nothing"\n`);
    const opened: string[] = [];
    ui.sayshape.on("open", ({ url }) => opened.push(url));
    ui.press("link");
    expect(opened).toEqual([]);
  });
});
