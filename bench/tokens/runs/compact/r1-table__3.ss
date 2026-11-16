state staff=[{name: "Maya Patel", department: "Engineering", salary: 128000, yoy: 6.5}, {name: "Liam Chen", department: "Design", salary: 104000, yoy: 4.2}, {name: "Sofia Garcia", department: "Marketing", salary: 92000, yoy: 3.1}, {name: "Noah Williams", department: "Sales", salary: 87000, yoy: -1.8}, {name: "Aisha Khan", department: "Finance", salary: 99000, yoy: 5.0}]
text "Employees" style=title
table "Employee salaries" items=staff key=name
  table-column "Name" field=name
  table-column "Department" field=department
  table-column "Salary" field=salary format=money align=right
  table-column "YoY change (%)" field=yoy format=number align=right
