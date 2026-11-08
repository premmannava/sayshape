import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
import { plainText } from "../src/a11y/text";
import { examples } from "../site/examples/catalog";

const copy = (spec: string, width = 600): string => {
  const ui = render(spec, { width });
  const text = ui.copyText();
  ui.destroy();
  return text;
};

describe("copying the screen as text", () => {
  it("keeps headings, text and stats in reading order, with a blank line before each later heading", () => {
    expect(copy(`card
  text "Sales this week" style=title
  row
    stat label="Revenue" value="$31.7K"
    stat label="Orders" value="1,284"
  text "Second part" style=title
  text "Numbers are made up." tone=muted
`)).toBe(["Sales this week", "Revenue: $31.7K", "Orders: 1,284", "", "Second part", "Numbers are made up."].join("\n"));
  });

  it("reads fields as label and value, and leaves buttons out", () => {
    expect(copy(`state nights=2 hike=true sauna=false plan="Yearly" city="Flagstaff"
stepper "Nights" bind=nights min=1 max=7
check "Sunrise hike" bind=hike
switch "Sauna" bind=sauna
radio "Monthly" bind=plan value=Monthly
radio "Yearly" bind=plan value=Yearly
input "City" bind=city
button "Book it" on=emit:book
`)).toBe(["Nights: 2", "[x] Sunrise hike", "Sauna: Off", "( ) Monthly", "(•) Yearly", "City: Flagstaff"].join("\n"));
  });

  it("puts a radio group's choice after the question above it", () => {
    expect(copy(`state use="Video"
text "What is it mostly for?"
radio "Travel" bind=use value=Travel
radio "Video" bind=use value=Video
`)).toBe("What is it mostly for?\nVideo");
  });

  it("copies tables as tab-separated rows, so they paste into a spreadsheet as cells", () => {
    expect(copy(`state rows=[{region: "West", sales: 12400}, {region: "East", sales: 9100}]
table "By region" items=rows
  table-column "Region" field=region
  table-column "Sales" field=sales format=money
`)).toBe(["By region", "Region\tSales", "West\t$12,400.00", "East\t$9,100.00"].join("\n"));
  });

  it("copies a chart as the data behind it", () => {
    const text = copy(`state days=[{day: "Mon", sales: 3900}, {day: "Tue", sales: 4100}]
chart "Revenue by day" items=days x=day y=sales format=money
`);
    expect(text.split("\n")[0]).toBe("Revenue by day");
    expect(text).toContain("Mon\t$3,900");
    expect(text).toContain("Tue\t$4,100");
  });

  it("copies a schedule as a row per block: date, time, what and lane", () => {
    const text = copy(`state b=[{room: "Atlas", start: "09:00", end: "10:00", title: "Sales sync"}, {room: "Harbor", start: "08:30", end: "09:15", title: "Claims standup"}]
schedule "Rooms" items=b rows=room view=day
`);
    expect(text.split("\n")).toEqual(["Rooms", "Time\tWhat\tRoom", "08:30–09:15\tClaims standup\tHarbor", "09:00–10:00\tSales sync\tAtlas"]);
  });

  it("copies a board as each stage with its count, then its cards", () => {
    const text = copy(`state t=[{id: 1, title: "Login fails", s: "Open"}, {id: 2, title: "Export to CSV", s: "Done"}, {id: 3, title: "Tax on invoice", s: "Open"}]
board "Tickets" items=t stage=s stages="Open,Done"
`);
    expect(text.split("\n")).toEqual(["Tickets", "", "Open (2)", "- Login fails", "- Tax on invoice", "", "Done (1)", "- Export to CSV"]);
  });

  it("never copies a password", () => {
    const text = copy(`state pw="hunter2"
input "Password" bind=pw kind=password
`);
    expect(text).not.toContain("hunter2");
  });

  it("leaves out empty fields, which show only their hint", () => {
    expect(copy(`state q=""
text "Search the catalog"
input "Search" bind=q placeholder="Try boots"
`)).toBe("Search the catalog");
  });

  it("copies what's shown now, after the person changed something", () => {
    const ui = render(`state n=1
stepper "Guests" bind=n min=1 max=8
text "Total: {money(n * 20)}"
`);
    ui.press({ type: "stepper" });
    ui.set("n", 3);
    expect(ui.copyText()).toBe("Guests: 3\nTotal: $60.00");
    ui.destroy();
  });

  it("keeps each line to one line and each cell to one cell", () => {
    const text = copy(`state rows=[{name: "Line\\none", note: "Tab\\there"}]
table items=rows
  table-column "Name" field=name
  table-column "Note" field=note
`);
    const [, row] = text.split("\n");
    expect(row!.split("\t")).toEqual(["Line one", "Tab here"]);
  });

  it("copies every gallery example without leaving any line empty of words", () => {
    for (const ex of examples) {
      const ui = render(ex.spec, { width: 600 });
      const text = ui.copyText();
      expect(text, ex.id).not.toBe("");
      expect(text, ex.id).toBe(plainText(ui.accessibility({ full: true })));
      expect(text.startsWith("\n") || text.endsWith("\n"), ex.id).toBe(false);
      expect(text, ex.id).not.toMatch(/\n\n\n/);
      ui.destroy();
    }
  });
});
