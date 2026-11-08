import { describe, expect, it } from "vitest";
import { coreComponents } from "../../src/components";
import { formatTime, MAX_SCHEDULE_ITEMS, MAX_WEEK_DAYS, MIN_BLOCK_W, parseTime, schedule, type ScheduleGeometry } from "../../src/components/schedule";
import type { AccessibleNode } from "../../src/a11y/semantics";
import { parse } from "../../src/parser";
import { languageGuide } from "../../src/prompt";
import { Registry } from "../../src/registry";
import { render, type Rendered } from "../../src/testing";
import { textOverflows } from "../overflow";

// The contract tests (test/contract.test.ts) already check the definition,
// layout bounds, text that fits at 240, 360 and 600 px, theme-only colors
// and keyboard reach. These test what's specific to schedule.

const registry = new Registry(coreComponents);
const msgs = (spec: string) => parse(spec + "\n", registry).diagnostics.map((d) => d.message);
const geo = (ui: Rendered): ScheduleGeometry => ui.find("schedule").box!.data as unknown as ScheduleGeometry;

const SHIFTS = `state picked="" shifts=[{id: "s1", day: "2026-11-09", from: "08:00", to: "16:00", name: "Ana Ruiz", tier: "Tier 1"}, {id: "s2", day: "2026-11-09", from: "12:00", to: "20:00", name: "Ben Okafor", tier: "Tier 2"}, {id: "s3", day: "2026-11-10", from: "08:00", to: "16:00", name: "Chloe Park", tier: "Tier 1"}, {id: "s4", day: "2026-11-12", from: "09:30", to: "13:00", name: "Dev Malhotra", tier: "On call"}]`;
const ROTA = `${SHIFTS}
schedule "Support rota" items=shifts date=day start=from end=to label=name tone=tier view=week bind=picked on=emit:picked
`;
const ROOMS = `state bookings=[{id: "b1", room: "Atlas", from: "09:00", to: "10:00", title: "Sales sync"}, {id: "b2", room: "Atlas", from: "09:30", to: "11:00", title: "Pipeline review"}, {id: "b3", room: "Harbor", from: "10:00", to: "12:30", title: "Claims training"}, {id: "b4", room: "Atlas", from: "10:30", to: "11:30", title: "Budget check"}]
schedule "Rooms" items=bookings start=from end=to rows=room view=day
`;
const PLAN = `state tasks=[{id: 1, task: "Research", team: "Product", from: "2026-10-05", to: "2026-10-16"}, {id: 2, task: "Beta", team: "Product", from: "2026-10-12", to: "2026-11-06"}, {id: 3, task: "Launch site", team: "Marketing", from: "2026-10-12", to: "2026-10-30"}, {id: 4, task: "Launch day", team: "Sales", date: "2026-11-12"}]
schedule "Launch plan" items=tasks start=from end=to label=task rows=team view=timeline
`;

describe("text times", () => {
  it("reads HH:MM from 00:00 to 24:00 and nothing else", () => {
    expect([parseTime("09:30"), parseTime("9:05"), parseTime("00:00"), parseTime("24:00")]).toEqual([570, 545, 0, 1440]);
    for (const bad of ["24:30", "9:5", "12:60", "noon", "", "09:30:00", 930, null]) expect(parseTime(bad as never)).toBeNull();
    expect(formatTime(545)).toBe("09:05");
  });
});

