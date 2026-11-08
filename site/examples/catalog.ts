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

const pipeline: Example = {
  id: "sales-pipeline",
  title: "Sales pipeline",
  prompt: "Show our Q4 pipeline by stage, with the deal values",
  category: "Dashboards",
  look: { preset: "blue", scheme: "light" },
  spec: `state picked=5
state deals=[{id: 1, name: "Fleet telematics", company: "Harbor Freight Co", owner: "Maya Chen", status: "Lead", amount: 48000, risk: "good"}, {id: 2, name: "Claims portal rebuild", company: "Northwind Mutual", owner: "Luis Ortega", status: "Proposal", amount: 125000, risk: "warn"}, {id: 3, name: "Warehouse sensors", company: "Larkspur Logistics", owner: "Priya Nair", status: "Qualified", amount: 36500, risk: "good"}, {id: 4, name: "Payroll migration", company: "Cobalt Staffing", owner: "Tom Becker", status: "Lead", amount: 22000, risk: "good"}, {id: 5, name: "Policy admin suite", company: "Bluefin Insurance", owner: "Maya Chen", status: "Negotiation", amount: 310000, risk: "bad"}, {id: 6, name: "Route planner", company: "Granite Haulage", owner: "Ama Mensah", status: "Won", amount: 64000, risk: "good"}, {id: 7, name: "HR analytics", company: "Juniper Health", owner: "Luis Ortega", status: "Qualified", amount: 58000, risk: "warn"}]
derive d={find(deals, 'id', picked)}
derive open={filter(deals, 'status', ['Lead', 'Qualified', 'Proposal', 'Negotiation'])}
card
  text "Q4 pipeline" style=title
  grid min=140 gap=10
    stat label="Open pipeline" value={compact(sum(open, 'amount'), 'USD')}
    stat label="Open deals" value={len(open)}
    stat label="Won this quarter" value={compact(sum(filter(deals, 'status', 'Won'), 'amount'), 'USD')}
  board items=deals stage=status stages="Lead,Qualified,Proposal,Negotiation,Won" title=name detail=company value=amount format=money sum=amount tone=risk bind=picked
  details "{d.name}" subtitle="{d.company} · {d.owner}"
    detail "Value" value={money(d.amount)}
    detail "Stage" value={d.status}
    detail "Risk" value={d.risk == 'bad' ? 'High' : d.risk == 'warn' ? 'Medium' : 'Low'} tone={d.risk == 'bad' ? 'bad' : d.risk == 'warn' ? 'warn' : 'good'}`,
};

const org: Example = {
  id: "org-chart",
  title: "Org chart",
  prompt: "Who reports to whom in operations?",
  category: "Plans",
  look: { preset: "neutral", scheme: "light" },
  spec: `state picked="e3"
state people=[{id: "e1", name: "Ana Ruiz", role: "Chief Operating Officer"}, {id: "e2", name: "Ben Okafor", role: "Head of Claims", manager: "e1"}, {id: "e3", name: "Chloe Park", role: "Head of Operations", manager: "e1"}, {id: "e4", name: "Dev Malhotra", role: "Claims lead, North", manager: "e2"}, {id: "e5", name: "Erin Walsh", role: "Claims lead, South", manager: "e2"}, {id: "e6", name: "Femi Adeyemi", role: "Warehouse manager", manager: "e3"}, {id: "e7", name: "Grace Lin", role: "Fleet manager", manager: "e3"}, {id: "e8", name: "Hugo Martin", role: "HR partner", manager: "e1"}]
derive p={find(people, 'id', picked)}
card
  text "Northwind Mutual operations" style=title
  text "8 people · press someone to see who they report to" tone=muted
  tree items=people parent=manager label=name detail=role kind=org bind=picked
  details "{p.name}" subtitle="{p.role}"
    detail "Reports to" value={p.manager ? find(people, 'id', p.manager).name : 'Board of directors'}
    detail "Direct reports" value={len(filter(people, 'manager', p.id))}`,
};

