column gap=16 pad=16
  text "Revenue Dashboard" style=title
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="Total Revenue" value={money(sum(revenue, 'amount'))} change="+8.4%" trend=up good=up spark={pluck(revenue, 'amount')}
  card pad=18 gap=10
    chart "Revenue by month" kind=bar items={revenue} x=month y=amount format=money
state revenue=[{month: "Jun", amount: 42000}, {month: "Jul", amount: 45500}, {month: "Aug", amount: 43800}, {month: "Sep", amount: 49200}, {month: "Oct", amount: 52600}, {month: "Nov", amount: 56100}]
