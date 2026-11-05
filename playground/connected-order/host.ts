import type { SayShape } from "../../src/index";
import { createDemoService } from "./service";

/** Host adapter: SayShape emits intent; this code calls the service and returns state. */
export function connectOrderDemo(sayshape: SayShape, service = createDemoService()) {
  let busy = false;
  let disposed = false;
  const events: string[] = [];
  const log = (message: string) => {
    events.unshift(message);
    sayshape.state.set("events", events.slice(0, 12));
  };
  const refresh = async () => {
    const equipment = await service.catalog();
    if (!disposed) sayshape.state.set("equipment", equipment);
  };
  async function load() {
    if (busy || disposed) return;
    busy = true;
    sayshape.state.set("loading", true);
    sayshape.state.set("message", "Loading equipment from the demo service…");
    log("HOST → SERVICE: load catalog");
    try {
      await refresh();
      if (disposed) return;
      log("SERVICE → SAYSHAPE: catalog loaded into equipment state");
      sayshape.state.set("message", "Catalog ready. Select equipment and a delivery date.");
    } catch {
      if (!disposed) sayshape.state.set("message", "Catalog could not be loaded. Try Refresh catalog.");
    } finally {
      busy = false;
      if (!disposed) sayshape.state.set("loading", false);
    }
  }
  async function submit() {
    if (busy || disposed) return;
    busy = true;
    // Snapshot the request so later edits cannot change an in-flight order.
    const request = { equipmentId: sayshape.state.get("selected"), quantity: sayshape.state.get("quantity"), deliveryDate: sayshape.state.get("delivery") };
    const fail = sayshape.state.get("simulateFailure") === true;
    sayshape.state.set("submitting", true);
    sayshape.state.set("message", "Submitting your request…");
    log(`SAYSHAPE → HOST: submit_order (${String(request.equipmentId)}, quantity ${String(request.quantity)})`);
    try {
      const order = await service.submit(request, fail);
      if (disposed) return;
      sayshape.state.set("orders", await service.orders());
      await refresh();
      if (disposed) return;
      sayshape.state.set("message", `${order.id} accepted — ${order.quantity} × ${order.name}, delivery ${order.deliveryDate}.`);
      log(`SERVICE → SAYSHAPE: ${order.id} accepted; orders and stock updated`);
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : "Submission failed. Please retry.";
      sayshape.state.set("message", message);
      log(`SERVICE → SAYSHAPE: ${message}`);
    } finally {
      busy = false;
      if (!disposed) sayshape.state.set("submitting", false);
    }
  }
  sayshape.state.set("earliest", service.earliest);
  sayshape.state.set("latest", service.latest);
  const unsubscribe = sayshape.on("action", ({ name }) => {
    if (name === "submit_order") void submit();
    if (name === "refresh_catalog") void load();
  });
  return { load, submit, get busy() { return busy; }, dispose() { disposed = true; unsubscribe(); } };
}
