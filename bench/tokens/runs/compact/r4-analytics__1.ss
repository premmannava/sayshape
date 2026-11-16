state mau=[{month: "Jun", users: 41200}, {month: "Jul", users: 43800}, {month: "Aug", users: 46100}, {month: "Sep", users: 49700}, {month: "Oct", users: 53400}, {month: "Nov", users: 57900}]
state channels=[{channel: "Organic search", users: 18400}, {channel: "Referral", users: 9600}, {channel: "Paid ads", users: 7300}, {channel: "Social", users: 5200}, {channel: "Email", users: 3800}]
state features=[{feature: "Dashboards", users: 38200, adoption: 66, satisfaction: 4.6}, {feature: "Reports", users: 31500, adoption: 54, satisfaction: 4.3}, {feature: "Integrations", users: 24800, adoption: 43, satisfaction: 4.4}, {feature: "Alerts", users: 19300, adoption: 33, satisfaction: 4.1}, {feature: "Team sharing", users: 15700, adoption: 27, satisfaction: 4.5}]
state revenue=[{month: "Jun", mrr: 182000, arr: 2184000}, {month: "Jul", mrr: 191500, arr: 2298000}, {month: "Aug", mrr: 203000, arr: 2436000}, {month: "Sep", mrr: 214800, arr: 2577600}, {month: "Oct", mrr: 229400, arr: 2752800}, {month: "Nov", mrr: 244100, arr: 2929200}]
derive latestMau={last(mau).users}
derive prevMau={mau[mau.length - 2].users}
derive latestMrr={last(revenue).mrr}
derive latestArr={last(revenue).arr}
column gap=16 pad=16
  column gap=4
    text "Product analytics" style=title
    text "Last 6 months, through November" tone=muted
  grid min=170 gap=12
    stat label="Monthly active users" value={compact(latestMau)} change="+8.4%" trend=up good=up spark={pluck(mau, 'users')}
    stat label="MRR" value={compact(latestMrr, 'USD')} change="+6.4%" trend=up good=up spark={pluck(revenue, 'mrr')}
    stat label="ARR" value={compact(latestArr, 'USD')} change="+6.4%" trend=up good=up spark={pluck(revenue, 'arr')}
  grid min=300 gap=12
    card pad=18 gap=10
      text "Monthly active users" style=title
      chart "Monthly active users by month" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      text "User acquisition" style=title
      chart "New users by acquisition channel" kind=pie items={channels} x=channel y=users format=number
  card pad=18 gap=10
    text "Top features" style=title
    table "Top features by usage" items={features} key=feature
      table-column "Feature" field=feature
      table-column "Active users" field=users format=number align=right
      table-column "Adoption %" field=adoption format=number align=right
      table-column "Satisfaction" field=satisfaction format=number align=right
  card pad=18 gap=10
    text "MRR and ARR" style=title
    chart "MRR and ARR by month" kind=line items={revenue} x=month y=mrr,arr format=money
