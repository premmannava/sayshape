card pad=18 gap=10
  text "Contact us" style=title
  text "Send us a message and we will reply soon." tone=muted
  input "Name" bind=form.name placeholder="Your name" required={true}
  input "Email" bind=form.email kind=email placeholder="you@example.com" required={true}
  input "Phone" bind=form.phone kind=text placeholder="(555) 123-4567"
  select "Subject" items={['General inquiry', 'Support', 'Sales', 'Feedback']} bind=form.subject placeholder="Choose a subject"
  input "Message" bind=form.message lines=5 placeholder="How can we help?" required={true}
  row gap=8
    button "Submit" variant=primary on="emit:submit_contact;notify:'Message sent'" disabled={trim(form.name) == '' || trim(form.email) == '' || trim(form.message) == ''}
    button "Cancel" variant=secondary on="set:form.name:'';set:form.email:'';set:form.phone:'';set:form.subject:'';set:form.message:'';emit:cancel_contact"
state form={name: "", email: "", phone: "", subject: "", message: ""}
