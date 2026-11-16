report "Revenue dashboard" subtitle="Last 6 months" data=revenue
  sum revenue "Total Revenue"
  bar month revenue "Monthly revenue"
state revenue=[{month: "Jan", revenue: 42000}, {month: "Feb", revenue: 45500}, {month: "Mar", revenue: 51200}, {month: "Apr", revenue: 48700}, {month: "May", revenue: 55300}, {month: "Jun", revenue: 60100}]
