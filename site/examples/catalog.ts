/**
 * The website's example gallery. Plain data with no browser or Vue imports,
 * so test/site.test.ts can check every spec parses cleanly and behaves as
 * described with the real engine.
 *
 * All names, prices and records here are fictional. Nothing on the site is
 * connected to a backend: emitted actions are shown as simulated.
 *
 * Adapted from the development playground's samples (playground/samples.ts),
 * the model guide's worked examples (src/prompt.ts) and the monthly budget
 * example (playground/connected-order/monthly-budget.sayshape).
 */

export type Category = "Money" | "Shopping" | "Dashboards" | "Plans";

/** The style an example is shown in, from the playground's appearance presets: one spec, any brand. */
export interface Look {
  preset: "teal" | "purple" | "blue" | "neutral";
  scheme: "light" | "dark";
  /** A custom accent; the presets adjust it until it reads well. */
  accent?: string;
}

export interface Example {
  id: string;
  /** A short name, two or three words. */
  title: string;
  /** What a person would ask for to get this screen. */
  prompt: string;
  category: Category;
  look: Look;
  /** Set when an action pretends to submit something: one short sentence. */
  simulated?: string;
  spec: string;
}

const tip: Example = {
  id: "tip-calculator",
  title: "Split the bill",
  prompt: "Split an $86 restaurant bill with an 18% tip",
  category: "Money",
  look: { preset: "teal", scheme: "light" },
  spec: `state bill=86 percent=18 people=2
derive tip={bill * percent / 100}
derive total={bill + tip}
derive perPerson={total / people}
card
  text "Tip calculator" style=title
  text "Change any input and every figure updates." tone=muted
  stepper "Bill ($)" bind=bill min=0 max=2000 step=2
  slider "Tip: {percent}%" bind=percent min=0 max=30
  row
    button "15%" variant={percent == 15 ? 'primary' : 'secondary'} on=set:percent:15
    button "18%" variant={percent == 18 ? 'primary' : 'secondary'} on=set:percent:18
    button "20%" variant={percent == 20 ? 'primary' : 'secondary'} on=set:percent:20
  stepper "People" bind=people min=1 max=20
  divider
  grid min=130 gap=10
    stat label="Tip" value={money(tip)}
    stat label="Total" value={money(total)}
    stat label="Each person pays" value={money(perPerson)} tone=accent`,
};

const grocery: Example = {
  id: "grocery-checklist",
  title: "Grocery list",
  prompt: "A grocery list I can tick off and add to",
  category: "Plans",
  look: { preset: "neutral", scheme: "light", accent: "#2f7d4f" },
  spec: `state newItem="" hideDone=false nextId=6
state groceries=[{id: 1, name: "Oat milk", aisle: "Dairy", done: false}, {id: 2, name: "Eggs", aisle: "Dairy", done: true}, {id: 3, name: "Sourdough bread", aisle: "Bakery", done: false}, {id: 4, name: "Bananas", aisle: "Produce", done: false}, {id: 5, name: "Spinach", aisle: "Produce", done: true}]
derive total={len(groceries)}
derive inCart={count(groceries, 'done')}
card
  text "Grocery list" style=title
  text "{inCart} of {plural(total, 'item')} in the cart" tone=muted
  progress value={inCart} max={max(total, 1)}
  switch "Hide items already in the cart" bind=hideDone
  each items=groceries as=g key={g.id}
    row align=center if={!(hideDone && g.done)}
      check "{g.name}" bind=g.done
      badge "{g.aisle}" tone=muted
      button "Remove" variant=secondary on=remove:g
  empty "Your list is empty" detail="Add something below." if={total == 0}
  text "Everything is in the cart." tone=good if={total > 0 && inCart == total}
  row align=bottom
    input "Add an item" bind=newItem placeholder="e.g. Apples"
    button "Add" on="add:groceries:{id: nextId, name: trim(newItem), aisle: 'Other', done: false};inc:nextId;set:newItem:''" disabled={trim(newItem) == ''}
  button "Remove items in the cart" variant=secondary on="set:groceries:{filter(groceries, 'done', false)}" disabled={inCart == 0}`,
};