describe("schedule", () => {
  it("renders its example and the samples without problems", () => {
    for (const spec of [ROTA, ROOMS, PLAN]) {
      const ui = render(spec, { today: "2026-10-21" });
      expect(ui.diagnostics).toEqual([]);
      expect(ui.warnings).toEqual([]);
    }
    expect(msgs(schedule.example!)).toEqual([]);
  });

  it("is taught in the model guide, with its picks", () => {
    const guide = languageGuide(registry);
    expect(guide).toContain('schedule "<text>"');
    expect(guide).toContain("schedule view=week|day|timeline");
  });

  it("warns about bad prop values but keeps the element", () => {
    const m = msgs(`state s=[]\nschedule items=s view=month colour=red`);
    expect(m.some((x) => x.includes("view") && x.includes("timeline"))).toBe(true);
    expect(m.some((x) => x.includes("colour"))).toBe(true);
    expect(render(`state s=[]\nschedule items=s view=month`).isShown("schedule")).toBe(true);
  });

  it("week view: a column per day from the first to the last, blocks on the time axis", () => {
    const d = geo(render(ROTA, { width: 1024 }));
    expect(d.columns.map((c) => c.label)).toEqual(["Mon Nov 9", "Tue Nov 10", "Wed Nov 11", "Thu Nov 12"]);
    // 08:00 to 20:00: twelve hours, each the same height.
    expect(d.ticks.map((t) => t.label)[0]).toBe("08:00");
    expect(d.ticks.at(-1)!.label).toBe("20:00");
    const [ana, ben] = [d.blocks.find((b) => b.label === "Ana Ruiz")!, d.blocks.find((b) => b.label === "Ben Okafor")!];
    const hourH = (d.ticks[1]!.at - d.ticks[0]!.at);
    expect(ana.h).toBeCloseTo(8 * hourH - 2, 0);
    expect(ben.y - ana.y).toBeCloseTo(4 * hourH, 0);
  });

  it("puts blocks that overlap side by side, and only those", () => {
    const d = geo(render(ROOMS, { width: 1024 }));
    expect(d.columns.map((c) => c.label)).toEqual(["Atlas", "Harbor"]);
    const atlas = d.blocks.filter((b) => b.lane === "Atlas").sort((a, b) => a.from - b.from);
    // Sales sync and Pipeline review overlap; Budget check starts after Sales sync ends, so it takes its place.
    expect(atlas[0]!.x).toBeLessThan(atlas[1]!.x);
    expect(atlas[0]!.w).toBeCloseTo(atlas[1]!.w, 0);
    expect(atlas[2]!.x).toBeCloseTo(atlas[0]!.x, 0);
    const harbor = d.blocks.find((b) => b.lane === "Harbor")!;
    expect(harbor.w).toBeGreaterThan(atlas[0]!.w);
  });

  it("widens a crowded column and scrolls sideways rather than squeezing blocks", () => {
    const d = geo(render(ROOMS, { width: 360 }));
    expect(d.columns[0]!.w).toBeGreaterThanOrEqual(2 * MIN_BLOCK_W);
    expect(d.contentW).toBeGreaterThan(d.viewW);
    expect(d.bar).toBeGreaterThan(0);
    for (const b of d.blocks) expect(b.w).toBeGreaterThanOrEqual(MIN_BLOCK_W - 8);
  });

  it("lays out at every width, its frame inside its box", () => {
    for (const width of [240, 360, 600, 1024]) {
      for (const spec of [ROTA, ROOMS, PLAN]) {
        const ui = render(spec, { width, today: "2026-10-21" });
        const box = ui.find("schedule").box!;
        const d = geo(ui);
        expect(box.w).toBeLessThanOrEqual(width);
        expect(d.frame.y + d.frame.h).toBeLessThanOrEqual(box.h);
        expect(d.axisW + d.viewW).toBeCloseTo(box.w, 0);
      }
    }
  });

  it("timeline: a row per lane, overlapping bars stacked, one-day items as milestones, a Today line", () => {
    const d = geo(render(PLAN, { width: 1024, today: "2026-10-21" }));
    expect(d.lanes.map((l) => l.label)).toEqual(["Product", "Marketing", "Sales"]);
    // Research and Beta overlap in Product, so Product is two rows tall.
    expect(d.lanes[0]!.h).toBe(2 * d.lanes[1]!.h);
    expect(d.blocks.find((b) => b.label === "Launch day")!.milestone).toBe(true);
    expect(d.todayX).not.toBeNull();
    expect(geo(render(PLAN, { width: 1024, today: "2027-01-01" })).todayX).toBeNull();
    // A month mark where October and November start.
    expect(d.ticks.filter((t) => t.strong).map((t) => t.label)).toEqual(["Oct 2026", "Nov"]);
  });

  it("timeline without rows=: a row per item, named by its label", () => {
    const d = geo(render(PLAN.replace(" rows=team", ""), { width: 600 }));
    // In start order, the shorter first when two start the same day.
    expect(d.lanes.map((l) => l.label)).toEqual(["Research", "Launch site", "Beta", "Launch day"]);
  });

  it("selects a block: sets bind= to its key, then runs on=", () => {
    const ui = render(ROTA, { width: 1024 });
    const region = ui.hits.find((h) => h.box.node.type === "schedule" && String(h.detail).startsWith("item:"))!;
    ui.click(region.box.x + region.box.w / 2, region.box.y + region.box.h / 2);
    expect(ui.state.picked).toBe("s1");
    expect(ui.emitted.map((e) => e.name)).toEqual(["picked"]);
  });

  it("reaches every block with Tab, in time order, and selects with Enter", () => {
    const ui = render(ROTA, { width: 1024 });
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      ui.tab();
      const node = ui.accessibility({ full: true });
      const find = (n: typeof node): string | undefined => (n.key === ui.mirror.focused ? n.name : n.children.map(find).find(Boolean));
      names.push(["Ana Ruiz", "Ben Okafor", "Chloe Park", "Dev Malhotra"].find((n) => find(node)!.includes(n))!);
    }
    expect(names).toEqual(["Ana Ruiz", "Ben Okafor", "Chloe Park", "Dev Malhotra"]);
    ui.key("Enter");
    expect(ui.state.picked).toBe("s4");
  });

  it("isn't pressable without bind= or on=", () => {
    const ui = render(ROOMS, { width: 1024 });
    expect(ui.hits.filter((h) => h.box.node.type === "schedule" && String(h.detail).startsWith("item:"))).toEqual([]);
  });

  it("scrolls sideways with a sideways wheel, Shift and the wheel, and arrow keys, and keeps up and down for the page", () => {
    const ui = render(ROTA, { width: 360 });
    const box = ui.find("schedule").box!;
    const d = geo(ui);
    const at = { x: box.x + d.axisW + 20, y: box.y + d.bodyY + 20 };
    const view = () => ui.sayshape.viewState(ui.find("schedule").node.id)?.x ?? 0;
    expect(view()).toBe(0);
    ui.wheel(at.x, at.y, 40);
    expect(view()).toBe(0);
    ui.wheel(at.x, at.y, 0, { deltaX: 60 });
    expect(view()).toBe(60);
    ui.wheel(at.x, at.y, 40, { shift: true });
    expect(view()).toBe(100);
    ui.tab();
    ui.key("End");
    expect(view()).toBeCloseTo(d.contentW - d.viewW, 0);
    ui.key("Home");
    expect(view()).toBe(0);
  });

  it("a block scrolled out of sight scrolls into view when Tab reaches it", () => {
    const ui = render(ROTA, { width: 360 });
    for (let i = 0; i < 4; i++) ui.tab();
    const d = geo(ui);
    const dev = d.blocks.find((b) => b.label === "Dev Malhotra")!;
    const region = ui.hits.find((h) => h.detail === dev.detail)!;
    const box = ui.find("schedule").box!;
    expect(region.box.x).toBeGreaterThanOrEqual(box.x + d.axisW - 1);
    expect(region.box.x + region.box.w).toBeLessThanOrEqual(box.x + box.w + 1);
  });

  it("is a table to a screen reader, and copies as tab-separated rows", () => {
    const ui = render(ROTA, { width: 1024 });
    const text = ui.copyText();
    const lines = text.split("\n");
    expect(lines.slice(0, 2)).toEqual(["Support rota", "Date\tTime\tWhat"]);
    expect(text).toContain("Mon, Nov 9, 2026\t08:00–16:00\tAna Ruiz");
    expect(text).toContain("Thu, Nov 12, 2026\t09:30–13:00\tDev Malhotra");
    const rooms = render(ROOMS, { width: 1024 }).copyText().split("\n");
    // A day of times with no dates: no Date column.
    expect(rooms[1]).toBe("Time\tWhat\tRoom");
    expect(rooms[2]).toBe("09:00–10:00\tSales sync\tAtlas");
    const plan = render(PLAN, { width: 1024 }).copyText().split("\n");
    expect(plan[1]).toBe("Start\tEnd\tWhat\tTeam");
    expect(plan).toContain("Thu, Nov 12, 2026\tThu, Nov 12, 2026\tLaunch day\tSales");
  });

  it("names each focusable block by its cells and marks the selected one", () => {
    const ui = render(ROTA.replace(`picked=""`, `picked="s2"`), { width: 1024 });
    const rows = JSON.stringify(ui.accessibility());
    expect(rows).toContain("Mon, Nov 9, 2026, 12:00–20:00, Ben Okafor");
    expect(rows).toMatch(/Ben Okafor[^}]*selected/);
  });

  it("leaves out items without a usable time, and says how to write them", () => {
    const ui = render(`state s=[{start: "09:00", title: "Ok"}, {start: "9am", title: "Bad"}, {title: "None"}, 3]\nschedule items=s view=day`);
    expect(geo(ui).blocks.map((b) => b.label)).toEqual(["Ok"]);
    expect(ui.warnings.join(" ")).toMatch(/3 of 4 items have no a start time as HH:MM|3 of 4 items have no/);
    expect(ui.warnings.join(" ")).toContain("09:30");
  });

  it("draws a block that ends before it starts up to midnight, and one with no end for an hour", () => {
    const d = geo(render(`state s=[{start: "22:00", end: "06:00", title: "Night"}, {start: "09:00", title: "Call"}]\nschedule items=s view=day`));
    const night = d.blocks.find((b) => b.label === "Night")!, call = d.blocks.find((b) => b.label === "Call")!;
    expect([night.from, night.to]).toEqual([1320, 1440]);
    expect([call.from, call.to]).toEqual([540, 600]);
  });

  it("day view shows the first day and says the others aren't shown", () => {
    const ui = render(`${SHIFTS}\nschedule items=shifts date=day start=from end=to label=name view=day`);
    expect(geo(ui).blocks.map((b) => b.label).sort()).toEqual(["Ana Ruiz", "Ben Okafor"]);
    expect(ui.warnings.join(" ")).toContain("view=day shows one day");
  });

  it("shows a message instead of too many items, too many days or nothing", () => {
    const many = Array.from({ length: MAX_SCHEDULE_ITEMS + 1 }, (_, i) => `{start: "09:00", title: "M${i}"}`).join(", ");
    expect(geo(render(`state s=[${many}]\nschedule items=s view=day`)).message).toContain("Too many items");
    const long = Array.from({ length: MAX_WEEK_DAYS + 1 }, (_, i) => `{date: "2026-11-${String(i + 1).padStart(2, "0")}", start: "09:00"}`).join(", ");
    expect(geo(render(`state s=[${long}]\nschedule items=s view=week`)).message).toContain("filter to one week");
    expect(geo(render(`state s=[]\nschedule items=s`)).message).toBe("Nothing scheduled");
    expect(geo(render(`state s=[{start: "2027-03-01", end: "2030-01-01"}]\nschedule items=s view=timeline`)).message).toContain("Too long a period");
  });

  it("colors by tone name, or a series color per other value, with a key", () => {
    const d = geo(render(ROTA, { width: 1024 }));
    expect(d.legend.map((l) => l.label)).toEqual(["Tier 1", "Tier 2", "On call"]);
    const tones = geo(render(`state s=[{start: "09:00", title: "A", status: "bad"}, {start: "10:00", title: "B", status: "good"}]\nschedule items=s view=day tone=status`));
    expect(tones.blocks.map((b) => b.tone)).toEqual(["bad", "good"]);
    expect(tones.legend).toEqual([]);
  });

  it("never throws on odd data, and every streamed prefix renders", () => {
    for (const odd of [`items=5`, `items={[null, "x", {start: {a: 1}}]}`, `items=nope`, ``]) {
      expect(() => render(`schedule ${odd} view=timeline`)).not.toThrow();
      expect(() => render(`schedule ${odd} view=day`)).not.toThrow();
    }
    const lines = ROTA.trim().split("\n");
    for (let i = 1; i <= lines.length; i++) expect(render(lines.slice(0, i).join("\n") + "\n").diagnostics).toEqual([]);
  });
});

