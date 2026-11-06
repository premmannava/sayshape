/** The d1 sales dashboard, written as a model would once card variants exist. */
export const showcase: Record<string, string> = {
  dense: `state team="all" period={from: "2026-10-01", to: "2026-10-31"} view="Weekly"
state teams=[{id: "all", name: "All teams"}, {id: "eu", name: "Europe"}, {id: "na", name: "North America"}]
state weeks=[{w: "W40", mrr: 412, new: 38, churn: 11}, {w: "W41", mrr: 428, new: 44, churn: 9}, {w: "W42", mrr: 437, new: 35, churn: 14}, {w: "W43", mrr: 455, new: 51, churn: 10}, {w: "W44", mrr: 468, new: 47, churn: 8}]
state kpis=[{name: "New ARR", actual: 182, goal: 200}, {name: "Net retention", actual: 112, goal: 110}, {name: "Pipeline", actual: 3.1, goal: 4}, {name: "Win rate", actual: 24, goal: 30}]
state deals=[{id: "D-1042", account: "Northwind Health", owner: "Priya S.", stage: "Negotiation", value: 184000, risk: "Low"}, {id: "D-1043", account: "Contoso Retail", owner: "Marco D.", stage: "Proposal", value: 92000, risk: "Medium"}, {id: "D-1047", account: "Fabrikam Labs", owner: "Aisha K.", stage: "Discovery", value: 64000, risk: "High"}, {id: "D-1051", account: "Tailspin Air", owner: "Priya S.", stage: "Negotiation", value: 241000, risk: "Low"}, {id: "D-1055", account: "Wide World Imports", owner: "Leo T.", stage: "Proposal", value: 118000, risk: "Medium"}]
column gap=16
  row align=bottom
    text "Revenue operations" style=title
    select "Team" items=teams value=id label=name bind=team
    date-picker "Period" bind=period range=true
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="MRR" value="$468K" change="+2.9%" spark={[412, 428, 437, 455, 468]}
    card pad=18 gap=10
      stat label="New customers" value="215" change="+14%"
    card pad=18 gap=10
      stat label="Churned" value="52" change="-8%" good=down
    card pad=18 gap=10
      stat label="Gross margin" value="78.4%" change="+0.6 pts"
  grid min=320 gap=12
    card
      segmented bind=view options="Weekly,Monthly"
      chart "New vs churned customers" kind=line items=weeks x=w y=new,churn labels="New,Churned"
    card
      chart "Q4 targets" kind=bullet items=kpis x=name y=actual target=goal
  card
    row align=center
      text "Open deals" weight=semibold
      badge "5 in play" tone=accent
    table items=deals key=id
      table-column "Deal" field=id
      table-column "Account" field=account
      table-column "Owner" field=owner
      table-column "Stage" field=stage
      table-column "Value" field=value format=money
      table-column "Risk" field=risk`,
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