const claimFlow: Example = {
  id: "claim-approval",
  title: "Claim approval",
  prompt: "How does a claim get approved?",
  category: "Plans",
  look: { preset: "teal", scheme: "light" },
  spec: `state picked="" steps=[{id: "fnol", label: "Claim filed", kind: "start", next: "triage"}, {id: "triage", label: "Triage and check cover", kind: "step", next: "small"}, {id: "small", label: "Estimate under $5,000?", kind: "decision", next: "auto,adjuster"}, {id: "auto", label: "Approve automatically", kind: "step", next: "pay"}, {id: "adjuster", label: "Adjuster inspects damage", kind: "step", next: "fraud"}, {id: "fraud", label: "Fraud signals?", kind: "decision", next: "siu,approve"}, {id: "siu", label: "Special investigations", kind: "step", next: "adjuster"}, {id: "approve", label: "Manager approves", kind: "step", next: "pay"}, {id: "pay", label: "Pay out", kind: "end"}]
state edges=[{from: "small", to: "auto", label: "Yes"}, {from: "small", to: "adjuster", label: "No"}, {from: "fraud", to: "siu", label: "Yes"}, {from: "fraud", to: "approve", label: "No"}, {from: "siu", to: "adjuster", label: "Cleared"}]
derive s={find(steps, 'id', picked)}
card
  text "How a claim gets approved" style=title
  text "Northwind Mutual · press a step for who owns it" tone=muted
  text "Claims under **$5,000** are paid *automatically*, usually within 2 days. Anything flagged for fraud goes to \`SIU\` first; see [the claims policy](https://northwind.example/claims-policy)." rich=true
  flow items=steps edges=edges bind=picked
  if={picked != ''}
    callout "{s.label}" detail="{s.kind == 'decision' ? 'A decision the claims system makes' : 'Owned by the claims team'}" tone=accent`,
};