describe("schedule, from the review", () => {
  it("a focused block doesn't fight the arrows: they keep scrolling after a repaint", () => {
    const ui = render(ROTA, { width: 360 });
    ui.tab();
    const id = ui.find("schedule").node.id;
    ui.key("ArrowRight");
    ui.key("ArrowRight");
    const after = ui.sayshape.viewState(id)?.x ?? 0;
    expect(after).toBeGreaterThan(0);
    ui.set("unrelated", 1);
    expect(ui.sayshape.viewState(id)?.x).toBe(after);
  });

  it("day view picks the earliest real date, and keeps items with no date with it", () => {
    const ui = render(`state s=[{start: "08:00", title: "Undated"}, {date: "2026-11-10", start: "09:00", title: "Tue"}, {date: "2026-11-09", start: "10:00", title: "Mon"}]\nschedule items=s view=day`);
    expect(geo(ui).blocks.map((b) => b.label).sort()).toEqual(["Mon", "Undated"]);
  });

  it("puts short blocks that touch as drawn side by side, not on top of each other", () => {
    const d = geo(render(`state s=[{start: "09:00", end: "09:05", title: "A"}, {start: "09:05", end: "09:30", title: "B"}]\nschedule items=s view=day`, { width: 600 }));
    const [a, b] = d.blocks;
    expect(a!.x + a!.w <= b!.x || b!.x + b!.w <= a!.x || a!.y + a!.h <= b!.y).toBe(true);
  });

  it("tells a screen reader where each row is now, after scrolling", () => {
    const ui = render(ROTA, { width: 360 });
    const box = ui.find("schedule").box!;
    const d = geo(ui);
    ui.wheel(box.x + d.axisW + 20, box.y + d.bodyY + 20, 0, { deltaX: 300 });
    const rows: AccessibleNode[] = [];
    const walk = (n: AccessibleNode) => { if (n.role === "row" && !n.key.endsWith("|head")) rows.push(n); n.children.forEach(walk); };
    walk(ui.accessibility({ full: true }));
    for (const r of rows) {
      expect(r.rect.x).toBeGreaterThanOrEqual(box.x + d.axisW - 1);
      expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(box.x + box.w + 1);
    }
  });

  it("warns when bind= has no key to write, and when tone= names a field no item has", () => {
    const ui = render(`state sel="" s=[{start: "09:00", title: "A"}]\nschedule items=s view=day bind=sel tone=good`);
    expect(ui.warnings.join(" ")).toContain("bind= needs each item's key");
    expect(ui.warnings.join(" ")).toContain('tone=good names the field');
  });

  it("shows a day when no view is given and nothing has a date", () => {
    expect(geo(render(`state s=[{start: "09:00", title: "A"}]\nschedule items=s`)).view).toBe("day");
    expect(geo(render(ROTA)).view).toBe("week");
  });

  it("never starts a block at 24:00", () => {
    const ui = render(`state s=[{start: "24:00", title: "Late"}, {start: "09:00", title: "A"}]\nschedule items=s view=day`);
    expect(geo(ui).blocks.map((b) => b.label)).toEqual(["A"]);
  });

  it("is a Tab stop of its own when it scrolls and no block can be pressed", () => {
    const ui = render(ROOMS, { width: 360 });
    ui.tab();
    expect(ui.focused?.type).toBe("schedule");
    const id = ui.find("schedule").node.id;
    ui.key("ArrowRight");
    expect(ui.sayshape.viewState(id)?.x).toBeGreaterThan(0);
  });

  it("keys at most six colors, the rest as Other", () => {
    const items = Array.from({ length: 8 }, (_, i) => `{start: "${String(8 + i).padStart(2, "0")}:00", title: "T${i}", team: "Team ${i}"}`).join(", ");
    const d = geo(render(`state s=[${items}]\nschedule items=s view=week date=day tone=team`.replace("view=week date=day", "view=day"), { width: 1024 }));
    expect(d.legend.map((l) => l.label)).toEqual(["Team 0", "Team 1", "Team 2", "Team 3", "Team 4", "Other"]);
    expect(new Set(d.blocks.map((b) => b.color)).size).toBe(6);
  });

  it("never cuts a month or day mark's name at the timeline's right edge", () => {
    // Found by the representation eval: in a card at 600px, "Dec" started 4px before the edge.
    const spec = `state plan=[{id: 1, name: "Design", from: "2026-11-02", to: "2026-11-20"}, {id: 2, name: "Build", from: "2026-11-16", to: "2026-12-18"}, {id: 3, name: "Testing", from: "2026-12-10", to: "2027-01-08"}, {id: 4, name: "Marketing", from: "2026-12-01", to: "2027-01-15"}, {id: 5, name: "Launch", from: "2027-01-15", to: "2027-01-15"}]
card
  text "App launch plan" style=title
  schedule view=timeline items=plan start=from end=to label=name rows=name
`;
    for (const width of [360, 600, 1024]) {
      const ui = render(spec, { width });
      expect(textOverflows(ui.sayshape.boxes!, ui.drawOps), `at ${width}px`).toEqual([]);
      ui.destroy();
    }
  });
});
