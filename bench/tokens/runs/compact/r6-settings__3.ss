state tab="Profile" profile={name: "Ada Lovelace", avatar: "AL"} draft={name: "Ada Lovelace", avatar: "AL"} security={twofa: false} notif={email: true, push: false, digest: true}
card gap=12 pad=18
  text "Settings" style=title
  tabs bind=tab
    tab "Profile" value="Profile" gap=12
      avatar "{profile.name}" detail="Initials: {profile.avatar}" size=lg
      input "Full name" bind=draft.name placeholder="Your name" required=true error="Name is required"
      input "Avatar initials" bind=draft.avatar placeholder="e.g. AL" max=2
      row gap=8
        button "Save changes" variant=primary on="set:profile.name:{draft.name};set:profile.avatar:{draft.avatar};notify:'Profile updated'" disabled={trim(draft.name) == ''}
        button "Reset" variant=secondary on="set:draft.name:{profile.name};set:draft.avatar:{profile.avatar}"
    tab "Security" value="Security" gap=12
      switch "Two-factor authentication (2FA)" bind=security.twofa on="notify:'2FA setting updated'"
      callout "2FA is on" detail="You will be asked for a code when you sign in." tone=good if={security.twofa}
      callout "2FA is off" detail="Turn it on to better protect your account." tone=warn else
    tab "Notifications" value="Notifications" gap=12
      switch "Email notifications" bind=notif.email
      switch "Push notifications" bind=notif.push
      switch "Weekly digest" bind=notif.digest
