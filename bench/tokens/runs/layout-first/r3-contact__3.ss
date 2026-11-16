state subjects=[{id: "general", name: "General inquiry"}, {id: "support", name: "Support"}, {id: "sales", name: "Sales"}, {id: "feedback", name: "Feedback"}]
column gap=12 pad=16
  text "Contact us" style=title
  text "Send us a message and we will reply within two business days." tone=muted
  card pad=18 gap=10
    input "Name" bind=name placeholder="Your full name" required=true
    input "Email" bind=email kind=email placeholder="you@example.com" required=true
    input "Phone" bind=phone kind=text placeholder="(555) 123-4567"
    select "Subject" items=subjects value=id label=name bind=subject placeholder="Choose a subject"
    input "Message" bind=message lines=5 placeholder="How can we help?" required=true
    row gap=8
      button "Submit" variant=primary on="emit:submit;notify:'Message sent'" disabled={trim(name) == '' || trim(email) == '' || trim(message) == ''}
      button "Cancel" variant=secondary on="set:name:'';set:email:'';set:phone:'';set:subject:'';set:message:'';emit:cancel"
state name="" email="" phone="" subject="" message=""
