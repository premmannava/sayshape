/** The d1 sales dashboard, written as a model would once card variants exist. */
export const showcase: Record<string, string> = {
  hero: `state region="All"
state orders=[{id: "A101", customer: "Acme", region: "NA", total: 12400, status: "Shipped"}, {id: "A102", customer: "Globex", region: "EU", total: 8600, status: "Pending"}, {id: "A103", customer: "Initech", region: "NA", total: 23100, status: "Shipped"}, {id: "A104", customer: "Umbrella", region: "APAC", total: 4100, status: "Cancelled"}, {id: "A105", customer: "Stark", region: "NA", total: 31500, status: "Pending"}, {id: "A106", customer: "Wayne", region: "EU", total: 17800, status: "Shipped"}, {id: "A107", customer: "Tyrell", region: "APAC", total: 9900, status: "Shipped"}, {id: "A108", customer: "Soylent", region: "APAC", total: 14300, status: "Pending"}]
state months=[{m: "May", r: 82}, {m: "Jun", r: 91}, {m: "Jul", r: 88}, {m: "Aug", r: 104}, {m: "Sep", r: 112}, {m: "Oct", r: 121.7}]
derive inRegion={region == 'All' ? orders : filter(orders, 'region', region)}
derive top={take(sort(inRegion, 'total', 'desc'), 5)}
column gap=16
  row align=center
    text "Sales overview" style=title
    segmented bind=region options="All,NA,EU,APAC"
  card variant=hero
    text "Revenue this quarter" tone=muted
    text "{money(sum(inRegion, 'total'))}" style=display
    progress value=72 label="72% of the $170K target"
    row
      button "Export report" on=emit:export
      button "Share" variant=secondary on=emit:share
  grid min=150 gap=12
    card pad=18 gap=10
      stat label="Orders" value="{len(inRegion)}" change="+12%" trend=up
    card pad=18 gap=10
      stat label="Avg order" value="{money(round(avg(inRegion, 'total'), 0))}" change="+4%" trend=up
    card pad=18 gap=10
      stat label="Pending" value="{count(inRegion, 'status', 'Pending')}" change="-2" trend=down good=down
  grid min=300 gap=12
    card
      chart "Monthly revenue ($K)" kind=area items=months x=m y=r
    card variant=tinted
      chart "Top customers" kind=hbar items=top x=customer y=total format=money
  card variant=outline
    text "Recent orders" weight=semibold
    table items=inRegion key=id
      table-column "Order" field=id
      table-column "Customer" field=customer
      table-column "Region" field=region
      table-column "Status" field=status
      table-column "Total" field=total format=money`,
};
