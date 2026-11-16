state status="All"
derive shown={status == 'All' ? claims : filter(claims, 'status', status)}
text "Claims review" style=title
grid min=140 gap=12
  stat label="Total claims" value={len(claims)}
  stat label="Total incurred" value={compact(sum(claims, 'incurred'), 'USD')}
  stat label="Open claims" value={count(claims, 'status', 'Open')}
  stat label="Avg days to resolve" value={fixed(avg(claims, 'days'), 1)}
grid min=300 gap=12
  card pad=18 gap=10
    chart "Incurred by month" kind=bar items=monthly x=month y=incurred format=money
  card pad=18 gap=10
    chart "Opened and closed by month" kind=line items=monthly x=month y=opened,closed
  card pad=18 gap=10
    chart "Incurred by line" kind=donut items=byLine x=line y=incurred format=money
card pad=18 gap=10
  text "All claims" style=lead
  segmented bind=status label="Filter by status" options="All,Open,In review,Closed,Denied"
  text "Showing {len(shown)} of {len(claims)} claims" tone=muted style=caption
  table "Claims" items=shown key=id
    table-column "ID" field=id
    table-column "Opened" field=opened
    table-column "Line" field=line
    table-column "Site" field=site
    table-column "Status" field=status
    table-column "Incurred" field=incurred format=money align=right
    table-column "Days" field=days format=number align=right
