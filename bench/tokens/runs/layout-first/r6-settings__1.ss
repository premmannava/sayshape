text "Settings" style=title
text "Manage your profile, security and notifications." tone=muted
tabs bind=tab
  tab "Profile" value="Profile" gap=12
    card gap=12 pad=18
      text "Profile" style=title
      avatar "{name}" detail="{email}" size=lg
      input "Full name" bind=name placeholder="Your name" required={trim(name) == ''} error="Name is required"
      input "Email" bind=email kind=email placeholder="you@example.com"
      input "Avatar image URL" bind=avatarUrl placeholder="Paste a link to your photo"
      row gap=8
        button "Save changes" on="notify:'Profile updated for {name}';emit:saveProfile" disabled={trim(name) == ''}
        button "Reset" variant=secondary on="set:name:'Ada Lovelace';set:email:'ada@example.com';set:avatarUrl:''"
  tab "Security" value="Security" gap=12
    card gap=12 pad=18
      text "Security" style=title
      switch "Two-factor authentication (2FA)" bind=twoFactor on="notify:'2FA updated';emit:toggle2fa"
      callout "Two-factor authentication is on" detail="You will be asked for a code when you sign in." tone=good if={twoFactor}
      callout "Two-factor authentication is off" detail="Turn it on to add a second step when you sign in." tone=warn if={!twoFactor}
  tab "Notifications" value="Notifications" gap=12
    card gap=12 pad=18
      text "Notifications" style=title
      switch "Email notifications" bind=notifyEmail
      switch "Push notifications" bind=notifyPush
      switch "Product updates" bind=notifyNews
state tab="Profile" name="Ada Lovelace" email="ada@example.com" avatarUrl="" twoFactor=false notifyEmail=true notifyPush=false notifyNews=false
