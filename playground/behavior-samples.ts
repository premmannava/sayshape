/**
 * Samples that need experimental behavior: `every` rules, and (with scenes)
 * shapes people drag. The playground offers them only with ?behavior=1
 * (the scene ones need ?scene=1 too). Each is a plain spec, written with the
 * same language a model is given.
 */
import type { Sample } from "./samples";

/** A countdown: a rule ticks once a second while it's running and there's time left. */
export const COUNTDOWN = `state running=false left=90 total=90
every 1s if={running && left > 0} do=dec:left
card
  text "Tea timer" style=title
  stat label="Time left" value="{floor(left / 60)}:{left % 60 < 10 ? '0' : ''}{left % 60}"
  progress value={total - left} max={total}
  row
    button "{running ? 'Pause' : left == total ? 'Start' : 'Resume'}" on=toggle:running disabled={left == 0}
    button "Reset" variant=secondary on="set:left:{total};set:running:false"
  if={left == 0}
    callout "Time's up: your tea is ready" tone=good
`;

/** Stock running down, a day a second, with Play and Pause and a line growing as it goes. */
export const STOCK = `state running=false stock=240 day=0 history=[{day: 0, units: 240}]
every 1s if={running && stock > 0} do="set:stock:{max(0, stock - 11 - (day % 3) * 5)};inc:day;add:history:{{day: day, units: stock}}"
card
  text "Ridge 28 L backpack: stock" style=title
  text "Each second is a day of sales at the usual pace" tone=muted
  grid min=140
    stat label="Units in stock" value={stock}
    stat label="Day" value={day}
  chart "Units in stock by day" kind=line items=history x=day y=units
  row
    button "{running ? 'Pause' : 'Play'}" on=toggle:running disabled={stock == 0}
    button "Restock to 240" variant=secondary on="set:stock:240;set:day:0;set:history:{[{day: 0, units: 240}]};set:running:false"
  if={stock < 60}
    callout "Reorder now: under 60 units left" tone=warn
`;

/** A falling ball: velocity and height build up tick by tick, and it bounces. */
export const FALLING_BALL = `state running=false y=40 vy=0
every 16ms if={running} do="set:vy:{y >= 260 && vy > 0 ? -vy * 0.75 : vy + 14.4};set:y:{min(260, y + vy * 0.016)}"
card
  text "A falling ball" style=title
  text "Gravity adds speed every frame; the floor sends a quarter of it away" tone=muted
  scene "A ball falling and bouncing on the floor" w=400 h=300
    rect x=0 y=0 w=400 h=300 fill=raised
    rect x=0 y=280 w=400 h=20 fill=line
    circle x=200 y={y} r=20 fill=accent
  row
    button "{running ? 'Pause' : 'Drop'}" on=toggle:running
    button "Reset" variant=secondary on="set:y:40;set:vy:0;set:running:false"
  text "Height {round(260 - y)} px, speed {round(abs(vy))} px/s" tone=muted
`;

/** A point people drag along y = x², with the tangent and its slope following it. */
export const POINT_ON_CURVE = `state px=380
derive u={(px - 300) / 80}
card
  text "A point on y = x²" style=title
  text "Drag the red point, or Tab to it and use the arrow keys" tone=muted
  scene "The curve y = x squared, with a point you can drag along it and its tangent line" w=600 h=320
    rect x=0 y=0 w=600 h=320 fill=raised
    line x1=0 y1=260 x2=600 y2=260 stroke=line width=2
    line x1=300 y1=20 x2=300 y2=300 stroke=line width=2
    each items={range(48)} as=i
      line x1={300 + 80*(-3 + i/8)} y1={260 - 25*pow(-3 + i/8, 2)} x2={300 + 80*(-3 + (i + 1)/8)} y2={260 - 25*pow(-3 + (i + 1)/8, 2)} stroke=accent width=3
    line x1={300 + 80*(u - 1.2)} y1={260 - 25*(u*u - 2.4*u)} x2={300 + 80*(u + 1.2)} y2={260 - 25*(u*u + 2.4*u)} stroke=muted width=2 dash="6 4"
    circle x={clamp(px, 60, 540)} y={260 - 25*((px - 300)/80)*((px - 300)/80)} r=22 fill=bad stroke=surface width=4 drag=true name="Point on the curve"
  grid min=140
    stat label="x" value={fixed(u, 2)}
    stat label="y = x²" value={fixed(u * u, 2)}
    stat label="Slope 2x" value={fixed(2 * u, 2)}
`;

export const behaviorSamples: Record<string, Sample> = {
  countdown: {
    label: "Countdown (rules)",
    prompt: "A tea timer: 90 seconds, with Start, Pause and Reset, and a note when it's done.",
    spec: COUNTDOWN,
  },
  stock: {
    label: "Stock running down (rules)",
    prompt: "Show our backpack stock running down day by day as it sells, with Play and Pause, and warn me when it's time to reorder.",
    spec: STOCK,
  },
};

/** These need scenes as well as behavior. */
export const behaviorSceneSamples: Record<string, Sample> = {
  fallingBall: {
    label: "Falling ball (rules + scene)",
    prompt: "Show a ball falling under gravity and bouncing on the floor, with Drop and Reset.",
    spec: FALLING_BALL,
  },
  pointOnCurve: {
    label: "Point on a curve (drag)",
    prompt: "An explainer for y = x squared: a point I can drag along the curve, with its tangent line and the slope at that point.",
    spec: POINT_ON_CURVE,
  },
};
