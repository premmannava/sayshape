report "Revenue dashboard" subtitle="Last 6 months" data=revenue
  sum amount "Total Revenue"
  bar month amount "Monthly Revenue"
state revenue=[{month: "Jan", amount: 42000}, {month: "Feb", amount: 38500}, {month: "Mar", amount: 45200}, {month: "Apr", amount: 51000}, {month: "May", amount: 48700}, {month: "Jun", amount: 55300}]
