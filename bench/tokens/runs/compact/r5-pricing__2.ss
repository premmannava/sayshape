state billing="Monthly" plans=[{name: "Basic", monthly: 0, yearly: 0, seats: 1, projects: 3, storage: 5, support: "Community", sso: "No", audit: "No", sla: "No"}, {name: "Pro", monthly: 29, yearly: 24, seats: 10, projects: 50, storage: 100, support: "Email", sso: "No", audit: "Yes", sla: "No"}, {name: "Enterprise", monthly: 99, yearly: 79, seats: 500, projects: 1000, storage: 2000, support: "24/7 phone", sso: "Yes", audit: "Yes", sla: "99.9%"}]
column gap=16 pad=16
  column gap=6
    text "Simple, transparent pricing" style=title align=center
    text "Pick the plan that fits your team. Change or cancel anytime." tone=muted align=center
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  grid min=220 gap=12
    card variant=outline gap=10 pad=18
      text "Basic" style=title
      text "For individuals getting started" tone=muted
      text "Free" style=display weight=bold
      divider
      text "1 seat" icon=check
      text "3 projects" icon=check
      text "5 GB storage" icon=check
      text "Community support" icon=check
      button "Start for free" variant=secondary on="emit:select_plan:Basic"
    card variant=hero gap=10 pad=18
      row
        text "Pro" style=title
        badge "Most popular" tone=accent
      text "For growing teams that need more" tone=muted
      text "${billing == 'Monthly' ? 29 : 24} / seat / month" style=display weight=bold
      text "{billing == 'Yearly' ? 'Billed yearly' : 'Billed monthly'}" style=caption tone=muted
      divider
      text "10 seats" icon=check
      text "50 projects" icon=check
      text "100 GB storage" icon=check
      text "Email support and audit log" icon=check
      button "Choose Pro" variant=primary on="emit:select_plan:Pro"
    card variant=outline gap=10 pad=18
      text "Enterprise" style=title
      text "For organizations with advanced needs" tone=muted
      text "${billing == 'Monthly' ? 99 : 79} / seat / month" style=display weight=bold
      text "{billing == 'Yearly' ? 'Billed yearly' : 'Billed monthly'}" style=caption tone=muted
      divider
      text "500 seats" icon=check
      text "1,000 projects" icon=check
      text "2 TB storage" icon=check
      text "SSO, audit log and 99.9% SLA" icon=check
      button "Contact sales" variant=secondary on="emit:contact_sales"
  text "Compare features" style=title
  compare "Feature comparison" items=plans name=name pick=billing
    compare-row "Seats" field=seats format=number best=high
    compare-row "Projects" field=projects format=number best=high
    compare-row "Storage (GB)" field=storage format=number best=high
    compare-row "Support" field=support format=text
    compare-row "Audit log" field=audit format=text
    compare-row "Single sign-on" field=sso format=text
    compare-row "Uptime SLA" field=sla format=text