const budget: Example = {
  id: "monthly-budget",
  title: "Monthly budget",
  prompt: "Show this month's spending by category",
  category: "Dashboards",
  look: { preset: "teal", scheme: "dark" },
  spec: `state transactions=[{id: "oct-groceries", month: "October", date: "2026-10-02", category: "Food", description: "Groceries", amount: 64.5}, {id: "oct-internet", month: "October", date: "2026-10-04", category: "Home", description: "Internet", amount: 80}, {id: "oct-fuel", month: "October", date: "2026-10-08", category: "Transit", description: "Fuel", amount: 42}, {id: "oct-restaurant", month: "October", date: "2026-10-11", category: "Food", description: "Restaurant", amount: 87.5}, {id: "oct-electricity", month: "October", date: "2026-10-15", category: "Home", description: "Electricity", amount: 132}, {id: "oct-parking", month: "October", date: "2026-10-19", category: "Transit", description: "Parking", amount: 35}, {id: "nov-groceries", month: "November", date: "2026-11-03", category: "Food", description: "Groceries", amount: 72}, {id: "nov-concert", month: "November", date: "2026-11-08", category: "Fun", description: "Concert", amount: 95}, {id: "nov-rent", month: "November", date: "2026-11-01", category: "Home", description: "Rent share", amount: 640}]
state months=["October", "November"] categories=["All", "Food", "Home", "Transit", "Fun"] month="October" category="All" budget=600 selectedId="oct-electricity" sortField="date" sortDirection="asc"
derive inMonth={filter(transactions, 'month', month)}
derive visible={category == 'All' ? inMonth : filter(inMonth, 'category', category)}
derive spent={sum(visible, 'amount')}
derive remaining={budget - spent}
derive selected={find(transactions, 'id', selectedId)}
column gap=14
  text "Monthly budget" style=title
  row
    select "Month" items=months bind=month
    select "Category" items=categories bind=category
  grid min=150 gap=10
    stat label="Expenses" value={len(visible)}
    stat label="Spent" value={money(spent)}
    stat label="Remaining" value={money(remaining)} tone={remaining < 0 ? 'bad' : 'good'}
  progress value={min(spent, budget)} max={budget} label="{round(spent / budget * 100, 0)}% of {money(budget)} used" tone={remaining < 0 ? 'bad' : 'accent'}
  text "Over budget by {money(-remaining)}" tone=bad if={remaining < 0}
  slider "Monthly budget: {money(budget)}" bind=budget min=100 max=1500 step=50
  chart "Spending by expense" kind=bar items=visible x=description y=amount format=money
  table "Expenses" items=visible key=id bind=selectedId sort=sortField direction=sortDirection
    table-column "Date" field=date
    table-column "Description" field=description
    table-column "Amount" field=amount format=money
  card
    text "Selected expense" weight=semibold
    text "{selected.description} · {selected.category} · {selected.date}" if={selected}
    text "{money(selected.amount)}" style=lead if={selected}
    text "Pick a row in the table to see it here." tone=muted if={!selected}`,
};

