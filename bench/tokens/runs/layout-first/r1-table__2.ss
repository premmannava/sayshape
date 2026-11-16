card
  text "Employee Compensation" style=title
  text "Salary and year-over-year change for 5 employees" tone=muted
  table "Employees" items=employees key=name
    table-column "Name" field=name
    table-column "Department" field=department
    table-column "Salary" field=salary format=money align=right
    table-column "YoY change" field=yoy align=right

state employees=[{name: "Ava Thompson", department: "Engineering", salary: 142000, yoy: "+6.5%"}, {name: "Marcus Lee", department: "Design", salary: 118000, yoy: "+4.2%"}, {name: "Priya Patel", department: "Product", salary: 135000, yoy: "+5.8%"}, {name: "Daniel Ortiz", department: "Sales", salary: 98000, yoy: "+3.1%"}, {name: "Sofia Rossi", department: "Marketing", salary: 91000, yoy: "-1.2%"}]
