/**
 * The guides the token benchmark compares, by name. Each is generated from
 * the component definitions, never hand-written. Later items add variants
 * here (a preset profile, layout-first ordering) so they're measured the same way.
 */
import { languageGuide, type GuideOptions } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { BENCH_COMPONENTS } from "./measure";

export const BENCH_REGISTRY = new Registry(BENCH_COMPONENTS);

/** The baseline: the compact guide as `npm run guide:size` measures it. */
export const BASELINE: GuideOptions = { mode: "compact", imageHosts: ["images.unsplash.com"] };

export const GUIDE_VARIANTS: Record<string, GuideOptions> = {
  compact: BASELINE,
};

export const guideText = (variant: string): string => {
  const opts = GUIDE_VARIANTS[variant];
  if (!opts) throw new Error(`No guide variant "${variant}". Known: ${Object.keys(GUIDE_VARIANTS).join(", ")}`);
  return languageGuide(BENCH_REGISTRY, opts);
};
