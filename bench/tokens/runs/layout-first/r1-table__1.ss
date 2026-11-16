card
  text "Employees" style=title
  table "Employee compensation" items={employees} key=name
    table-column "Name" field=name
    table-column "Department" field=department
    table-column "Salary" field=salary format=money align=right
    table-column "YoY change" field=yoy format=text align=right

state employees=[{name: "Ava Thompson", department: "Engineering", salary: 128000, yoy: "+6.2%"}, {name: "Marcus Lee", department: "Design", salary: 104000, yoy: "+4.5%"}, {name: "Priya Patel", department: "Marketing", salary: 92000, yoy: "+3.1%"}, {name: "Daniel Garcia", department: "Sales", salary: 98000, yoy: "-1.4%"}, {name: "Hannah Wright", department: "Finance", salary: 110000, yoy: "+5.0%"}]