const configurator: Example = {
  id: "product-builder",
  title: "Build a backpack",
  prompt: "Let me build a backpack and check out",
  category: "Shopping",
  look: { preset: "neutral", scheme: "light", accent: "#b4532a" },
  simulated: "Checking out shows a message. No order is placed.",
  spec: `state model="ridge28" size="m" color="slate" qty=1 nextId=1 cart=[]
state models=[{id: "ridge28", name: "Ridge 28 L", price: 129}, {id: "ridge18", name: "Ridge 18 L", price: 99}]
state colors=[{id: "slate", name: "Slate"}, {id: "moss", name: "Moss"}, {id: "ember", name: "Ember (sold out)", soldOut: true}]
derive pick={find(models, 'id', model)}
derive colorName={find(colors, 'id', color).name}
derive unit={pick.price + (size == 'l' ? 10 : 0)}
derive units={sum(cart, 'qty')}
derive subtotal={sum(cart, 'price', 'qty')}
derive shipping={subtotal == 0 || subtotal >= 150 ? 0 : 9}
derive total={subtotal + shipping}
screen name=build title="Build your pack"
  text "A made-up product with made-up prices." tone=muted
  text "Model" weight=semibold
  each items=models as=m key={m.id}
    radio "{m.name} · {money(m.price)}" bind=model value={m.id}
  select "Color" items=colors value=id label=name unavailable=soldOut bind=color
  text "Size" weight=semibold
  row
    radio "S" bind=size value=s
    radio "M" bind=size value=m
    radio "L (+$10)" bind=size value=l
  stepper "Quantity" bind=qty min=1 max=5
  card
    text "{pick.name} · {colorName} · size {upper(size)}" weight=semibold
    stat label="Price" value={money(unit * qty)}
  row
    button "Add to cart" on="add:cart:{id: nextId, name: pick.name, detail: colorName + ' · size ' + upper(size), price: unit, qty: qty};inc:nextId;notify:'Added to your cart'"
    button "View cart ({units})" variant=secondary on=go:cart
screen name=cart title="Your cart"
  each items=cart as=line key={line.id}
    row align=top
      column gap=2
        text "{line.name}" weight=semibold
        text "{line.detail}" tone=muted
        link "Remove" on=remove:line
      stepper bind=line.qty min=1 max=5
      text "{money(line.price * line.qty)}" weight=semibold align=right
  empty "Your cart is empty" detail="Build a pack and add it." action="Build a pack" on=go:build if={len(cart) == 0}
  divider
  list
    list-item "Subtotal" trailing="{money(subtotal)}"
    list-item "Shipping" detail="Free over $150" trailing="{shipping == 0 ? 'Free' : money(shipping)}"
    list-item "Total" trailing="{money(total)}"
  row
    button "Keep shopping" variant=secondary on=go:build
    button "Check out" on="emit:checkout:{cart};notify:'Demo only: no order was placed'" disabled={len(cart) == 0}`,
};

const coffee: Example = {
  id: "coffee-order",
  title: "Coffee order",
  prompt: "Let me order a flat white my way",
  category: "Money",
  look: { preset: "neutral", scheme: "light", accent: "#8a4b2a" },
  simulated: "Ordering shows a message. Nothing is sent.",
  spec: `state size="Medium" milk="Oat" shots=1 sweet=false cups=1
derive base={size == 'Small' ? 3.5 : size == 'Medium' ? 4.25 : 5}
derive extras={(shots - 1) * 0.75 + (milk == 'Oat' || milk == 'Almond' ? 0.6 : 0) + (sweet ? 0.5 : 0)}
derive total={(base + extras) * cups}
card
  text "Flat white" style=title
  text "Single-origin espresso, steamed milk" tone=muted
  segmented bind=size options="Small,Medium,Large"
  select "Milk" items={['Whole', 'Oat', 'Almond', 'None']} bind=milk
  stepper "Espresso shots" bind=shots min=1 max=4
  switch "Vanilla syrup (+$0.50)" bind=sweet
  divider
  grid min=140 gap=10
    stepper "Cups" bind=cups min=1 max=6
    stat label="Total" value={money(total)} tone=accent
  button "Order {plural(cups, 'cup')}" on="emit:order:{size};notify:'Sent to the counter'"`,
};

