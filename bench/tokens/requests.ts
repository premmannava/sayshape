/**
 * The token benchmark's requests: seven screens (the claims review twice, its
 * data pasted and by reference) and ten follow-up changes. Each request has
 * checks for "every requested part is present", run on the rendered screen,
 * so a spec that names a part but doesn't draw it doesn't pass.
 */
import type { Rendered } from "../../src/testing";
import type { SayShapeNode } from "../../src/types";
import { CLAIMS_DATA, claimsAsJson } from "./claims";

export interface PartCheck {
  label: string;
  test(ui: Rendered, spec: string): boolean;
}

export interface BenchRequest {
  id: string;
  text: string;
  /** Data the host sets with state.set before the spec is drawn (data by reference). */
  state?: Record<string, unknown>;
  parts: PartCheck[];
}

// ------------------------------------------------------------- helpers

/** Shown elements of a type (laid out, not hidden by if=). */
const shown = (ui: Rendered, type: string) => ui.findAll(type).filter((f) => f.box);
const anyShown = (ui: Rendered, type: string, pred: (n: SayShapeNode, text: string) => boolean = () => true) =>
  shown(ui, type).some((f) => pred(f.node, f.shownText ?? f.node.text ?? ""));
const words = (ui: Rendered) => ui.copyText().toLowerCase();
const mentions = (ui: Rendered, ...needles: string[]) => { const t = words(ui); return needles.every((n) => t.includes(n.toLowerCase())); };
const kindOf = (n: SayShapeNode) => n.props.kind ?? "bar";
const chartOf = (ui: Rendered, kinds: readonly string[]) => anyShown(ui, "chart", (n) => kinds.includes(kindOf(n)));
/** A chart line with two series: y=a,b, or a chart-line layer under it. */
const twoSeries = (n: SayShapeNode) => (n.props.y ?? "").includes(",") || n.children.some((c) => c.type === "chart-line");
const field = (n: SayShapeNode, re: RegExp) => re.test(n.text ?? "") || re.test(n.props.label ?? "") || re.test(n.props.placeholder ?? "");

const check = (label: string, test: PartCheck["test"]): PartCheck => ({ label, test });

/** Claim ids in the copied screen: tables copy every row, so this counts rows shown. */
const claimIds = (ui: Rendered) => new Set(ui.copyText().match(/CL-\d{4}/g) ?? []).size;

/**
 * A filter by status works: some control is bound to a state value, and
 * setting that value to "Open" leaves fewer claims, but some, in the table.
 */
const filtersByStatus: PartCheck = check("filters the claims by status", (ui) => {
  const controls = ["select", "segmented", "radio", "tabs"].flatMap((t) => shown(ui, t)).map((f) => f.node.props.bind).filter((b): b is string => !!b);
  const before = claimIds(ui);
  const open = CLAIMS_DATA.claims.filter((c) => c.status === "Open").length;
  for (const name of new Set(controls)) {
    const old = ui.state[name];
    try {
      ui.set(name, "Open");
      const after = claimIds(ui);
      if (after > 0 && after < before && after <= open) return true;
    } catch { /* not a writable value */ } finally {
      try { if (old !== undefined) ui.set(name, old); } catch { /* ignore */ }
    }
  }
  return false;
});

// ------------------------------------------------------------- requests

const claimsParts: PartCheck[] = [
  check("a title", (ui) => anyShown(ui, "text", (n) => n.props.style === "title" || n.props.style === "display") || anyShown(ui, "card", (n) => !!n.props.title)),
  check("four headline figures", (ui) => shown(ui, "stat").length >= 4),
  check("a bar chart by month", (ui) => anyShown(ui, "chart", (n) => ["bar", "hbar", "stacked"].includes(kindOf(n))) && mentions(ui, "jan", "dec")),
  check("a line chart of opened and closed", (ui) => anyShown(ui, "chart", (n) => kindOf(n) === "line" && twoSeries(n))),
  check("a donut by line", (ui) => chartOf(ui, ["donut", "pie"]) && mentions(ui, "marine", "cyber")),
  check("a table of all 40 claims", (ui) => shown(ui, "table").length > 0 && claimIds(ui) >= 40),
  filtersByStatus,
];

