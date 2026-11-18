column gap=16 pad=16
  row align=center
    column gap=2
      text "Product Analytics" style=title
      text "Last 12 months, all platforms" tone=muted
    segmented bind=range label="Date range" options="30D,90D,12M"
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="Monthly active users" value={compact(last(mau).users)} change="+6.2%" trend=up spark={pluck(mau, 'users')}
    card pad=18 gap=10
      stat label="MRR" value={money(last(revenue).mrr)} change="+4.8%" trend=up spark={pluck(revenue, 'mrr')}
    card pad=18 gap=10
      stat label="ARR" value={compact(last(revenue).arr, 'USD')} change="+4.8%" trend=up
    card pad=18 gap=10
      stat label="New users (acquired)" value={compact(sum(acquisition, 'users'))} change="+9.1%" trend=up
  grid min=320 gap=12
    card pad=18 gap=10
      chart "Monthly active users" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      chart "User acquisition by channel" kind=pie items={acquisition} x=channel y=users
  card pad=18 gap=10
    text "Top features" style=title
    table items={sort(features, 'usage', 'desc')} key=name
      table-column "Feature" field=name
      table-column "Weekly users" field=usage format=number align=right
      table-column "Adoption %" field=adoption format=number align=right
      table-column "Retention %" field=retention format=number align=right
  card pad=18 gap=10
    chart "MRR and ARR" kind=line items={revenue} x=month y=mrr,arr format=money
state range="12M"
state mau=[{month: "Dec", users: 41200}, {month: "Jan", users: 43800}, {month: "Feb", users: 45100}, {month: "Mar", users: 47900}, {month: "Apr", users: 50300}, {month: "May", users: 52600}, {month: "Jun", users: 54100}, {month: "Jul", users: 57800}, {month: "Aug", users: 60200}, {month: "Sep", users: 63500}, {month: "Oct", users: 66900}, {month: "Nov", users: 71000}]
state acquisition=[{channel: "Organic search", users: 12400}, {channel: "Referral", users: 8200}, {channel: "Paid ads", users: 6900}, {channel: "Social", users: 4800}, {channel: "Email", users: 3100}]
state features=[{name: "Dashboards", usage: 38400, adoption: 74, retention: 88}, {name: "Reports export", usage: 29100, adoption: 56, retention: 81}, {name: "Alerts", usage: 22700, adoption: 44, retention: 79}, {name: "Integrations", usage: 18900, adoption: 36, retention: 85}, {name: "Team sharing", usage: 15200, adoption: 29, retention: 76}]
state revenue=[{month: "Dec", mrr: 182000, arr: 2184000}, {month: "Jan", mrr: 188500, arr: 2262000}, {month: "Feb", mrr: 194200, arr: 2330400}, {month: "Mar", mrr: 201800, arr: 2421600}, {month: "Apr", mrr: 209300, arr: 2511600}, {month: "May", mrr: 216700, arr: 2600400}, {month: "Jun", mrr: 222400, arr: 2668800}, {month: "Jul", mrr: 231900, arr: 2782800}, {month: "Aug", mrr: 240100, arr: 2881200}, {month: "Sep", mrr: 249600, arr: 2995200}, {month: "Oct", mrr: 259800, arr: 3117600}, {month: "Nov", mrr: 272300, arr: 3267600}]