const cabin: Example = {
  id: "book-a-cabin",
  title: "Book a cabin",
  prompt: "Book a cabin near Flagstaff for the weekend",
  category: "Shopping",
  look: { preset: "neutral", scheme: "light", accent: "#2f6b3a" },
  simulated: "Reserving shows a message. Nothing is booked.",
  spec: `state cabin="Pine" checkin="" nights=2 guests=2
state cabins=[{name: "Pine", rate: 149, sleeps: 4}, {name: "Ridge", rate: 189, sleeps: 6}, {name: "Creek", rate: 119, sleeps: 2}]
derive pick={find(cabins, 'name', cabin)}
derive fits={guests <= pick.sleeps}
derive stay={pick.rate * nights}
derive fee={round(stay * 0.12, 2)}
card
  text "Book a cabin" style=title
  text "Flagstaff, AZ · pine forest, wood stove" tone=muted icon=pin
  segmented bind=cabin options="Pine,Ridge,Creek"
  text "{pick.name} sleeps {pick.sleeps} · {money(pick.rate)} a night" tone=muted
  date-picker "Check in" bind=checkin min="2026-11-05" max="2027-06-30" placeholder="Pick a date"
  grid min=140 gap=10
    stepper "Nights" bind=nights min=1 max=14
    stepper "Guests" bind=guests min=1 max=8
  if={!fits}
    callout "{pick.name} sleeps {pick.sleeps}" detail="Ridge fits up to 6." tone=warn icon=true
  list
    list-item "{money(pick.rate)} × {plural(nights, 'night')}" trailing="{money(stay)}"
    list-item "Cleaning and service" trailing="{money(fee)}"
    list-item "Total" trailing="{money(stay + fee)}"
  button "Reserve" disabled={checkin == '' || !fits} on="emit:reserve:{cabin};notify:'Held for 10 minutes'"`,
};

const laptop: Example = {
  id: "pick-a-laptop",
  title: "Pick a laptop",
  prompt: "Which of these three laptops should I buy?",
  category: "Shopping",
  look: { preset: "blue", scheme: "light" },
  spec: `state use="Travel"
state laptops=[{name: "Air 13", price: 1099, battery: 18, weight: 1.2, memory: 16, ports: 2}, {name: "Pro 14", price: 1999, battery: 22, weight: 1.6, memory: 24, ports: 4}, {name: "Flex 15", price: 849, battery: 11, weight: 1.9, memory: 16, ports: 5}]
derive best={use == 'Travel' ? 'Air 13' : use == 'Video' ? 'Pro 14' : 'Flex 15'}
derive why={use == 'Travel' ? 'The lightest, with a long battery for the price.' : use == 'Video' ? 'The most memory and the longest battery.' : 'The cheapest, with the most ports.'}
card
  text "Pick a laptop" style=title
  text "What is it mostly for?" tone=muted
  segmented bind=use options="Travel,Video,Office"
  compare items=laptops pick="{best}"
    compare-row "Price" field=price format=money best=low
    compare-row "Battery (hours)" field=battery format=number best=high
    compare-row "Weight (kg)" field=weight format=number best=low
    compare-row "Memory (GB)" field=memory format=number best=high
    compare-row "Ports" field=ports format=number best=high
  callout "{best} for {lower(use)}" detail="{why}" icon=true`,
};

const sales: Example = {
  id: "sales-this-week",
  title: "Sales this week",
  prompt: "How did sales go this week?",
  category: "Dashboards",
  look: { preset: "purple", scheme: "dark" },
  spec: `state days=[{day: "Mon", sales: 3900}, {day: "Tue", sales: 4100}, {day: "Wed", sales: 4000}, {day: "Thu", sales: 4600}, {day: "Fri", sales: 4400}, {day: "Sat", sales: 5100}, {day: "Sun", sales: 5600}]
state regions=[{name: "West", sales: 12400}, {name: "East", sales: 9100}, {name: "South", sales: 6300}, {name: "North", sales: 3900}]
derive total={sum(days, 'sales')}
derive top={first(sort(days, 'sales', 'desc'))}
card
  text "Sales this week" style=title
  grid min=140 gap=10
    stat label="Revenue" value={compact(total, 'USD')} change="+8.4%" spark={[3.9, 4.1, 4.0, 4.6, 4.4, 5.1, 5.6]}
    stat label="Orders" value="1,284" change="+3.1%" spark={[160, 172, 168, 181, 190, 201, 212]}
    stat label="Refunds" value="$640" change="-12%" good=down
  chart "Revenue by day" kind=bar items=days x=day y=sales format=money
  chart "By region" kind=donut items=regions x=name y=sales format=money
  callout "Best day: {top.day}" detail="{money(top.sales)} in sales" tone=good icon=true`,
};

