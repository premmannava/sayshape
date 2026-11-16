state tab="Profile" name="Ada Lovelace" email="ada@example.com" avatar="AL" twoFA=false
text "Settings" style=title
tabs bind=tab
  tab "Profile" value="Profile" gap=12
    card gap=12 pad=18
      text "Update your profile" style=lead
      avatar "{name}" detail="{email}" size=lg
      input "Full name" bind=name placeholder="Your name" required=true
      input "Avatar initials" bind=avatar placeholder="e.g. AL" max=2
      button "Save changes" variant=primary on="emit:saveProfile;notify:'Profile saved'" disabled={trim(name) == ''}
  tab "Security" value="Security" gap=12
    card gap=12 pad=18
      text "Account security" style=lead
      switch "Two-factor authentication (2FA)" bind=twoFA on="notify:'2FA updated'"
      callout "2FA is on" detail="Your account needs a code at sign-in." tone=good if={twoFA}
      callout "2FA is off" detail="Turn it on to protect your account." tone=warn if={!twoFA}
  tab "Notifications" value="Notifications" gap=12
    card gap=12 pad=18
      text "Notification preferences" style=lead
      empty "No notification settings yet" detail="Choices you add here will appear on this tab."