const launch: Example = {
  id: "launch-plan",
  title: "Launch plan",
  prompt: "Plan our product launch by team, and show me what's due when",
  category: "Plans",
  look: { preset: "teal", scheme: "light" },
  spec: `state picked=2
state tasks=[{id: 1, task: "Pricing research", team: "Product", owner: "Maya Chen", from: "2026-10-05", to: "2026-10-16", status: "Done"}, {id: 2, task: "Beta with 12 customers", team: "Product", owner: "Maya Chen", from: "2026-10-19", to: "2026-11-06", status: "On track"}, {id: 3, task: "Launch site", team: "Marketing", owner: "Luis Ortega", from: "2026-10-12", to: "2026-10-30", status: "At risk"}, {id: 4, task: "Press kit", team: "Marketing", owner: "Priya Nair", from: "2026-10-26", to: "2026-11-06", status: "Not started"}, {id: 5, task: "Support playbook", team: "Support", owner: "Tom Becker", from: "2026-10-20", to: "2026-11-10", status: "On track"}, {id: 6, task: "Sales training", team: "Sales", owner: "Ama Mensah", from: "2026-10-28", to: "2026-11-10", status: "Not started"}, {id: 7, task: "Launch day", team: "Sales", owner: "Ama Mensah", from: "2026-11-12", to: "2026-11-12", status: "Not started"}]
derive t={find(tasks, 'id', picked)}
card
  text "Ledgerly 2.0 launch" style=title
  text "7 tasks across 4 teams · launch on Thu, Nov 12" tone=muted
  schedule items=tasks start=from end=to label=task rows=team view=timeline bind=picked
  details "{t.task}" subtitle="{t.team} · {t.owner}"
    detail "From" value={t.from}
    detail "To" value={t.to}
    detail "Status" value={t.status} tone={t.status == 'At risk' ? 'bad' : t.status == 'Done' ? 'good' : 'default'}`,
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

const cinema: Example = {
  id: "seat-picker",
  title: "Pick your seats",
  prompt: "Let me pick seats for Friday's 8:15 showing",
  category: "Shopping",
  look: { preset: "purple", scheme: "dark" },
  simulated: "Booking shows a message. Nothing is booked.",
  spec: `state seats=[{id: "A1", row: "A", taken: false, picked: false}, {id: "A2", row: "A", taken: false, picked: false}, {id: "A3", row: "A", taken: true, picked: false}, {id: "A4", row: "A", taken: true, picked: false}, {id: "A5", row: "A", taken: false, picked: false}, {id: "A6", row: "A", taken: false, picked: false}, {id: "B1", row: "B", taken: false, picked: false}, {id: "B2", row: "B", taken: true, picked: false}, {id: "B3", row: "B", taken: false, picked: false}, {id: "B4", row: "B", taken: false, picked: false}, {id: "B5", row: "B", taken: false, picked: false}, {id: "B6", row: "B", taken: false, picked: false}, {id: "C1", row: "C", taken: false, picked: false}, {id: "C2", row: "C", taken: false, picked: true}, {id: "C3", row: "C", taken: true, picked: false}, {id: "C4", row: "C", taken: true, picked: false}, {id: "C5", row: "C", taken: true, picked: false}, {id: "C6", row: "C", taken: false, picked: false}, {id: "D1", row: "D", taken: true, picked: false}, {id: "D2", row: "D", taken: false, picked: false}, {id: "D3", row: "D", taken: false, picked: false}, {id: "D4", row: "D", taken: false, picked: false}, {id: "D5", row: "D", taken: false, picked: false}, {id: "D6", row: "D", taken: false, picked: false}, {id: "E1", row: "E", taken: false, picked: false}, {id: "E2", row: "E", taken: false, picked: false}, {id: "E3", row: "E", taken: false, picked: false}, {id: "E4", row: "E", taken: false, picked: false}, {id: "E5", row: "E", taken: false, picked: false}, {id: "E6", row: "E", taken: true, picked: false}]
derive chosen={filter(seats, 'picked', true)}
derive total={len(chosen) * 14}
card
  text "Lumen Cinema · Screen 3" style=title
  text "The Long Field · Friday 8:15 pm · $14 a seat" tone=muted
  text "Screen" tone=muted align=center
  each items={['A', 'B', 'C', 'D', 'E']} as=r
    row gap=6 wrap=false
      each items={filter(seats, 'row', r)} as=s key={s.id}
        tile "{s.id}" shape=square size=sm selected={s.picked} disabled={s.taken} on=toggle:s.picked label="Seat {s.id}"
  text "Grey seats are taken. Press a seat to choose it, again to let it go." tone=muted align=center
  divider
  grid min=130 gap=10
    stat label="Seats" value={len(chosen) > 0 ? join(chosen, 'id') : 'None yet'}
    stat label="Total" value={money(total)} tone=accent
  button "Book {plural(len(chosen), 'seat')}" on="emit:book:{pluck(chosen, 'id')};notify:'Demo only: nothing was booked'" disabled={len(chosen) == 0}`,
};

const funds: Example = {
  id: "fund-risk",
  title: "Risk and return",
  prompt: "Compare our funds' risk and return, sized by assets",
  category: "Dashboards",
  look: { preset: "blue", scheme: "light" },
  spec: `state funds=[{name: "Harbor Bond", type: "Bonds", risk: 3.1, ret: 3.4, assets: 820}, {name: "Harbor Short Term", type: "Bonds", risk: 1.8, ret: 2.6, assets: 410}, {name: "Harbor Global Bond", type: "Bonds", risk: 4.6, ret: 3.9, assets: 260}, {name: "Summit Balanced", type: "Mixed", risk: 8.2, ret: 6.1, assets: 1240}, {name: "Summit Income", type: "Mixed", risk: 6.4, ret: 5.2, assets: 530}, {name: "Summit Growth", type: "Mixed", risk: 10.9, ret: 7.4, assets: 690}, {name: "Ridge Large Cap", type: "Stocks", risk: 14.2, ret: 9.8, assets: 2100}, {name: "Ridge Dividend", type: "Stocks", risk: 12.1, ret: 8.1, assets: 880}, {name: "Ridge Small Cap", type: "Stocks", risk: 19.6, ret: 11.2, assets: 450}, {name: "Ridge Emerging", type: "Stocks", risk: 22.4, ret: 8.9, assets: 310}, {name: "Ridge Tech", type: "Stocks", risk: 24.8, ret: 13.5, assets: 760}]
card
  text "Northwind funds: risk and return" style=title
  text "Five-year yearly return against volatility. Bigger dots hold more assets ($M). Hover or focus a dot for its numbers." tone=muted
  chart kind=scatter items=funds x=risk y=ret label=name size=assets group=type labels="Risk (volatility %),Return" format=percent
  callout "Ridge Emerging takes more risk than Ridge Small Cap (22.4 against 19.6) for 2.3 points less return" tone=warn icon=true`,
};

const costs: Example = {
  id: "where-costs-go",
  title: "Where costs go",
  prompt: "Show where Brightline's 2026 operating costs go",
  category: "Dashboards",
  look: { preset: "teal", scheme: "light" },
  spec: `state costs=[{item: "Salaries", area: "People", amount: 1840000}, {item: "Benefits", area: "People", amount: 420000}, {item: "Contractors", area: "People", amount: 310000}, {item: "Office rent", area: "Facilities", amount: 360000}, {item: "Utilities", area: "Facilities", amount: 54000}, {item: "Cleaning", area: "Facilities", amount: 38000}, {item: "Cloud hosting", area: "Technology", amount: 290000}, {item: "Software licences", area: "Technology", amount: 176000}, {item: "Laptops", area: "Technology", amount: 98000}, {item: "Security tools", area: "Technology", amount: 64000}, {item: "Paid search", area: "Marketing", amount: 240000}, {item: "Events", area: "Marketing", amount: 132000}, {item: "Agency", area: "Marketing", amount: 110000}, {item: "Content", area: "Marketing", amount: 46000}, {item: "Travel", area: "Operations", amount: 88000}, {item: "Insurance", area: "Operations", amount: 72000}, {item: "Legal", area: "Operations", amount: 66000}, {item: "Accounting", area: "Operations", amount: 41000}, {item: "Training", area: "People", amount: 58000}, {item: "Recruiting", area: "People", amount: 94000}, {item: "Office supplies", area: "Facilities", amount: 17000}, {item: "Meals", area: "Operations", amount: 23000}, {item: "Phones", area: "Technology", amount: 19000}, {item: "Bank fees", area: "Operations", amount: 9000}]
state area="All"
derive shown={area == 'All' ? costs : filter(costs, 'area', area)}
card
  text "Brightline operating costs, 2026" style=title
  text "\${number(sum(shown, 'amount'))} across {plural(len(shown), 'line item')}. Bigger is more." tone=muted
  select "Area" items={['All', 'People', 'Technology', 'Marketing', 'Operations', 'Facilities']} bind=area
  chart kind=treemap items=shown x=item y=amount format=money`,
};

const funding: Example = {
  id: "where-funding-goes",
  title: "Where funding goes",
  prompt: "Show how Riverbend Trust's 2026 income flows to its programs",
  category: "Dashboards",
  look: { preset: "purple", scheme: "light" },
  spec: `state flows=[{source: "Grants", target: "Programs", amount: 820000}, {source: "Grants", target: "Operations", amount: 140000}, {source: "Donations", target: "Programs", amount: 510000}, {source: "Donations", target: "Fundraising", amount: 120000}, {source: "Donations", target: "Operations", amount: 90000}, {source: "Events", target: "Fundraising", amount: 60000}, {source: "Events", target: "Programs", amount: 45000}, {source: "Programs", target: "Clean water", amount: 610000}, {source: "Programs", target: "School meals", amount: 455000}, {source: "Programs", target: "Training", amount: 310000}, {source: "Operations", target: "Staff", amount: 160000}, {source: "Operations", target: "Office", amount: 70000}, {source: "Fundraising", target: "Staff", amount: 110000}, {source: "Fundraising", target: "Campaigns", amount: 70000}]
card
  text "Riverbend Trust: where 2026 funding goes" style=title
  text "Income on the left, what it pays for on the right. Hover a band for its amount." tone=muted
  chart kind=sankey items=flows from=source to=target y=amount format=money
  grid min=150 gap=10
    stat label="Raised" value="$1.79M"
    stat label="To programs" value="77%" tone=good`,
};

const booking: Example = {
  id: "book-a-table",
  title: "Book a table",
  prompt: "A booking form for our restaurant that tells people what's missing",
  category: "Plans",
  look: { preset: "neutral", scheme: "light", accent: "#8a4b2f" },
  simulated: "The booking request is simulated.",
  spec: `state name="" email="" guests=2 note="" booked=false
card
  text "Book a table at Juniper & Rye" style=title tip="Open Tuesday to Sunday, 5 pm to 11 pm"
  text "We'll email to confirm within the hour." tone=muted
  input "Name" bind=name required=true placeholder="e.g. Ana Ruiz"
  input "Email" bind=email kind=email required=true placeholder="name@example.com"
  input "Guests" bind=guests kind=number tip="Up to 8 online; call us for larger groups" error="{guests > 8 ? 'For more than 8, please call us' : ''}"
  input "Anything we should know?" bind=note lines=3 placeholder="Allergies, a high chair, a birthday…"
  button "Request a table" on="set:booked:true;emit:book" disabled={trim(name) == '' || trim(email) == '' || guests > 8}
  callout "Thanks, {name}! We'll email {email} shortly." tone=good if=booked`,
};

const storeOrders: Example = {
  id: "store-orders",
  title: "Store orders",
  prompt: "Today's orders, with the usual actions for each one and the activity log",
  category: "Shopping",
  look: { preset: "teal", scheme: "light" },
  simulated: "Exports and cancellations are simulated.",
  spec: `state orders=[{id: "NW-2041", customer: "Lumen Cinema", total: 412.5, status: "Open"}, {id: "NW-2042", customer: "Harbor Books", total: 96, status: "Open"}, {id: "NW-2043", customer: "Fieldstone Cafe", total: 1280, status: "Shipped"}] events=[{title: "NW-2043 shipped", when: "09:12"}, {title: "Refund approved: NW-2033", when: "08:40"}, {title: "New review: 5 stars", when: "08:05"}, {title: "Stock low: Ridge 28 L", when: "07:58"}, {title: "Invoice INV-1188 sent", when: "07:30"}, {title: "NW-2038 delivered", when: "Yesterday"}, {title: "Payment failed: NW-2036", when: "Yesterday"}, {title: "New customer: Lumen Cinema", when: "Mon"}] confirm=false target=""
derive open={count(orders, 'status', 'Open')}
card
  row align=center
    text "Today's orders" style=title
    menu "Export" align=end
      menu-item "Copy as CSV" icon=copy on=emit:export:csv
      menu-item "Download PDF" icon=download on=emit:export:pdf
  stat label="Waiting to ship" value={open} tip="Paid, not yet handed to the carrier"
  list
    each items=orders as=o key={o.id}
      row align=center
        column gap=2
          text "{o.id} · {o.customer}" weight=semibold
          text "{money(o.total)} · {o.status}" tone=muted
        menu label="Actions for {o.id}"
          menu-item "Mark shipped" icon=truck on=set:o.status:Shipped disabled={o.status == 'Shipped'}
          menu-item "Cancel order" icon=x-circle tone=bad on="set:target:{o.id};set:confirm:true"
  text "Activity" weight=semibold
  scroll "Activity" size=sm
    list
      each items=events as=e
        list-item "{e.title}" detail="{e.when}"
dialog "Cancel {target}?" bind=confirm size=sm
  text "The customer is emailed and any payment is refunded." tone=muted
  row
    button "Keep order" variant=secondary on=set:confirm:false
    button "Cancel order" variant=danger on="emit:cancel:{target};set:confirm:false"`,
};

export const examples: readonly Example[] = [tip, sales, pipeline, funds, costs, funding, cabin, org, claimFlow, launch, trip, laptop, cinema, coffee, grocery, tracking, budget, configurator, booking, storeOrders];

export const exampleById = (id: string): Example | undefined => examples.find((e) => e.id === id);
