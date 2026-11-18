state billing="Monthly" plans=[{name: "Basic", price: "$9", yearly: "$7", detail: "For individuals getting started", seats: "1", projects: "3", storage: "5 GB", support: "Community", sso: "No", audit: "No"}, {name: "Pro", price: "$29", yearly: "$24", detail: "For growing teams", seats: "10", projects: "Unlimited", storage: "100 GB", support: "Priority email", sso: "No", audit: "Yes"}, {name: "Enterprise", price: "Custom", yearly: "Custom", detail: "For large organizations", seats: "Unlimited", projects: "Unlimited", storage: "1 TB", support: "Dedicated manager", sso: "Yes", audit: "Yes"}]
column gap=16 pad=16
  column gap=6
    text "Simple pricing for every team" style=title align=center
    text "Pick a plan that fits today and upgrade whenever you grow." tone=muted align=center
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  grid min=220 gap=12
    card gap=10 pad=18 variant=outline
      text "Basic" style=title
      text "For individuals getting started" tone=muted
      text "$9 / month" style=display
      list
        list-item "1 seat" icon=check
        list-item "3 projects" icon=check
        list-item "5 GB storage" icon=check
        list-item "Community support" icon=check
      button "Choose Basic" variant=secondary on="emit:choose:Basic"
    card gap=10 pad=18 variant=hero
      row gap=8
        text "Pro" style=title
        badge "Most popular" tone=accent
      text "For growing teams" tone=muted
      text "$29 / month" style=display
      list
        list-item "10 seats" icon=check
        list-item "Unlimited projects" icon=check
        list-item "100 GB storage" icon=check
        list-item "Priority email support" icon=check
        list-item "Audit log" icon=check
      button "Choose Pro" variant=primary on="emit:choose:Pro"
    card gap=10 pad=18 variant=outline
      text "Enterprise" style=title
      text "For large organizations" tone=muted
      text "Custom" style=display
      list
        list-item "Unlimited seats" icon=check
        list-item "Unlimited projects" icon=check
        list-item "1 TB storage" icon=check
        list-item "Dedicated manager" icon=check
        list-item "SSO and audit log" icon=check
      button "Contact sales" variant=secondary on="emit:contact:Enterprise"
  text "Compare features" style=title
  compare "Feature comparison" items=plans name=name pick=Pro
    compare-row "Price per month" field=price
    compare-row "Seats" field=seats
    compare-row "Projects" field=projects
    compare-row "Storage" field=storage
    compare-row "Support" field=support
    compare-row "Single sign-on" field=sso
    compare-row "Audit log" field=audit
