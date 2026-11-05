import { describe, expect, it } from "vitest";
import { coreComponents, Registry } from "../src/index";
import { render } from "../src/testing";
import { connectedSpec, validateConnectedBody } from "../playground/connected-order/generation";
import { orderBody } from "../playground/connected-order/spec";
import { connectOrderDemo } from "../playground/connected-order/host";
import { createDemoService } from "../playground/connected-order/service";
const registry = new Registry(coreComponents);
describe("generated interface host contract", () => {
  it("accepts a connected body and rejects host-data replacement or writes", () => {
    expect(validateConnectedBody(orderBody, registry)).toEqual([]);
    expect(validateConnectedBody('state equipment=[]\n' + orderBody, registry)).not.toEqual([]);
    expect(validateConnectedBody(orderBody.replace('on=emit:submit_order', 'on="set:message:Success"'), registry)).not.toEqual([]);
    expect(validateConnectedBody(orderBody.replace('bind=quantity', 'bind=equipment'), registry)).not.toEqual([]);
    expect(validateConnectedBody(orderBody.replace('items=visible', 'items=[]'), registry)).not.toEqual([]);
  });
  it("preserves service data across interface replacement and still submits orders", async () => {
    const ui = render(connectedSpec(orderBody));
    const service = createDemoService(0, "2026-10-21");
    const host = connectOrderDemo(ui.sayshape, service);
    await host.load();
    ui.sayshape.state.set("selected", "monitor");
    ui.sayshape.state.set("quantity", 2);
    ui.sayshape.state.set("delivery", "2026-11-10");
    ui.sayshape.setSpec(connectedSpec(orderBody.replace("Equipment desk", "Generated catalog")));
    ui.sayshape.renderNow();
    expect(ui.sayshape.diagnostics).toEqual([]);
    expect(ui.sayshape.state.get("selected")).toBe("monitor");
    expect(ui.sayshape.state.get("equipment")).toHaveLength(6);
    await host.submit();
    expect(await service.orders()).toMatchObject([{ name: "Monitor", quantity: 2, total: 756 }]);
    host.dispose(); ui.sayshape.destroy();
  });
});
