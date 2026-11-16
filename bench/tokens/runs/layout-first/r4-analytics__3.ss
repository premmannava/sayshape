column gap=16 pad=16
  row align=center
    column gap=2
      text "Product Analytics" style=title
      text "Last 12 months, all platforms" tone=muted style=caption
    segmented bind=range label="Time range" options="30D,90D,12M"
  grid min=170 gap=12
    stat label="Monthly active users" value={compact(last(mau).users)} change="+6.2%" trend=up good=up spark=mauTrend
    stat label="MRR" value={compact(last(revenue).mrr, 'USD')} change="+4.8%" trend=up good=up spark=mrrTrend
    stat label="ARR" value={compact(last(revenue).arr, 'USD')} change="+4.8%" trend=up good=up
    stat label="New signups" value={number(sum(acq, 'users'))} change="+9.1%" trend=up good=up
  grid min=300 gap=12
    card pad=18 gap=10
      chart "Monthly active users" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      chart "User acquisition by channel" kind=pie items={acq} x=channel y=users format=number
  card pad=18 gap=10
    chart "MRR and ARR" kind=line items={revenue} x=month y=mrr,arr format=money
  card pad=18 gap=10
    text "Top features" style=title
    table "Top features by usage" items={sort(features, 'users', 'desc')} key=name
      table-column "Feature" field=name
      table-column "Active users" field=users format=number align=right
      table-column "Adoption %" field=adoption format=number align=right
      table-column "Sessions per user" field=sessions format=number align=right
state range="12M" mauTrend=[41200, 43800, 46100, 49500, 52300, 55800] mrrTrend=[118000, 122500, 127000, 133000, 139500, 146000]
state acq=[{channel: "Organic search", users: 5200}, {channel: "Referral", users: 2900}, {channel: "Paid ads", users: 3400}, {channel: "Social", users: 1800}, {channel: "Email", users: 1100}]
state features=[{name: "Dashboards", users: 38400, adoption: 69, sessions: 14.2}, {name: "Reports export", users: 29100, adoption: 52, sessions: 6.8}, {name: "Team sharing", users: 24700, adoption: 44, sessions: 9.5}, {name: "Alerts", users: 19300, adoption: 35, sessions: 5.1}, {name: "API access", users: 11800, adoption: 21, sessions: 22.7}]
state mau=[{month: "Jan", users: 31200}, {month: "Feb", users: 32800}, {month: "Mar", users: 34500}, {month: "Apr", users: 36900}, {month: "May", users: 38400}, {month: "Jun", users: 41200}, {month: "Jul", users: 43800}, {month: "Aug", users: 46100}, {month: "Sep", users: 49500}, {month: "Oct", users: 52300}, {month: "Nov", users: 55800}]
state revenue=[{month: "Jan", mrr: 96000, arr: 1152000}, {month: "Feb", mrr: 99500, arr: 1194000}, {month: "Mar", mrr: 103200, arr: 1238400}, {month: "Apr", mrr: 108000, arr: 1296000}, {month: "May", mrr: 113500, arr: 1362000}, {month: "Jun", mrr: 118000, arr: 1416000}, {month: "Jul", mrr: 122500, arr: 1470000}, {month: "Aug", mrr: 127000, arr: 1524000}, {month: "Sep", mrr: 133000, arr: 1596000}, {month: "Oct", mrr: 139500, arr: 1674000}, {month: "Nov", mrr: 146000, arr: 1752000}]
