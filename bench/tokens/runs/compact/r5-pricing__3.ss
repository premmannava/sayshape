state billing="Monthly" plan="Pro"
derive isYearly={billing == 'Yearly'}
derive plans=[{name: "Basic", monthly: 0, yearly: 0, seats: 1, projects: 3, storage: 5, support: "Community", sso: "No", audit: "No"}, {name: "Pro", monthly: 24, yearly: 20, seats: 10, projects: 50, storage: 100, support: "Email", sso: "No", audit: "No"}, {name: "Enterprise", monthly: 79, yearly: 65, seats: 500, projects: 1000, storage: 2000, support: "24/7 phone", sso: "Yes", audit: "Yes"}]

column gap=16 pad=16
  text "Simple pricing for every team" style=display align=center
  text "Start free, upgrade when you grow. Cancel anytime." style=lead tone=muted align=center
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  if={isYearly}
    callout "Save about 17% with yearly billing" tone=good
  grid min=220 gap=12
    card pad=18 gap=10 variant=outline
      text "Basic" style=title
      text "For individuals getting started" tone=muted
      text "Free" style=display
      text "forever" tone=muted style=caption
      ul_placeholder_removed
      text "1 seat" icon=check
      text "3 projects" icon=check
      text "5 GB storage" icon=check
      text "Community support" icon=check
      button "Get started" variant=secondary on="set:plan:'Basic';emit:select_plan:Basic"
    card pad=18 gap=10 variant=hero
      badge "Most popular" tone=accent
      text "Pro" style=title
      text "For growing teams that need more" tone=muted
      text "${isYearly ? 20 : 24}" style=display
      text "per user / month" tone=muted style=caption
      text "10 seats" icon=check
      text "50 projects" icon=check
      text "100 GB storage" icon=check
      text "Email support" icon=check
      button "Start Pro trial" variant=primary on="set:plan:'Pro';emit:select_plan:Pro"
    card pad=18 gap=10 variant=outline
      text "Enterprise" style=title
      text "For organizations with advanced needs" tone=muted
      text "${isYearly ? 65 : 79}" style=display
      text "per user / month" tone=muted style=caption
      text "500 seats" icon=check
      text "1,000 projects" icon=check
      text "2 TB storage" icon=check
      text "SSO and audit logs" icon=check
      text "24/7 phone support" icon=check
      button "Contact sales" variant=secondary on="set:plan:'Enterprise';emit:contact_sales"
  text "Compare features" style=title
  compare "Feature comparison" items={plans} name=name
    compare-row "Price per user / month" field={isYearly ? 'yearly' : 'monthly'} format=money best=low
    compare-row "Seats" field=seats format=number best=high
    compare-row "Projects" field=projects format=number best=high
    compare-row "Storage (GB)" field=storage format=number best=high
    compare-row "Support" field=support
    compare-row "Single sign-on" field=sso
    compare-row "Audit logs" field=audit
