report "Claims review" subtitle="All claims" data=claims filter=status
  count
  sum incurred
  avg incurred
  count status=Open
  bar monthly month incurred
  line monthly month opened closed
  donut byLine line incurred
  table
