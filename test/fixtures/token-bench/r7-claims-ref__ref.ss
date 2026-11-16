text "Claims review" style=title
state status="All" statuses=["All", "Open", "In review", "Closed", "Denied"]
derive shown={status == 'All' ? claims : filter(claims, 'status', status)}
select "Status" items=statuses bind=status
grid min=140 gap=12
  stat label="Claims" value={len(shown)}
  stat label="Incurred" value={compact(sum(shown, 'incurred'), 'USD')}
  stat label="Average days" value={round(avg(shown, 'days'))}
  stat label="Open" value={count(claims, 'status', 'Open')}
chart "Claims by month" kind=bar items=monthly x=month y=opened
chart "Opened and closed" kind=line items=monthly x=month y=opened,closed
chart "By line" kind=donut items=byLine x=line y=count
table items=shown key=id
  table-column "Claim" field=id
  table-column "Status" field=status
  table-column "Incurred" field=incurred format=money
