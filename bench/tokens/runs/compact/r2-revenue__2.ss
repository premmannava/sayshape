state revenue=[{month: "Jun", amount: 48200}, {month: "Jul", amount: 52100}, {month: "Aug", amount: 49800}, {month: "Sep", amount: 57300}, {month: "Oct", amount: 61400}, {month: "Nov", amount: 66900}]
derive total={sum(revenue, 'amount')}
text "Revenue Dashboard" style=title
grid min=170 gap=12
  card pad=18 gap=10
    stat label="Total Revenue" value={money(total)} change="+38.8% since June" trend=up good=up spark={pluck(revenue, 'amount')}
  card pad=18 gap=10
    chart "Revenue by month" kind=bar items=revenue x=month y=amount format=money