export const REQUESTS: BenchRequest[] = [
  {
    id: "r1-table",
    text: "Create a simple table showing 5 employees with columns for Name, Department, Salary, and YoY change.",
    parts: [
      check("a table", (ui) => shown(ui, "table").length > 0),
      check("Name, Department, Salary and YoY columns", (ui) => anyShown(ui, "table", (n) => {
        const heads = n.children.filter((c) => c.type === "table-column").map((c) => (c.text ?? c.props.field ?? "").toLowerCase()).join("|");
        return /name/.test(heads) && /dep/.test(heads) && /salary/.test(heads) && /yoy|change|year/.test(heads);
      })),
      check("five employees", (ui) => { const t = shown(ui, "table")[0]; return !!t && ui.copyText().split("\n").filter((l) => l.includes("\t")).length >= 6; }),
    ],
  },
  {
    id: "r2-revenue",
    text: "Create a dashboard with a metric card showing Total Revenue, and a BarChart showing 6 months of revenue data.",
    parts: [
      check("a Total Revenue figure", (ui) => anyShown(ui, "stat", (n, t) => /revenue/i.test(n.props.label ?? t))),
      check("a bar chart", (ui) => chartOf(ui, ["bar", "hbar"])),
      check("six months of data", (ui) => ui.copyText().split("\n").filter((l) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\t/i.test(l)).length >= 6),
    ],
  },
  {
    id: "r3-contact",
    text: "Create a contact form with Name, Email, Phone, Subject dropdown, and Message text area. Include Submit and Cancel buttons.",
    parts: [
      check("Name, Email and Phone fields", (ui) => ["name", "email", "phone"].every((w) => anyShown(ui, "input", (n) => field(n, new RegExp(w, "i"))))),
      check("a Subject dropdown", (ui) => anyShown(ui, "select", (n) => field(n, /subject/i))),
      check("a Message text area", (ui) => anyShown(ui, "input", (n) => field(n, /message/i) && Number(n.props.lines ?? 1) > 1)),
      check("Submit and Cancel buttons", (ui) => anyShown(ui, "button", (_n, t) => /submit|send/i.test(t)) && anyShown(ui, "button", (_n, t) => /cancel/i.test(t))),
    ],
  },
  {
    id: "r4-analytics",
    text: "Create a product analytics dashboard. It should have a Header, a BarChart for Monthly Active Users, a PieChart for User Acquisition, a Table for Top Features, and a LineChart for MRR and ARR.",
    parts: [
      check("a header", (ui) => anyShown(ui, "text", (n) => n.props.style === "title" || n.props.style === "display")),
      check("a bar chart of monthly active users", (ui) => anyShown(ui, "chart", (n, t) => ["bar", "hbar"].includes(kindOf(n)) && /active|mau/i.test(t + (n.props.title ?? "")))),
      check("a pie chart of user acquisition", (ui) => anyShown(ui, "chart", (n, t) => ["pie", "donut"].includes(kindOf(n)) && /acqui/i.test(t + (n.props.title ?? "")))),
      check("a table of top features", (ui) => shown(ui, "table").length > 0),
      check("a line chart of MRR and ARR", (ui) => anyShown(ui, "chart", (n) => kindOf(n) === "line" && twoSeries(n)) && mentions(ui, "mrr", "arr")),
    ],
  },
  {
    id: "r5-pricing",
    text: "Create a pricing page with 3 tiers: Basic, Pro, and Enterprise. Include a feature comparison table below the pricing cards.",
    parts: [
      check("three tiers", (ui) => mentions(ui, "basic", "pro", "enterprise") && (shown(ui, "card").length >= 3 || shown(ui, "tile").length >= 3)),
      check("a feature comparison table", (ui) => shown(ui, "table").length > 0 || shown(ui, "compare").length > 0),
    ],
  },
  {
    id: "r6-settings",
    text: "Create a user settings panel with tabs for Profile, Security, and Notifications. The Profile tab should have a form to update name and avatar. The Security tab should have a toggle for 2FA.",
    parts: [
      check("Profile, Security and Notifications tabs", (ui, spec) => shown(ui, "tabs").length > 0 && /"Profile"/.test(spec) && /"Security"/.test(spec) && /"Notifications"/.test(spec)),
      check("a name field and an avatar on Profile", (_ui, spec) => /input[^\n]*"[^"]*name/i.test(spec) && /avatar|image|photo|picture/i.test(spec)),
      check("a 2FA toggle on Security", (_ui, spec) => /(switch|check)\s+"[^"]*(2fa|two-factor|two factor)/i.test(spec)),
    ],
  },
  {
    id: "r7-claims-pasted",
    text: `A claims review. Here is the data: 40 claims (id, opened, line, site, status, incurred, days), 12 monthly rows (month, opened, closed, incurred) and 6 by-line rows (line, count, incurred), as JSON:
${claimsAsJson()}
Show a title, four headline figures, a bar chart by month, a line chart of opened and closed, a donut by line, a table of all 40 claims, and a filter by status.`,
    parts: claimsParts,
  },
  {
    id: "r7-claims-ref",
    text: `A claims review. The app supplies the data as state, by name; never write its rows:
- claims: 40 rows {id, opened, line, site, status, incurred, days}. status is one of Open, In review, Closed, Denied. line is one of Auto, Property, Liability, Workers comp, Marine, Cyber. incurred is dollars, opened is YYYY-MM-DD.
- monthly: 12 rows {month, opened, closed, incurred}, month is Jan to Dec.
- byLine: 6 rows {line, count, incurred}.
Show a title, four headline figures, a bar chart by month, a line chart of opened and closed, a donut by line, a table of all 40 claims, and a filter by status.`,
    state: { ...CLAIMS_DATA },
    parts: claimsParts,
  },
];

/**
 * Follow-up changes for item 3, each made to the claims review (by reference),
 * starting from runs/compact/r7-claims-ref__1.ss. None of them is already true of it.
 */
export const FOLLOW_UPS: string[] = [
  "Make the bar chart a line chart.",
  "Remove the Opened column from the table.",
  "Remove the donut.",
  "Rename the title to \"Claims review, 2025\".",
  "Make the status filter a dropdown.",
  "Add a fifth headline figure: the longest days open.",
  "Sort the table by incurred, highest first.",
  "Move the table above the charts.",
  "Add a filter by line next to the status filter.",
  "Change the line chart to show incurred by month instead of opened and closed.",
];

export const requestById = (id: string): BenchRequest => {
  const r = REQUESTS.find((x) => x.id === id);
  if (!r) throw new Error(`No benchmark request "${id}"`);
  return r;
};
