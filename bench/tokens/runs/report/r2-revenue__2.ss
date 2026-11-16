report "Revenue dashboard" subtitle="Last 6 months" data=revenue
  sum revenue "Total Revenue"
  bar month revenue "Revenue by month"
state revenue=[{id: 1, month: "Jan", revenue: 42000}, {id: 2, month: "Feb", revenue: 38500}, {id: 3, month: "Mar", revenue: 51000}, {id: 4, month: "Apr", revenue: 47200}, {id: 5, month: "May", revenue: 55800}, {id: 6, month: "Jun", revenue: 61300}]
