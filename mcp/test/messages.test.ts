import { describe, expect, it } from "vitest";
import { eventDelivery, eventMessage, nextChunk, visibleMessage, MAX_MESSAGE_CHARS, MAX_VISIBLE_CHARS } from "../src/ui/messages";

describe("view helpers", () => {
  it("describes an emitted action with its value and the interface's state", () => {
    const m = eventMessage("submit_order", "large", { size: "large", qty: 2 });
    expect(m).toBe('[SayShape interface] I pressed "submit_order" with the value "large".\nCurrent values in the interface: {"size":"large","qty":2}');
  });

  it("leaves out the value when there is none", () => {
    expect(eventMessage("refresh", undefined, {})).toMatch(/^\[SayShape interface\] I pressed "refresh"\.\n/);
  });

  it("caps long messages", () => {
    const state = { rows: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `row ${i}` })) };
    const m = eventMessage("save", undefined, state as never);
    expect(m.length).toBe(MAX_MESSAGE_CHARS);
    expect(m.endsWith("…")).toBe(true);
  });

  it("shows the action in plain words, with no tags or JSON", () => {
    expect(visibleMessage("confirm_laptop", undefined)).toBe("Confirm laptop");
    expect(visibleMessage("submitOrder", "large")).toBe("Submit order: large");
    expect(visibleMessage("plan-trip", 3)).toBe("Plan trip: 3");
    expect(visibleMessage("approve", true)).toBe("Approve: true");
    expect(visibleMessage("pick_size", { size: "L" } as never)).toBe("Pick size");
    expect(visibleMessage("choose", ["a", "b"] as never)).toBe("Choose");
    expect(visibleMessage("laptop", "Laptop")).toBe("Laptop");
    expect(visibleMessage("go", "x".repeat(300)).length).toBe(MAX_VISIBLE_CHARS);
    for (const m of [visibleMessage("confirm_laptop", "Laptop"), visibleMessage("save", 1)]) {
      expect(m).not.toMatch(/\[SayShape interface\]|[{}"]/);
    }
  });

  it("sends the details as context and a short line as the message when the client takes both", () => {
    const state = { product: "laptop", price: 1200 };
    const d = eventDelivery({ message: true, updateModelContext: true }, "confirm_laptop", undefined, state);
    expect(d).toEqual({ context: eventMessage("confirm_laptop", undefined, state), message: "Confirm laptop" });
    expect(d!.context).toContain('"price":1200');
  });

  it("falls back so the model always gets the values", () => {
    const state = { qty: 2 };
    expect(eventDelivery({ message: true }, "save", undefined, state)).toEqual({ message: eventMessage("save", undefined, state) });
    expect(eventDelivery({ updateModelContext: true }, "save", undefined, state)).toEqual({ context: eventMessage("save", undefined, state) });
    expect(eventDelivery({}, "save", undefined, state)).toBeNull();
  });

  it("appends to a growing stream and restarts when the text changes", () => {
    expect(nextChunk("", "card\n")).toEqual({ restart: false, add: "card\n" });
    expect(nextChunk("card\n", "card\n  text \"a\"\n")).toEqual({ restart: false, add: '  text "a"\n' });
    expect(nextChunk("card\n  tex", "column\n")).toEqual({ restart: true, add: "column\n" });
    expect(nextChunk("card\n", "card\n")).toEqual({ restart: false, add: "" });
  });
});
