state range="Last 12 months" mau=[{month: "Dec", users: 41200}, {month: "Jan", users: 43800}, {month: "Feb", users: 45100}, {month: "Mar", users: 48700}, {month: "Apr", users: 51300}, {month: "May", users: 54900}, {month: "Jun", users: 57200}, {month: "Jul", users: 60800}, {month: "Aug", users: 63500}, {month: "Sep", users: 67100}, {month: "Oct", users: 70400}, {month: "Nov", users: 74200}] sources=[{channel: "Organic search", users: 18400}, {channel: "Direct", users: 12600}, {channel: "Referral", users: 8300}, {channel: "Paid ads", users: 9700}, {channel: "Social", users: 5200}] features=[{name: "Dashboards", users: 48200, adoption: 65, retention: 82}, {name: "Reports", users: 39600, adoption: 53, retention: 74}, {name: "Integrations", users: 31400, adoption: 42, retention: 79}, {name: "Alerts", users: 24800, adoption: 33, retention: 68}, {name: "Team sharing", users: 19300, adoption: 26, retention: 71}] revenue=[{month: "Jun", mrr: 182000, arr: 2184000}, {month: "Jul", mrr: 191000, arr: 2292000}, {month: "Aug", mrr: 198000, arr: 2376000}, {month: "Sep", mrr: 207000, arr: 2484000}, {month: "Oct", mrr: 216000, arr: 2592000}, {month: "Nov", mrr: 226000, arr: 2712000}]
derive latest={last(mau).users}
derive first_mau={first(mau).users}
derive growth={round((latest - first_mau) / first_mau * 100)}
derive totalAcq={sum(sources, 'users')}
derive topChannel={first(sort(sources, 'users', 'desc')).channel}
derive curMrr={last(revenue).mrr}
derive curArr={last(revenue).arr}
column gap=16 pad=16
  row gap=12 align=center
    column gap=4
      text "Product analytics" style=title
      text "Usage, acquisition and revenue at a glance" tone=muted
    select "Date range" items={['Last 30 days', 'Last 90 days', 'Last 12 months']} bind=range
  grid min=170 gap=12
    stat label="Monthly active users" value={compact(latest)} change="+{growth}%" trend=up good=up spark={pluck(mau, 'users')}
    stat label="New users (Nov)" value={compact(totalAcq)} change="+6%" trend=up good=up
    stat label="MRR" value={money(curMrr)} change="+4.6%" trend=up good=up
    stat label="ARR" value={compact(curArr, 'USD')} change="+4.6%" trend=up good=up
  grid min=300 gap=12
    card pad=18 gap=10
      chart "Monthly active users" kind=bar items={mau} x=month y=users format=number
    card pad=18 gap=10
      chart "User acquisition by channel" kind=pie items={sources} x=channel y=users
      text "{topChannel} is the largest source of new users." tone=muted style=caption
  card pad=18 gap=10
    text "Top features" style=lead weight=semibold
    table "Top features by active users" items={sort(features, 'users', 'desc')} key=name
      table-column "Feature" field=name
      table-column "Active users" field=users format=number align=right
      table-column "Adoption %" field=adoption format=number align=right
      table-column "Retention %" field=retention format=number align=right
  card pad=18 gap=10
    chart "MRR and ARR" kind=line items={revenue} x=month y=mrr,arr format=money
