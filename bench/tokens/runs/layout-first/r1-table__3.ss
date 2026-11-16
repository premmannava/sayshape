text "Employees" style=title
table "Employee compensation" items=employees key=name
  table-column "Name" field=name
  table-column "Department" field=department
  table-column "Salary" field=salary format=money align=right
  table-column "YoY change" field=yoy align=right
state employees=[{name: "Ava Thompson", department: "Engineering", salary: 128000, yoy: "+6.2%"}, {name: "Marcus Lee", department: "Marketing", salary: 94000, yoy: "+3.8%"}, {name: "Priya Nair", department: "Design", salary: 112000, yoy: "+5.1%"}, {name: "Daniel Ortiz", department: "Sales", salary: 87000, yoy: "-1.4%"}, {name: "Hannah Weiss", department: "Finance", salary: 101000, yoy: "+2.9%"}]
