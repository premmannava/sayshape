report "Product analytics" subtitle="Users, acquisition, features and revenue" data=features
  bar users month mau "Monthly Active Users"
  pie acquisition channel users "User Acquisition"
  table feature usage "Top Features"
  line revenue month mrr arr "MRR and ARR"
state users=[{month: "Jan", mau: 12400}, {month: "Feb", mau: 13100}, {month: "Mar", mau: 14250}, {month: "Apr", mau: 15300}, {month: "May", mau: 16800}, {month: "Jun", mau: 18200}]
state acquisition=[{channel: "Organic", users: 5200}, {channel: "Paid", users: 3100}, {channel: "Referral", users: 2400}, {channel: "Social", users: 1700}, {channel: "Email", users: 900}]
state features=[{id: 1, feature: "Dashboards", usage: 9200}, {id: 2, feature: "Reports", usage: 7400}, {id: 3, feature: "Alerts", usage: 5100}, {id: 4, feature: "Integrations", usage: 4300}, {id: 5, feature: "Exports", usage: 3200}]
state revenue=[{month: "Jan", mrr: 82000, arr: 984000}, {month: "Feb", mrr: 87500, arr: 1050000}, {month: "Mar", mrr: 93000, arr: 1116000}, {month: "Apr", mrr: 99500, arr: 1194000}, {month: "May", mrr: 106000, arr: 1272000}, {month: "Jun", mrr: 114000, arr: 1368000}]
