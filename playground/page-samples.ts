/**
 * Samples that need the experimental page elements: the playground offers
 * them only with ?page=1, where pageComponents are registered. A spec is the
 * same language a model is given, and uses everything made for designed pages:
 * a look line, entrance motion, a hero over a photo with a slow zoom, and each
 * page element.
 */
import type { Sample } from "./samples";

export const LANDING_PAGE = `look mood=bold type=editorial shape=soft density=airy
hero "Trips that plan themselves" eyebrow="Now in beta" lead="Tell us where and when. We write the whole itinerary: stops, timings, bookings." src="https://images.unsplash.com/photo-1551632811-561732d1e306?w=1600&q=70&auto=format&fit=crop" zoom=slow enter=fade stagger=true
  button "Plan a trip" on=emit:start
  button "See an example" variant=secondary on=emit:example
section "Why people use it" lead="Three things we never skip." stagger=true enter=rise
  grid min=200
    feature "Real itineraries" icon=map body="Every stop is timed, routed and checked against opening hours."
    feature "No surprises" icon=shield body="Costs and cancellation terms are shown before you book."
    feature "Works offline" icon=download body="Take the whole plan with you, signal or not."
band "Loved by people who hate planning" tone=soft enter=rise
  quote "We stopped writing itineraries by hand the week we found it. Our team trip took ten minutes." by="Maya Ortiz" role="Head of travel, Northwind"
pricing "Simple pricing" lead="Start free. Upgrade when you travel more." stagger=true enter=rise
  plan "Free" price="$0" detail="For the occasional weekend" features="Three trips a year; Shared itineraries; Email support"
    button "Start free" variant=secondary on=emit:free
  plan "Pro" price="$12" per="/ month" detail="For people who are always going somewhere" features="Unlimited trips; Offline plans; Priority support; Group planning" highlight=true badge="Most popular"
    button "Start free trial" on=emit:trial
  plan "Team" price="$40" per="/ month" detail="For companies that travel together" features="Everything in Pro; Shared budgets; Admin controls"
    button "Talk to us" variant=secondary on=emit:team
band "Ready when you are" lead="Your first three trips are free." tone=accent align=center enter=rise
  button "Start planning" on=emit:start
footer "Northwind Trips" lead="Trips that plan themselves." note="© 2026 Northwind Trips"
  column
    text "Product" weight=semibold
    link "Pricing" on=emit:pricing
    link "Examples" on=emit:examples
  column
    text "Company" weight=semibold
    link "About" on=emit:about
    link "Contact" on=emit:contact
`;

export const pageSamples: Record<string, Sample> = {
  landingPage: {
    label: "Landing page (page)",
    prompt: "Make a landing page for a trip-planning app: a hero with a photo, what it does, a customer quote, pricing, a call to action and a footer.",
    spec: LANDING_PAGE,
  },
};
