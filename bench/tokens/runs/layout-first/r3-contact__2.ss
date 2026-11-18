state name="" email="" phone="" subject="General inquiry" message=""
column gap=12 pad=16
  text "Contact us" style=title
  text "Send us a message and we will get back to you soon." tone=muted
  card pad=18 gap=10
    input "Name" bind=name placeholder="Your full name" required=true
    input "Email" bind=email placeholder="you@example.com" kind=email required=true
    input "Phone" bind=phone placeholder="(555) 123-4567"
    select "Subject" items={['General inquiry', 'Support', 'Sales', 'Feedback', 'Other']} bind=subject
    input "Message" bind=message placeholder="How can we help?" lines=5 required=true
    row gap=8
      button "Submit" variant=primary on="emit:submit;notify:'Message sent'" disabled={trim(name) == '' || trim(email) == '' || trim(message) == ''}
      button "Cancel" variant=secondary on="set:name:'';set:email:'';set:phone:'';set:message:'';set:subject:'General inquiry';emit:cancel"
