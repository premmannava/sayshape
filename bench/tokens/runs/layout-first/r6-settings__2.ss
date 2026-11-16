column gap=16 pad=16
  text "Settings" style=title
  tabs bind=tab
    tab "Profile" value="Profile" gap=12
      card gap=12 pad=18
        text "Profile" style=title
        text "Update your name and avatar" tone=muted
        avatar "{form.name}" detail="{form.email}" size=lg
        input "Full name" bind=form.name placeholder="Your name" required=true
        input "Avatar image URL" bind=form.avatar placeholder="Paste an image link" kind=text
        row gap=8
          button "Save changes" on="emit:saveProfile;notify:'Profile updated'" disabled={trim(form.name) == ''}
          button "Reset" variant=secondary on="set:form.name:'Ada Lovelace';set:form.avatar:''"
    tab "Security" value="Security" gap=12
      card gap=12 pad=18
        text "Security" style=title
        text "Protect your account" tone=muted
        switch "Two-factor authentication (2FA)" bind=settings.twofa on="notify:'2FA setting changed'"
        callout "2FA is on" detail="You will be asked for a code when you sign in." tone=good if={settings.twofa}
        callout "2FA is off" detail="Turn it on to add a second step at sign in." tone=warn if={!settings.twofa}
    tab "Notifications" value="Notifications" gap=12
      card gap=12 pad=18
        text "Notifications" style=title
        text "Choose how we contact you" tone=muted
        switch "Email notifications" bind=settings.email
        switch "Push notifications" bind=settings.push
        switch "Weekly summary" bind=settings.digest
state tab="Profile"
state form={name: "Ada Lovelace", email: "ada@example.com", avatar: ""}
state settings={twofa: false, email: true, push: true, digest: false}
