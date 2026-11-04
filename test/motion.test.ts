import { describe, expect, it } from "vitest";
import { MotionValues } from "../src/motion";

describe("shared canvas motion", () => {
  it("starts from the actual value and only animates later changes", () => {
    const m = new MotionValues(), node = {};
    let frames = 0;
    const frame = () => { frames++; };
    expect(m.value(node, "hover", 0, 0, 200, true, frame)).toBe(0);
    expect(m.value(node, "hover", 1, 100, 200, true, frame)).toBe(0);
    expect(m.value(node, "hover", 1, 200, 200, true, frame)).toBeCloseTo(0.875);
    expect(m.value(node, "hover", 1, 300, 200, true, frame)).toBe(1);
    const done = frames;
    expect(m.value(node, "hover", 1, 500, 200, true, frame)).toBe(1);
    expect(frames).toBe(done);
  });

  it("reverses without jumping when the pointer leaves halfway", () => {
    const m = new MotionValues(), node = {}, frame = () => {};
    m.value(node, "x", 0, 0, 200, true, frame);
    m.value(node, "x", 1, 100, 200, true, frame);
    const mid = m.value(node, "x", 1, 200, 200, true, frame);
    expect(m.value(node, "x", 0, 200, 200, true, frame)).toBeCloseTo(mid);
    expect(m.value(node, "x", 0, 300, 200, true, frame)).toBeLessThan(mid);
    expect(m.value(node, "x", 0, 400, 200, true, frame)).toBe(0);
  });

  it("keeps different nodes and motion channels independent", () => {
    const m = new MotionValues(), a = {}, b = {}, frame = () => {};
    m.value(a, "hover", 0, 0, 200, true, frame);
    m.value(a, "press", 0, 0, 200, true, frame);
    m.value(a, "hover", 1, 0, 200, true, frame);
    expect(m.value(b, "hover", 1, 100, 200, true, frame)).toBe(1);
    expect(m.value(a, "press", 0, 100, 200, true, frame)).toBe(0);
    expect(m.value(a, "hover", 1, 100, 200, true, frame)).toBeGreaterThan(0);
  });

  it("snaps with reduced motion and does not schedule animation frames", () => {
    const m = new MotionValues(), node = {};
    let frames = 0;
    const frame = () => { frames++; };
    m.value(node, "position", 0, 0, 240, true, frame);
    expect(m.value(node, "position", 1, 10, 240, false, frame)).toBe(1);
    expect(m.value(node, "position", 0, 20, 240, false, frame)).toBe(0);
    expect(m.value(node, "position", 0, 30, 240, true, frame)).toBe(0);
    expect(frames).toBe(0);
  });

  it("handles non-finite targets and disabled duration", () => {
    const m = new MotionValues(), node = {}, frame = () => {};
    expect(m.value(node, "v", NaN, 0, 200, true, frame)).toBe(0);
    expect(m.value(node, "v", 4, 0, -1, true, frame)).toBe(4);
  });
});
