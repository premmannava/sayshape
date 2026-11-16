state billing="Monthly" plans=[{name: "Basic", monthly: 9, yearly: 90, seats: 1, storage: 10, support: "Email", sso: "No", audit: "No", api: "No"}, {name: "Pro", monthly: 29, yearly: 290, seats: 10, storage: 100, support: "Priority", sso: "No", audit: "Yes", api: "Yes"}, {name: "Enterprise", monthly: 99, yearly: 990, seats: 100, storage: 1000, support: "Dedicated", sso: "Yes", audit: "Yes", api: "Yes"}]
column gap=16 pad=16
  text "Simple, transparent pricing" style=display align=center
  text "Pick the plan that fits your team. Change or cancel anytime." style=lead tone=muted align=center
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  grid min=220 gap=12
    each items=plans as=p key={p.name}
      card pad=18 gap=10 variant={p.name == 'Pro' ? 'hero' : 'raised'}
        row gap=8 align=center
          text "{p.name}" style=title
          badge "Most popular" tone=accent if={p.name == 'Pro'}
        text "{billing == 'Monthly' ? money(p.monthly) : money(p.yearly)}" style=display
        text "{billing == 'Monthly' ? 'per month' : 'per year'}" tone=muted style=caption
        divider
        text "{plural(p.seats, 'seat')}"  icon=check
        text "{p.storage} GB storage" icon=check
        text "{p.support} support" icon=check
        button "{p.name == 'Enterprise' ? 'Contact sales' : 'Choose ' + p.name}" variant={p.name == 'Pro' ? 'primary' : 'secondary'} on="emit:choose:{p.name}"
  text "Compare features" style=title
  compare "Plan comparison" items=plans name=name
    compare-row "Monthly price" field=monthly format=money best=low
    compare-row "Seats" field=seats format=number best=high
    compare-row "Storage (GB)" field=storage format=number best=high
    compare-row "Support" field=support format=text
    compare-row "SSO" field=sso format=text
    compare-row "Audit log" field=audit format=text
    compare-row "API access" field=api format=text
