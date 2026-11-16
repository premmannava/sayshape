state tab="Profile" name="Ada Lovelace" bio="" twofa=false
column gap=16 pad=16
  text "Settings" style=title
  tabs bind=tab
    tab "Profile" value="Profile" gap=12
      card gap=12 pad=18
        text "Profile" style=title
        avatar "{name}" detail="Current avatar" size=lg
        input "Name" bind=name placeholder="Your full name" required=true
        input "Avatar image URL" bind=avatarUrl placeholder="Paste an image link" kind=text
        button "Save profile" variant=primary on="emit:saveProfile;notify:'Profile updated'" disabled={trim(name) == ''}
    tab "Security" value="Security" gap=12
      card gap=12 pad=18
        text "Security" style=title
        switch "Two-factor authentication (2FA)" bind=twofa on="notify:'2FA setting changed'"
        text "Add a second verification step when you sign in." tone=muted
        callout "Two-factor authentication is on" tone=good if={twofa}
        callout "Two-factor authentication is off" detail="Turn it on to better protect your account." tone=warn if={!twofa}
    tab "Notifications" value="Notifications" gap=12
      card gap=12 pad=18
        text "Notifications" style=title
        text "Choose how you want to hear from us." tone=muted
        switch "Email notifications" bind=emailNotif
        switch "Push notifications" bind=pushNotif
        switch "Weekly summary" bind=weekly
state avatarUrl="" emailNotif=true pushNotif=false weekly=true
