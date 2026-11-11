/**
 * What the playground's Spec picker offers: the gallery's examples and the
 * development playground's samples as one list, grouped by what they're for.
 * Plain data with no browser or Vue imports, so test/site.test.ts can check it.
 */
import { examples } from "../../../examples/catalog";
import { samples } from "../../../../playground/samples";

export interface Source { key: string; title: string; spec: string; group: string }

/** The picker's groups, in the order shown. Samples this file doesn't place go under the last one. */
export const SOURCE_GROUPS = ["Money", "Shopping", "Dashboards", "Plans", "Maps", "Single elements", "More"] as const;
const OTHER = "More";

/** Where each development sample goes. Gallery examples carry their own category. */
const SAMPLE_GROUP: Record<string, (typeof SOURCE_GROUPS)[number]> = {
  budgetTree: "Money", order: "Money",
  checkout: "Shopping", product: "Shopping", cart: "Shopping", choosePlan: "Shopping",
  charts: "Dashboards", salesCharts: "Dashboards", dashboardAnswer: "Dashboards", inventory: "Dashboards", directory: "Dashboards",
  hike: "Plans", habits: "Plans", packing: "Plans", search: "Plans", roomBookings: "Plans", hiringBoard: "Plans",
  onboardingFlow: "Plans", tripStatus: "Plans", request: "Plans",
  mapOverlap: "Maps", mapAnalytics: "Maps", map: "Maps",
  blackjackDealer: "Single elements", priceRating: "Single elements", storageTreemap: "Single elements", signupFlow: "Single elements",
  activityFeed: "Single elements", cancelPlan: "Single elements", orderActions: "Single elements", kpiTips: "Single elements",
};

/** Sample labels that say too little on their own in a long list. */
const SAMPLE_TITLE: Record<string, string> = {
  search: "Trail search",
  order: "Equipment order",
  request: "Equipment request",
};

/** A label without its "(element)" note, for telling when a sample repeats a gallery example. */
const baseTitle = (label: string) => label.replace(/\s*\(.*\)$/, "");

const exampleByTitle = new Map(examples.map((e) => [e.title, e.id]));

/**
 * Keys that used to be offered and now stand for a gallery example of the same
 * name, so links to them keep working.
 */
export const SOURCE_ALIASES: Record<string, string> = {};

export const sources: Source[] = [
  ...examples.map((e): Source => ({ key: e.id, title: e.title, spec: e.spec, group: e.category })),
  ...Object.entries(samples).flatMap(([k, s]): Source[] => {
    // Samples that load remote photos are left out: this site allows no image hosts.
    if (/^\s*image\b/m.test(s.spec)) return [];
    const key = `sample-${k}`;
    const twin = exampleByTitle.get(baseTitle(s.label));
    if (twin) { SOURCE_ALIASES[key] = twin; return []; }
    return [{ key, title: SAMPLE_TITLE[k] ?? s.label, spec: s.spec.replace(/\n$/, ""), group: SAMPLE_GROUP[k] ?? OTHER }];
  }),
];

/** The picker's groups with what's in each; empty groups are left out. */
export const sourceGroups: Array<{ label: string; items: Source[] }> = SOURCE_GROUPS
  .map((label) => ({ label, items: sources.filter((s) => s.group === label) }))
  .filter((g) => g.items.length > 0);

/** The source a key from a link stands for, following aliases; undefined when there's none. */
export function sourceByKey(key: string): Source | undefined {
  const real = SOURCE_ALIASES[key] ?? key;
  return sources.find((s) => s.key === real);
}
