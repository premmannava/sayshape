state tab="Profile" form={name: "Ada Lovelace", avatar: "AL"} twofa=false
column gap=16 pad=16
  text "Settings" style=title
  tabs bind=tab
    tab "Profile" value="Profile" gap=12
      card gap=12 pad=18
        text "Update your profile" style=lead
        avatar "{form.name}" detail="Current avatar: {form.avatar}" size=lg
        input "Name" bind=form.name placeholder="Your full name" required=true error="Name is required"
        input "Avatar initials" bind=form.avatar placeholder="e.g. AL" max=3
        button "Save profile" variant=primary on="emit:saveProfile:{form};notify:'Profile saved'" disabled={trim(form.name) == ''}
    tab "Security" value="Security" gap=12
      card gap=12 pad=18
        text "Two-factor authentication" style=lead
        switch "Enable 2FA" bind=twofa on="notify:'Two-factor authentication updated'"
        text "Add a second step when you sign in." tone=muted
        callout "2FA is on" detail="Your account has extra protection." tone=good if={twofa}
        callout "2FA is off" detail="Turn it on to better protect your account." tone=warn if={!twofa}
    tab "Notifications" value="Notifications" gap=12
      empty "No notification settings yet" detail="Notification preferences will appear here."
