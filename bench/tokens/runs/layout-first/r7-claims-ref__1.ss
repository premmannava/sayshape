column gap=16 pad=16
  text "Claims review" style=title
  grid min=170 gap=12
    card pad=18 gap=10
      stat label="Total claims" value={len(claims)}
    card pad=18 gap=10
      stat label="Total incurred" value={compact(sum(claims, 'incurred'), 'USD')}
    card pad=18 gap=10
      stat label="Open claims" value={count(claims, 'status', 'Open')} tone=accent
    card pad=18 gap=10
      stat label="Avg days to date" value={round(avg(claims, 'days'))}
  grid min=300 gap=12
    card pad=18 gap=10
      text "Incurred by month" style=lead weight=semibold
      chart "Incurred by month" kind=bar items={monthly} x=month y=incurred format=money
    card pad=18 gap=10
      text "Claims opened and closed by month" style=lead weight=semibold
      chart "Opened and closed by month" kind=line items={monthly} x=month y=opened,closed
    card pad=18 gap=10
      text "Incurred by line" style=lead weight=semibold
      chart "Incurred by line" kind=donut items={byLine} x=line y=incurred format=money
  card pad=18 gap=10
    text "All claims" style=lead weight=semibold
    segmented bind=status label="Filter by status" options="All,Open,In review,Closed,Denied"
    text "{len(shown)} of {len(claims)} claims shown" tone=muted style=caption
    table "Claims" items={shown} key=id
      table-column "ID" field=id
      table-column "Opened" field=opened
      table-column "Line" field=line
      table-column "Site" field=site
      table-column "Status" field=status
      table-column "Incurred" field=incurred format=money align=right
      table-column "Days" field=days format=number align=right
    empty "No claims with this status" if={len(shown) == 0}

derive shown={status == 'All' ? claims : filter(claims, 'status', status)}
state status="All"
