report "Claims review" subtitle="40 claims across six lines" data=claims filter=status
  count
  sum incurred
  avg incurred
  count status=Open
  bar monthly month incurred
  line monthly month opened closed
  donut byLine line count
  table
