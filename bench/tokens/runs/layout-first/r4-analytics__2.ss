column gap=16 pad=16
  column gap=4
    text "Product Analytics" style=title
    text "Engagement, acquisition and revenue for the last 12 months" tone=muted
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="Monthly active users" value={compact(last(mau).users)} change="+6.2%" trend=up spark=mauTrend
    card pad=18 gap=10
      stat label="MRR" value={money(last(revenue).mrr)} change="+4.8%" trend=up spark=mrrTrend
    card pad=18 gap=10
      stat label="ARR" value={compact(last(revenue).arr, 'USD')} change="+4.8%" trend=up
    card pad=18 gap=10
      stat label="New signups" value={compact(sum(channels, 'users'))} change="+9.1%" trend=up
  grid min=320 gap=12
    card pad=18 gap=10
      text "Monthly active users" style=title
      chart "Monthly active users by month" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      text "User acquisition" style=title
      chart "New users by acquisition channel" kind=pie items={channels} x=channel y=users
  grid min=320 gap=12
    card pad=18 gap=10
      text "Top features" style=title
      table "Top features by usage" items={sort(features, 'usage', 'desc')} key=name
        table-column "Feature" field=name
        table-column "Weekly users" field=usage format=number align=right
        table-column "Adoption %" field=adoption format=number align=right
        table-column "Retention %" field=retention format=number align=right
    card pad=18 gap=10
      text "MRR and ARR" style=title
      chart "MRR and ARR by month" kind=line items={revenue} x=month y=mrr,arr format=money

derive mauTrend={pluck(mau, 'users')}
derive mrrTrend={pluck(revenue, 'mrr')}
state mau=[{month: "Dec", users: 41200}, {month: "Jan", users: 43800}, {month: "Feb", users: 45100}, {month: "Mar", users: 47900}, {month: "Apr", users: 50300}, {month: "May", users: 52600}, {month: "Jun", users: 54100}, {month: "Jul", users: 57400}, {month: "Aug", users: 59800}, {month: "Sep", users: 62500}, {month: "Oct", users: 65200}, {month: "Nov", users: 69300}]
state channels=[{channel: "Organic search", users: 8400}, {channel: "Paid ads", users: 5600}, {channel: "Referral", users: 3900}, {channel: "Social", users: 3100}, {channel: "Email", users: 2200}]
state features=[{name: "Dashboards", usage: 28400, adoption: 78, retention: 91}, {name: "Reports", usage: 22100, adoption: 61, retention: 86}, {name: "Alerts", usage: 17800, adoption: 49, retention: 82}, {name: "Integrations", usage: 14300, adoption: 39, retention: 88}, {name: "Team sharing", usage: 11900, adoption: 33, retention: 79}]
state revenue=[{month: "Dec", mrr: 182000, arr: 2184000}, {month: "Jan", mrr: 188500, arr: 2262000}, {month: "Feb", mrr: 194200, arr: 2330400}, {month: "Mar", mrr: 201800, arr: 2421600}, {month: "Apr", mrr: 209400, arr: 2512800}, {month: "May", mrr: 216700, arr: 2600400}, {month: "Jun", mrr: 224100, arr: 2689200}, {month: "Jul", mrr: 233500, arr: 2802000}, {month: "Aug", mrr: 241900, arr: 2902800}, {month: "Sep", mrr: 251300, arr: 3015600}, {month: "Oct", mrr: 261800, arr: 3141600}, {month: "Nov", mrr: 274400, arr: 3292800}]
