report "Claims review" subtitle="40 claims by status, line and month" data=claims filter=status
  count
  sum incurred
  avg incurred
  count status=Open
  bar monthly month incurred
  line monthly month opened closed
  donut line
  table
