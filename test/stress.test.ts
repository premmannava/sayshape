import { describe, expect, it } from "vitest";
import { score } from "../eval/compare/run";
import { stressReference, stressTasks } from "../eval/compare/stress";

describe("stress tasks", () => {
  it("has a reference answer for every task", () => {
    expect(Object.keys(stressReference).sort()).toEqual(stressTasks.map((t) => t.id).sort());
  });

  for (const task of stressTasks) {
    it(`${task.id}: the SayShape reference passes every check`, async () => {
      const s = await score("sayshape", task, stressReference[task.id]!);
      expect(s.problems).toEqual([]);
      expect(s.checks.filter((c) => !c.passed)).toEqual([]);
    });
  }
});
