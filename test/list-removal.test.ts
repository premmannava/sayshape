/**
 * remove:t on the items of a worked-out list, and group()'s order. Items of filter, sort, search,
 * take and slice are the items in state themselves, so remove:t finds them there (findItem, by
 * identity) and removes them from the list they came from. Items made by extend, map, rank and group
 * are new, so removing one warns and says to remove from the source list instead.
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/expr";
import { Store } from "../src/state";
import { render } from "../src/testing";
import type { Value } from "../src/types";

const TASKS = `state tasks=[{text: "Pay rent", done: true}, {text: "Call Sam", done: false}, {text: "Book flights", done: true}, {text: "Water plants", done: true}]`;
const texts = (ui: ReturnType<typeof render>) => (ui.state.tasks as unknown as Array<{ text: string }>).map((t) => t.text);

describe("remove:t on a filtered and sorted each", () => {
  it("removes the item from the original list, whichever copy is pressed", () => {
    const ui = render(`${TASKS}\neach items={sort(filter(tasks, 'done'), 'text')} as=t\n  button "Delete {t.text}" on=remove:t`);
    // Shown as Book flights, Pay rent, Water plants: the second copy is the first task.
    ui.press({ type: "button", text: "Delete Pay rent" });
    expect(texts(ui)).toEqual(["Call Sam", "Book flights", "Water plants"]);
    ui.press({ type: "button", text: "Delete Water plants" });
    expect(texts(ui)).toEqual(["Call Sam", "Book flights"]);
    expect(ui.text()).not.toContain("Delete Call Sam");
    expect(ui.warnings).toEqual([]);
  });

  it("does the same through a derive, search, take and slice", () => {
    for (const items of ["shown", "{take(sort(tasks, 'text', 'desc'), 2)}", "{search(tasks, 'text', 'a')}", "{slice(filter(tasks, 'done'), 1, 3)}"]) {
      const ui = render(`${TASKS}\nderive shown={sort(filter(tasks, 'done'), 'text', 'desc')}\neach items=${items} as=t\n  button "Delete {t.text}" on=remove:t`);
      ui.press({ type: "button", text: "Delete Water plants" });
      expect(texts(ui), items).toEqual(["Pay rent", "Call Sam", "Book flights"]);
      expect(ui.warnings, items).toEqual([]);
    }
  });

  it("removes only one of two equal-looking items: the one pressed", () => {
    const ui = render(`state xs=[{n: "a"}, {n: "a"}, {n: "b"}]\neach items={filter(xs, 'n', 'a')} as=x index=i\n  button "Delete {i}" on=remove:x`);
    ui.press({ type: "button", text: "Delete 1" });
    expect((ui.state.xs as unknown as unknown[]).length).toBe(2);
  });
});

describe("remove:t on items an expression made", () => {
  const SOURCE = "Remove from the source list instead: loop over it (each items=tasks as=t, with if= to hide items) or over filter() or sort() of it, which keep items removable";

  it("warns, through a derive, that they aren't in a list, and what to do instead", () => {
    const ui = render(`${TASKS}\nderive rows={extend(tasks, 'q', {short: len(q.text) < 9})}\neach items=rows as=t\n  button "Delete {t.text}" on=remove:t`);
    ui.press({ type: "button", text: "Delete Pay rent" });
    expect(texts(ui)).toHaveLength(4);
    expect(ui.warnings).toEqual([`Can't do remove:t: rows is derived (derive rows on line 2), and its items were made by the expression (extend, map, rank and group make new ones), so they aren't in any list in state. ${SOURCE}`]);
  });

  it("warns the same for map(), rank() and group() written in items=", () => {
    for (const items of ["{map(tasks, 'q', {text: q.text})}", "{rank(tasks, 'text')}", "{group(tasks, 'text')}"]) {
      const ui = render(`${TASKS}\neach items=${items} as=t\n  button "Delete {t.text}" on=remove:t`);
      ui.press({ type: "button", text: "Delete Pay rent" });
      expect(texts(ui), items).toHaveLength(4);
      expect(ui.warnings, items).toEqual([`Can't do remove:t: t was made by an expression (extend, map, rank and group make new items), so it isn't in any list in state. ${SOURCE}`]);
    }
  });

  it("keeps the old message for something that isn't an item at all", () => {
    const ui = render(`state n=1\nbutton "b" on=remove:n`);
    ui.press({ type: "button", text: "b" });
    expect(ui.warnings[0]).toMatch(/^remove:n needs n to be an item of a list in state/);
  });
});

describe("group()", () => {
  it("keeps the order in which each group first appears", () => {
    const store = new Store();
    const months = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
    // Out of order and repeated, as rows of sales come: each month still comes where it first appears.
    const sales = ["Jun", "Jul", "Jun", "Aug", "Sep", "Jul", "Oct", "Nov", "Sep", "Nov"].map((month, i) => ({ month, amount: 10 + i }));
    store.set("sales", sales as unknown as Value);
    const r = evaluate("pluck(group(sales, 'month', 'amount'), 'month')", store.scope);
    expect(r.ok && [...(r.value as unknown as string[])]).toEqual(months);
    const later = evaluate("pluck(group(sales, 'month'), 'month')", store.scope);
    expect(later.ok && [...(later.value as unknown as string[])]).toEqual(months);
  });
});