const trip: Example = {
  id: "trip-planner",
  title: "Trip planner",
  prompt: "Plan 3 days in Sedona and what to pack",
  category: "Plans",
  look: { preset: "neutral", scheme: "light", accent: "#c2551f" },
  spec: `state day="Day 1"
state packed=[{item: "Water, 3 liters", done: true}, {item: "Sunscreen", done: false}, {item: "Headlamp", done: false}, {item: "Trail shoes", done: true}]
card
  text "3 days in Sedona" style=title
  text "Nov 14 to 16 · clear, highs around 68°F" tone=muted icon=sun
  tabs bind=day
    tab "Day 1"
      timeline
        step "Cathedral Rock" detail="Sunrise hike, 1.2 miles" time="6:30 AM" icon=sun
        step "Tlaquepaque" detail="Lunch and galleries" time="12:00 PM"
        step "Airport Mesa" detail="Sunset viewpoint" time="5:10 PM"
    tab "Day 2"
      timeline
        step "Devil's Bridge" detail="Early start, 4.2 miles" time="7:00 AM" icon=sun
        step "Oak Creek" detail="Picnic by the water" time="1:00 PM"
        step "Stargazing tour" detail="Dark-sky park" time="8:00 PM" icon=moon
    tab "Day 3"
      timeline
        step "Bell Rock" detail="Easy loop" time="8:00 AM"
        step "Drive home" detail="Phoenix, 2 hours" time="12:00 PM" icon=car
  text "Packing" weight=semibold
  each items=packed as=p
    check "{p.item}" bind=p.done
  progress value={count(packed, 'done')} max={len(packed)} label="{count(packed, 'done')} of {len(packed)} packed" tone=good`,
};

const tracking: Example = {
  id: "order-tracking",
  title: "Order tracking",
  prompt: "Where is my order?",
  category: "Plans",
  look: { preset: "blue", scheme: "dark" },
  spec: `state stage=2
card
  row align=center
    text "Order R-1041" style=title
    badge "{stage >= 4 ? 'Delivered' : 'On the way'}" tone={stage >= 4 ? 'good' : 'accent'}
  text "Trail runners, size 10 · arriving today" tone=muted icon=package
  progress value={stage} max=4 tone=good
  timeline
    step "Ordered" time="Nov 2" status=done
    step "Shipped" detail="Left the Phoenix warehouse" time="Nov 3" status={stage >= 2 ? 'done' : 'current'} icon=truck
    step "Out for delivery" detail="Driver is 4 stops away" time="Today" status={stage >= 3 ? 'done' : stage == 2 ? 'current' : 'upcoming'} icon=truck
    step "Delivered" detail="Front porch" status={stage >= 4 ? 'done' : stage == 3 ? 'current' : 'upcoming'} icon=home
  button "Next update" variant=secondary disabled={stage >= 4} on=inc:stage`,
};

export const examples: readonly Example[] = [tip, sales, cabin, trip, laptop, coffee, grocery, tracking, budget, configurator];

/** The three the landing page offers beside the hero demo. */
export const heroExamples = [
  { example: tip, label: "Calculator", shows: "Derived values", prompt: "Split an $86 restaurant bill with an 18% tip" },
  { example: grocery, label: "Checklist", shows: "Lists and state", prompt: "A grocery list I can tick off and add to" },
  { example: budget, label: "Dashboard", shows: "Charts and tables", prompt: "Show this month's budget by category" },
] as const;

export const exampleById = (id: string): Example | undefined => examples.find((e) => e.id === id);
