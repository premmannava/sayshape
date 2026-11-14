/**
 * Samples that need the experimental deck and slide elements: the playground
 * offers them only with ?slides=1, where slideComponents are registered.
 */
import type { Sample } from "./samples";

/** A quarterly business review in five slides: stats, a chart, a list and a timeline. */
export const Q3_REVIEW = `state page=0
state months=[{month: "Jul", revenue: 1.48, target: 1.4}, {month: "Aug", revenue: 1.59, target: 1.5}, {month: "Sep", revenue: 1.75, target: 1.6}]
deck bind=page
  slide "Q3 business review" layout=title
    text "Revenue is up 18% on last year, and every month beat its target." style=lead tone=muted
    text "Northwind Outfitters · October 2026" style=caption tone=muted
  slide "Three numbers that sum up the quarter"
    grid min=220
      card
        stat label="Revenue" value="$4.82M" change="+18%"
      card
        stat label="New customers" value="312" change="+9%"
      card
        stat label="Churn" value="2.1%" change="-0.4 pts" good=down
  slide "Every month beat its target"
    chart kind=bar items=months x=month y=revenue,target labels="Revenue ($M),Target ($M)"
  slide "What drove it"
    list
      list-item "Trail packs sold out twice" detail="Restocked in 9 days instead of 21" icon=check
      list-item "Wholesale grew to 40 stores" detail="Up from 26 at the end of Q2" icon=check
      list-item "Returns fell to 4%" detail="New size guide on every product page" icon=check
  slide "What we do next"
    timeline
      step "Hire two in support" time="Nov" status=current
      step "Open the Denver warehouse" time="Dec" status=upcoming
      step "Launch the winter line" time="Jan" status=upcoming`;

export const slideSamples: Record<string, Sample> = {
  q3Review: {
    label: "Q3 business review (slides)",
    prompt: "Make a short slide deck for our Q3 business review: the headline, three key numbers, revenue against target by month, what drove it, and what we do next.",
    spec: Q3_REVIEW,
  },
};
