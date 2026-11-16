state form={name: "", email: "", phone: "", subject: "General question", message: ""} subjects=["General question", "Support", "Sales", "Feedback", "Partnership"]
card gap=12 pad=18
  text "Contact us" style=title
  text "Send us a message and we will reply within two business days." tone=muted
  input "Name" bind=form.name placeholder="Your full name" required=true
  input "Email" bind=form.email kind=email placeholder="you@example.com" required=true
  input "Phone" bind=form.phone kind=number placeholder="Optional"
  select "Subject" items=subjects bind=form.subject
  input "Message" bind=form.message lines=5 placeholder="How can we help?" required=true
  row gap=8
    button "Submit" variant=primary on="emit:submit:{form};notify:'Message sent';set:form.name:'';set:form.email:'';set:form.phone:'';set:form.message:''" disabled={trim(form.name) == '' || trim(form.email) == '' || trim(form.message) == ''}
    button "Cancel" variant=secondary on="set:form.name:'';set:form.email:'';set:form.phone:'';set:form.message:'';emit:cancel"
