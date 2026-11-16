state billing="Monthly" plans=[{name: "Basic", monthly: 9, yearly: 90, seats: 1, storage: 10, support: "Email", sso: "No", audit: "No", sla: "No"}, {name: "Pro", monthly: 29, yearly: 290, seats: 10, storage: 500, support: "Priority", sso: "No", audit: "Yes", sla: "No"}, {name: "Enterprise", monthly: 99, yearly: 990, seats: 100, storage: 5000, support: "Dedicated", sso: "Yes", audit: "Yes", sla: "Yes"}]
column gap=16 pad=16
  text "Simple, transparent pricing" style=title
  text "Pick the plan that fits your team. Change or cancel anytime." tone=muted
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  if={billing == 'Yearly'}
    callout "Save about 17% with yearly billing" tone=good
  grid min=200 gap=12
    card pad=18 gap=10 variant=outline
      text "Basic" style=lead weight=semibold
      text "For individuals getting started" tone=muted
      text "{billing == 'Monthly' ? money(plans[0].monthly) : money(plans[0].yearly)}" style=display weight=bold
      text "{billing == 'Monthly' ? 'per month' : 'per year'}" tone=muted style=caption
      divider
      text "1 seat" icon=check
      text "10 GB storage" icon=check
      text "Email support" icon=check
      button "Choose Basic" variant=secondary on="emit:select:Basic"
    card pad=18 gap=10 variant=hero
      badge "Most popular" tone=accent
      text "Pro" style=lead weight=semibold
      text "For growing teams" tone=muted
      text "{billing == 'Monthly' ? money(plans[1].monthly) : money(plans[1].yearly)}" style=display weight=bold
      text "{billing == 'Monthly' ? 'per month' : 'per year'}" tone=muted style=caption
      divider
      text "10 seats" icon=check
      text "500 GB storage" icon=check
      text "Priority support" icon=check
      text "Audit logs" icon=check
      button "Choose Pro" variant=primary on="emit:select:Pro"
    card pad=18 gap=10 variant=outline
      text "Enterprise" style=lead weight=semibold
      text "For organizations at scale" tone=muted
      text "{billing == 'Monthly' ? money(plans[2].monthly) : money(plans[2].yearly)}" style=display weight=bold
      text "{billing == 'Monthly' ? 'per month' : 'per year'}" tone=muted style=caption
      divider
      text "100 seats" icon=check
      text "5 TB storage" icon=check
      text "Dedicated support" icon=check
      text "SSO, audit logs and SLA" icon=check
      button "Contact sales" variant=secondary on="emit:contact:Enterprise"
  text "Compare features" style=title
  compare "Feature comparison" items=plans name=name pick="Pro"
    compare-row "Seats" field=seats format=number best=high
    compare-row "Storage (GB)" field=storage format=number best=high
    compare-row "Support" field=support
    compare-row "Single sign-on" field=sso
    compare-row "Audit logs" field=audit
    compare-row "Uptime SLA" field=sla
    compare-row "Monthly price" field=monthly format=money best=low
