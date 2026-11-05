import { describe, expect, it } from "vitest";
import { render } from "../src/testing";

const shop = `state qty=1
screen name=catalog title="Shop"
  text "Trail socks"
  button "View" on=go:product
screen name=product title="Trail socks"
  stepper "Qty" bind=qty min=1
  button "Add to cart" on=go:cart
  button "Back" variant=secondary on=back
screen name=cart title="Cart"
  text "{qty} in your cart, on the {screen} screen"
  button "Keep shopping" on=back
`;

describe("screens", () => {
  it("shows only the first screen at first", () => {
    const ui = render(shop);
    expect(ui.state.screen).toBe("catalog");
    expect(ui.text()).toEqual(["Shop", "Trail socks", "View"]);
    expect(ui.sayshape.screens).toEqual(["catalog", "product", "cart"]);
  });

  it("moves forward with go: and back with back, remembering the way", () => {
    const ui = render(shop);
    ui.press({ text: "View" });
    expect(ui.sayshape.currentScreen).toBe("product");
    ui.press({ text: "Add to cart" });
    expect(ui.text()).toContain("1 in your cart, on the cart screen");
    ui.press({ text: "Keep shopping" });
    expect(ui.sayshape.currentScreen).toBe("product");
    ui.press({ text: "Back" });
    expect(ui.sayshape.currentScreen).toBe("catalog");
    expect(ui.sayshape.canGoBack).toBe(false);
  });

  it("keeps state across screens", () => {
    const ui = render(shop);
    ui.press({ text: "View" });
    ui.tab(); // minus is disabled at the minimum, so the first stop is plus
    ui.key("Enter");
    ui.press({ text: "Add to cart" });
    expect(ui.text()).toContain("2 in your cart, on the cart screen");
  });

  it("reports each move to the host", () => {
    const ui = render(shop);
    const moves: string[] = [];
    ui.sayshape.on("navigate", (e) => moves.push(`${e.from}→${e.screen}`));
    ui.press({ text: "View" });
    ui.press({ text: "Back" });
    expect(moves).toEqual(["catalog→product", "product→catalog"]);
  });

  it("ignores go: to a screen that doesn't exist, and back on the first screen", () => {
    const ui = render(`screen name=a\n  button "Nowhere" on=go:missing\n  button "Back" on=back\nscreen name=b\n  text "B"\n`);
    ui.press({ text: "Nowhere" });
    ui.press({ text: "Back" });
    expect(ui.sayshape.currentScreen).toBe("a");
  });

  it("only lays out, paints and focuses the visible screen", () => {
    const ui = render(shop);
    expect(ui.find({ text: "Add to cart" }).box).toBeNull();
    expect(ui.hits.map((h) => h.box.node.text)).toEqual(["View"]);
    ui.tab();
    ui.tab();
    expect(ui.focused).toBeNull();
  });

  it("drops focus when the screen changes", () => {
    const ui = render(shop);
    ui.tab();
    ui.key("Enter");
    expect(ui.sayshape.currentScreen).toBe("product");
    expect(ui.focused).toBeNull();
  });

  it("can be moved by the host", () => {
    const ui = render(shop);
    ui.sayshape.go("cart");
    ui.sayshape.renderNow();
    expect(ui.sayshape.currentScreen).toBe("cart");
    ui.sayshape.back();
    expect(ui.sayshape.currentScreen).toBe("catalog");
  });

  it("only allows screens at the top level, with plain names", () => {
    const r = render(`card\n  screen name=a\nscreen name="two words"\n`);
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/only goes inside root/),
      expect.stringMatching(/name should be a plain name/),
    ]);
  });

  it("streams: the first screen shows as soon as it arrives and stays put", () => {
    const ui = render("");
    ui.sayshape.beginStream();
    let sawCatalog = false;
    for (const line of shop.split(/(?<=\n)/)) {
      ui.sayshape.push(line);
      ui.sayshape.renderNow();
      if (ui.sayshape.screens.length) {
        expect(ui.sayshape.currentScreen).toBe("catalog");
        sawCatalog = true;
      }
    }
    ui.sayshape.endStream();
    ui.sayshape.renderNow();
    expect(sawCatalog).toBe(true);
    expect(ui.sayshape.currentScreen).toBe("catalog");
  });

  it("forgets history when state is reset", () => {
    const ui = render(shop);
    ui.press({ text: "View" });
    ui.setSpec(shop, { resetState: true });
    expect(ui.sayshape.currentScreen).toBe("catalog");
    expect(ui.sayshape.canGoBack).toBe(false);
  });
});
