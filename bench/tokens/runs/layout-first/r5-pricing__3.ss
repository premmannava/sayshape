state billing="Monthly"
column gap=20 pad=16
  column gap=6
    text "Pricing" style=display align=center
    text "Pick the plan that fits your team. Change or cancel anytime." style=lead tone=muted align=center
  segmented bind=billing label="Billing period" options="Monthly,Yearly"
  grid min=240 gap=12
    card variant=outline pad=18 gap=10
      text "Basic" style=title
      text "For individuals getting started" tone=muted
      text "{billing == 'Monthly' ? '$9' : '$90'}" style=display
      text "{billing == 'Monthly' ? 'per user / month' : 'per user / year'}" style=caption tone=muted
      divider
      text "1 project" icon=check
      text "5 GB storage" icon=check
      text "Email support" icon=check
      button "Choose Basic" variant=secondary on="notify:'Basic selected'"
    card variant=hero pad=18 gap=10
      row gap=8 align=center
        text "Pro" style=title
        badge "Most popular" tone=accent
      text "For growing teams" tone=muted
      text "{billing == 'Monthly' ? '$29' : '$290'}" style=display
      text "{billing == 'Monthly' ? 'per user / month' : 'per user / year'}" style=caption tone=muted
      divider
      text "Unlimited projects" icon=check
      text "100 GB storage" icon=check
      text "Priority support" icon=check
      text "Advanced analytics" icon=check
      button "Choose Pro" variant=primary on="notify:'Pro selected'"
    card variant=outline pad=18 gap=10
      text "Enterprise" style=title
      text "For organizations at scale" tone=muted
      text "Custom" style=display
      text "tailored to your needs" style=caption tone=muted
      divider
      text "Unlimited everything" icon=check
      text "SSO and audit logs" icon=check
      text "Dedicated manager" icon=check
      text "99.99% uptime SLA" icon=check
      button "Contact sales" variant=secondary on="emit:contact_sales"
  text "Compare features" style=title
  table "Feature comparison" items=features
    table-column "Feature" field=feature
    table-column "Basic" field=basic
    table-column "Pro" field=pro
    table-column "Enterprise" field=enterprise
state features=[{feature: "Projects", basic: "1", pro: "Unlimited", enterprise: "Unlimited"}, {feature: "Storage", basic: "5 GB", pro: "100 GB", enterprise: "Unlimited"}, {feature: "Team members", basic: "1", pro: "Up to 25", enterprise: "Unlimited"}, {feature: "Analytics", basic: "Basic", pro: "Advanced", enterprise: "Custom"}, {feature: "Support", basic: "Email", pro: "Priority", enterprise: "Dedicated manager"}, {feature: "SSO", basic: "No", pro: "No", enterprise: "Yes"}, {feature: "Audit logs", basic: "No", pro: "No", enterprise: "Yes"}, {feature: "Uptime SLA", basic: "None", pro: "99.9%", enterprise: "99.99%"}]
