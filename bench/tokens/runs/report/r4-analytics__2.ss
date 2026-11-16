report "Product analytics" subtitle="Users, acquisition, features and revenue" data=features
  bar mau month users "Monthly Active Users"
  pie acquisition channel users "User Acquisition"
  table name users adoption "Top Features"
  line revenue month mrr arr "MRR and ARR"
state features=[{id: 1, name: "Dashboards", users: 8400, adoption: 78}, {id: 2, name: "Reports", users: 7100, adoption: 66}, {id: 3, name: "Alerts", users: 5600, adoption: 52}, {id: 4, name: "Integrations", users: 4300, adoption: 40}, {id: 5, name: "Exports", users: 3200, adoption: 30}]
state mau=[{month: "Jan", users: 9200}, {month: "Feb", users: 9800}, {month: "Mar", users: 10600}, {month: "Apr", users: 11300}, {month: "May", users: 12100}, {month: "Jun", users: 13000}]
state acquisition=[{channel: "Organic", users: 4200}, {channel: "Paid", users: 2800}, {channel: "Referral", users: 1900}, {channel: "Social", users: 1300}, {channel: "Email", users: 900}]
state revenue=[{month: "Jan", mrr: 42000, arr: 504000}, {month: "Feb", mrr: 44500, arr: 534000}, {month: "Mar", mrr: 47200, arr: 566400}, {month: "Apr", mrr: 50100, arr: 601200}, {month: "May", mrr: 53000, arr: 636000}, {month: "Jun", mrr: 56400, arr: 676800}]
