state name="" email="" phone="" subject="General question" message=""
derive subjects=[{label: "General question"}, {label: "Support"}, {label: "Sales"}, {label: "Feedback"}, {label: "Other"}]
card gap=12 pad=18
  text "Contact us" style=title
  text "Send us a message and we will reply soon." tone=muted
  input "Name" bind=name placeholder="Your full name" required=true
  input "Email" bind=email kind=email placeholder="you@example.com" required=true
  input "Phone" bind=phone placeholder="(555) 123-4567"
  select "Subject" items=subjects value=label label=label bind=subject
  input "Message" bind=message lines=5 placeholder="How can we help?" required=true
  row gap=8
    button "Submit" variant=primary on="emit:submit:{name: name, email: email, phone: phone, subject: subject, message: message};notify:'Message sent'" disabled={trim(name) == '' || trim(email) == '' || trim(message) == ''}
    button "Cancel" variant=secondary on="set:name:'';set:email:'';set:phone:'';set:message:'';emit:cancel"
