text "Revenue Dashboard" style=title
grid min=170 gap=12
  card pad=18 gap=10
    stat label="Total Revenue" value={money(sum(revenue, 'amount'))} change="+8.4%" trend=up good=up spark=monthly
  card pad=18 gap=10
    stat label="Average Monthly Revenue" value={money(avg(revenue, 'amount'))}
  card pad=18 gap=10
    stat label="Best Month" value={first(sort(revenue, 'amount', 'desc')).month}
card pad=18 gap=10
  text "Revenue by month" style=title
  chart "Revenue by month, last 6 months" kind=bar items={revenue} x=month y=amount format=money
    chart-rule "Average" y={avg(revenue, 'amount')}
state monthly=[41000, 43500, 42800, 46200, 48100, 51300]
state revenue=[{month: "Jun", amount: 41000}, {month: "Jul", amount: 43500}, {month: "Aug", amount: 42800}, {month: "Sep", amount: 46200}, {month: "Oct", amount: 48100}, {month: "Nov", amount: 51300}]
