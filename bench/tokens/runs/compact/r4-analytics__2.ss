state range="Last 12 months" mau=[{month: "Dec", users: 41200}, {month: "Jan", users: 43800}, {month: "Feb", users: 46100}, {month: "Mar", users: 49500}, {month: "Apr", users: 52300}, {month: "May", users: 55900}, {month: "Jun", users: 58700}, {month: "Jul", users: 61200}, {month: "Aug", users: 64800}, {month: "Sep", users: 68400}, {month: "Oct", users: 72100}, {month: "Nov", users: 76500}]
state acquisition=[{channel: "Organic search", users: 18400}, {channel: "Referral", users: 9600}, {channel: "Paid ads", users: 12300}, {channel: "Social", users: 7200}, {channel: "Email", users: 5100}, {channel: "Direct", users: 8900}]
state features=[{feature: "Dashboards", users: 48200, adoption: 63, retention: 88}, {feature: "Reports", users: 39700, adoption: 52, retention: 81}, {feature: "Integrations", users: 31400, adoption: 41, retention: 77}, {feature: "Alerts", users: 26800, adoption: 35, retention: 72}, {feature: "Team sharing", users: 22100, adoption: 29, retention: 69}, {feature: "API access", users: 12600, adoption: 16, retention: 83}]
state revenue=[{month: "Jun", mrr: 182000, arr: 2184000}, {month: "Jul", mrr: 191500, arr: 2298000}, {month: "Aug", mrr: 203800, arr: 2445600}, {month: "Sep", mrr: 214200, arr: 2570400}, {month: "Oct", mrr: 227600, arr: 2731200}, {month: "Nov", mrr: 241300, arr: 2895600}]
derive latest={last(mau).users}
derive previous={mau[mau.length - 2].users}
derive growth={round((latest - previous) / previous * 100)}
derive totalAcquired={sum(acquisition, 'users')}
derive topChannel={first(sort(acquisition, 'users', 'desc')).channel}
derive mrrNow={last(revenue).mrr}
derive arrNow={last(revenue).arr}
column gap=16 pad=16
  column gap=4
    text "Product analytics" style=title
    text "Engagement, acquisition and revenue for {range}" tone=muted
  segmented bind=range label="Date range" options="Last 12 months,Last 6 months,Last 30 days"
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="Monthly active users" value={compact(latest)} change="+{growth}% vs last month" trend=up good=up spark={pluck(mau, 'users')}
    card pad=18 gap=10
      stat label="New users acquired" value={compact(totalAcquired)} change="Top channel: {topChannel}" trend=flat
    card pad=18 gap=10
      stat label="MRR" value={compact(mrrNow, 'USD')} change="+6%" trend=up good=up spark={pluck(revenue, 'mrr')}
    card pad=18 gap=10
      stat label="ARR" value={compact(arrNow, 'USD')} change="+6%" trend=up good=up spark={pluck(revenue, 'arr')}
  grid min=300 gap=12
    card pad=18 gap=10
      chart "Monthly active users" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      chart "User acquisition by channel" kind=pie items={acquisition} x=channel y=users format=number
  card pad=18 gap=10
    text "Top features" style=title
    table "Top features by usage" items={sort(features, 'users', 'desc')} key=feature
      table-column "Feature" field=feature
      table-column "Active users" field=users format=number align=right
      table-column "Adoption %" field=adoption format=number align=right
      table-column "Retention %" field=retention format=number align=right
  card pad=18 gap=10
    chart "MRR and ARR" kind=line items={revenue} x=month y=mrr,arr format=money
