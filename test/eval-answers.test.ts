/**
 * The data-question eval (eval/answers.ts) for choosing the landing page's
 * model: every case is accepted by the proxy, a correct answer passes, and
 * wrong or broken ones fail with a reason.
 */
import { describe, expect, it } from "vitest";
import { answerCases, runAnswerCase, score } from "../eval/answers";
import { fakeModel } from "./fake-model";

const config = { url: "http://model.test/v1", model: "test-model" };
const cases = answerCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe("data-question eval", () => {
  it("has a dozen cases with unique ids, each with something to check", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) expect(c.expect.length + (c.expectNumber !== undefined ? 1 : 0), c.id).toBeGreaterThan(0);
  });

  it("passes a correct answer, drawn by the engine with every row", async () => {
    const right = `derive by={sort(group(data, 'country', 'tiv_usd'), 'tiv_usd', 'desc')}
stat label="Total TIV" value="{compact(sum(data, 'tiv_usd'), 'USD')}"
chart "TIV by country" kind=hbar items=by x=country y=tiv_usd format=money
`;
    const m = fakeModel([{ content: [right] }]);
    const r = await runAnswerCase(byId("sov-country"), config, { fetch: m.fetch });
    expect(r).toMatchObject({ pass: true, repaired: false });
    const total = await runAnswerCase(byId("sov-total"), config, { fetch: fakeModel([{ content: [right] }]).fetch });
    expect(total.pass).toBe(true);
  });

  it("fails answers that type numbers, miss the answer or don't parse, saying why", async () => {
    const typed = `stat label="Total TIV" value="$1"\n`;
    const r = await runAnswerCase(byId("sov-country"), config, { fetch: fakeModel([{ content: [typed] }, { content: [typed] }]).fetch });
    expect(r.pass).toBe(false);
    expect(r.why).toMatch(/never reads data/);

    const wrong = `table items={take(sort(data, 'tiv_usd'), 1)}\n  table-column "Location" field=location_id\n`;
    const w = await runAnswerCase(byId("sov-top-location"), config, { fetch: fakeModel([{ content: [wrong] }]).fetch });
    expect(w).toMatchObject({ pass: false, why: expect.stringMatching(/doesn't show/) });
  });

  it("reads figures however they're written", () => {
    const c = { ...byId("sov-total"), expectNumber: 238_412_000_000 };
    expect(score(c, "Total TIV\n$238.4B")).toBeNull();
    expect(score(c, "238,412,345,678")).toBeNull();
    expect(score(c, "$210B")).toMatch(/doesn't show/);
  });
});
