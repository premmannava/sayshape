text "Revenue Dashboard" style=title
grid min=170 gap=12
  card pad=18 gap=10
    stat label="Total Revenue" value={money(sum(revenue, 'amount'))} change="+8.4%" trend=up good=up spark=monthly
  card pad=18 gap=10
    stat label="Average per Month" value={money(avg(revenue, 'amount'))}
  card pad=18 gap=10
    stat label="Best Month" value={first(sort(revenue, 'amount', 'desc')).month}
card pad=18 gap=10
  chart "Revenue by month" kind=bar items={revenue} x=month y=amount format=money
    chart-rule "Average" y={avg(revenue, 'amount')}
derive monthly={pluck(revenue, 'amount')}
state revenue=[{month: "Jun", amount: 42000}, {month: "Jul", amount: 45500}, {month: "Aug", amount: 43200}, {month: "Sep", amount: 49800}, {month: "Oct", amount: 53100}, {month: "Nov", amount: 57600}]
