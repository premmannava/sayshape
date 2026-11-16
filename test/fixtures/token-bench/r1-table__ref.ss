state staff=[{name: "Ada", dept: "Eng", salary: 120000, yoy: 4}, {name: "Bo", dept: "Sales", salary: 90000, yoy: 3}, {name: "Cy", dept: "Ops", salary: 80000, yoy: -1}, {name: "Di", dept: "Eng", salary: 130000, yoy: 6}, {name: "Ed", dept: "HR", salary: 70000, yoy: 2}]
table items=staff
  table-column "Name" field=name
  table-column "Department" field=dept
  table-column "Salary" field=salary format=money
  table-column "YoY change" field=yoy
