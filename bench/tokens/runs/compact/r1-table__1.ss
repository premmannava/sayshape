state employees=[{name: "Ava Thompson", department: "Engineering", salary: 128000, yoy: 6.5}, {name: "Marcus Lee", department: "Design", salary: 104000, yoy: 4.2}, {name: "Priya Patel", department: "Product", salary: 135000, yoy: 8.1}, {name: "Daniel Okafor", department: "Sales", salary: 92000, yoy: -1.5}, {name: "Sofia Rossi", department: "Marketing", salary: 88000, yoy: 3.0}]
card
  text "Employees" style=title
  table "Employee salaries" items={employees} key=name
    table-column "Name" field=name
    table-column "Department" field=department
    table-column "Salary" field=salary format=money align=right
    table-column "YoY change (%)" field=yoy format=number align=right
