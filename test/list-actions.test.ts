/**
 * Lists in chat: inside a card a list is only its row lines (the card is the frame), and an
 * icon-only button in a list-item sits at the row's right end, on the title's line, instead of
 * under the title, so a row with a remove button stays one line.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { lightTheme } from "../src/theme";

const ITEMS = `state items=[{id: 1, name: "Groceries", cat: "Food", amount: 142}, {id: 2, name: "Gas", cat: "Travel", amount: 58}, {id: 3, name: "Dinner out", cat: "Food", amount: 86}]`;
const ROWS = `each items=items as=e
      list-item "{e.name}" detail="{e.cat}" trailing="\${e.amount}"
        button icon=trash label="Remove {e.name}" variant=secondary size=sm on=remove:e`;
const IN_CARD = `${ITEMS}
card variant=outline
  text "Recent" weight=semibold
  list
    ${ROWS}`;
const ON_PAGE = `${ITEMS}
list
  ${ROWS.replace(/^ {2}/gm, "")}`;

type UI = ReturnType<typeof render>;
const boxOf = (ui: UI, q: Parameters<UI["find"]>[0]) => ui.find(q).box!;
/** The nth remove button (each copy shares the spec line). */
const trashOf = (ui: UI, n: number) => ui.findAll({ type: "button" })[n]!.box!;

describe("a list inside a card", () => {
  it("draws no panel of its own, only the lines between rows", () => {
    const inCard = render(IN_CARD, { width: 600 });
    const onPage = render(ON_PAGE, { width: 600 });
    // Raised fills: the list's own panel and the three buttons. An outline card has none of its own.
    const raised = (ui: UI) => ui.drawOps.filter((o) => o.op === "fill" && o.fillStyle === lightTheme.colors.raised).length;
    expect(raised(inCard)).toBe(3);
    expect(raised(onPage)).toBe(4);
    // Two separators for three rows, either way.
    const lines = (ui: UI) => ui.drawOps.filter((o) => o.op === "fillRect" && (o.args[3] as number) === 1).length;
    expect(lines(inCard)).toBe(2);
  });
});

describe("an icon-only button in a list-item", () => {
  it("sits at the row's right end, level with the title, so the row stays one line", () => {
    const ui = render(IN_CARD, { width: 600 });
    const row = boxOf(ui, { type: "list-item", text: "Groceries" });
    const trash = trashOf(ui, 0);
    // At the right end, inside the row.
    expect(trash.x + trash.w).toBeGreaterThan(row.x + row.w - 40);
    expect(trash.x + trash.w).toBeLessThanOrEqual(row.x + row.w);
    // In the row's middle, not under the title.
    expect(Math.abs(trash.y + trash.h / 2 - (row.y + row.h / 2))).toBeLessThan(1);
    // No taller than the same row without the button: it takes no line of its own.
    const plain = render(IN_CARD.replace(/\n\s*button icon=trash[^\n]*/, ""), { width: 600 });
    expect(row.h).toBe(boxOf(plain, { type: "list-item", text: "Groceries" }).h);
    // The amount sits to the left of the button.
    const amount = ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === "$142");
    expect(amount).toBeDefined();
    expect(amount!.args[1] as number).toBeLessThan(trash.x);
  });

  it("still removes its item, and screen readers still name it", () => {
    const ui = render(IN_CARD, { width: 600 });
    ui.press({ id: ui.findAll({ type: "button" })[1]!.node.id });
    expect((ui.state.items as unknown as unknown[]).length).toBe(2);
    const names: string[] = [];
    const walk = (n: ReturnType<UI["accessibility"]>) => { if (n.role === "button" && n.name) names.push(n.name); n.children.forEach(walk); };
    walk(ui.accessibility({ full: true }));
    expect(names).toContain("Remove Groceries");
  });

  it("is a 44 px target on a phone, and the row grows to hold it", () => {
    const ui = render(IN_CARD, { width: 360 });
    const row = boxOf(ui, { type: "list-item", text: "Groceries" });
    const trash = trashOf(ui, 0);
    expect(trash.w).toBeGreaterThanOrEqual(44);
    expect(trash.y).toBeGreaterThanOrEqual(row.y);
    expect(trash.y + trash.h).toBeLessThanOrEqual(row.y + row.h);
  });

  it("leaves a button with text under the title, as before", () => {
    const ui = render(`list\n  list-item "Order 1042" detail="Shipped"\n    button "Track" size=sm`, { width: 600 });
    const row = boxOf(ui, { type: "list-item", text: "Order 1042" });
    const track = boxOf(ui, { type: "button", text: "Track" });
    expect(track.x).toBeLessThan(row.x + 40);
    expect(track.y).toBeGreaterThan(row.y + 20);
  });
});

describe("in a chat", () => {
  it("keeps name, category, amount and the remove button on one line", () => {
    const ui = render(IN_CARD, { width: 600, context: "chat" });
    const row = boxOf(ui, { type: "list-item", text: "Groceries" });
    const trash = trashOf(ui, 0);
    // The first row's words ("Food" is in two rows; its first is this one's).
    const first = (t: string) => ui.drawOps.find((o) => o.op === "fillText" && o.args[0] === t)!;
    const ys = ["Groceries", "Food", "$142"].map((t) => Math.round(first(t).args[2] as number));
    expect(new Set(ys).size).toBe(1);
    // The row is one line tall: no more than the button and its room, or the text line.
    expect(row.h).toBeLessThanOrEqual(Math.max(trash.h + 8, 48));
  });
});

describe("in a narrow row", () => {
  it("puts the button under the title rather than break a word of it", () => {
    const narrow = `list\n  list-item "Groceries" detail="Food" trailing="$142.00"\n    button icon=trash label="Remove Groceries" variant=secondary size=sm`;
    const ui = render(narrow, { width: 150 });
    const row = boxOf(ui, { type: "list-item", text: "Groceries" });
    const trash = ui.findAll({ type: "button" })[0]!.box!;
    // The title is drawn whole, on one line.
    expect(ui.drawOps.some((o) => o.op === "fillText" && o.args[0] === "Groceries")).toBe(true);
    // And the button sits under it, at the left, as before.
    expect(trash.x).toBeLessThan(row.x + 40);
    expect(trash.y).toBeGreaterThan(row.y + 20);
  });
});

describe("a list where one row is too narrow", () => {
  it("puts every row's button under its title, so they line up", () => {
    const ui = render(`list
  list-item "Groceries" detail="Food" trailing="$142.00"
    button icon=trash label="Remove Groceries" variant=secondary size=sm
  list-item "Gas" detail="Travel" trailing="$58.00"
    button icon=trash label="Remove Gas" variant=secondary size=sm`, { width: 150 });
    const [a, b] = ui.findAll({ type: "button" }).map((f) => f.box!);
    const rows = ui.findAll({ type: "list-item" }).map((f) => f.box!);
    expect(a!.x).toBe(b!.x);
    expect(b!.y).toBeGreaterThan(rows[1]!.y + 20);
  });
});
