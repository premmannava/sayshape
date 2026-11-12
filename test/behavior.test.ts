/**
 * Experimental behavior (docs/plans/behavior.md): `every` rules that change
 * state on an interval, and dragging shapes in scenes. Off, nothing changes;
 * on, rules only write state, never fight the person, pause out of sight,
 * and never run in a burst; dragging writes through x= and y=.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { coreComponents } from "../src/components";
import { sceneComponents, reviewScenes } from "../src/components/scene";
import { languageGuide } from "../src/prompt";
import { MAX_RULES, MIN_RULE_INTERVAL, RuleRunner, SCREEN_STATE, type Clock, type RuleDef } from "../src/behavior";
import { SCREEN_KEY } from "../src/engine";
import { render, type Rendered } from "../src/testing";
import type { Box } from "../src/types";
import { corpus, registry as coreRegistry } from "./corpus";
import { COUNTDOWN, FALLING_BALL, POINT_ON_CURVE, STOCK } from "../playground/behavior-samples";

const ALL = [...coreComponents, ...sceneComponents];
const reg = new Registry(ALL);
const on = (spec: string, opts: Parameters<typeof render>[1] = {}) => render(spec, { behavior: true, components: ALL, ...opts });
const errors = (spec: string) => parse(spec, reg, { behavior: true }).diagnostics;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const TIMER = `state running=false left=5
every 1s if={running && left > 0} do=dec:left
stat label="Left" value={left}
button "Start" on=toggle:running
`;

describe("off by default", () => {
  it("leaves every an unknown element and drag= an unknown prop", () => {
    const d = parse(TIMER, coreRegistry).diagnostics;
    expect(d.some((x) => x.severity === "error" && x.message === 'Unknown element "every". It was skipped, along with anything inside it')).toBe(true);
    const s = parse(`state px=1\nscene "S" w=100 h=100\n  circle x={px} y=10 r=5 drag=true\n`, reg).diagnostics;
    expect(s[0]!.message).toMatch(/"circle" has no prop "drag". Known props: x, y, r, fill/);
    expect(s[0]!.message).not.toMatch(/drag/.source + ",");
  });

  it("parses every corpus spec to the same result with the flag off", () => {
    for (const [, spec] of corpus) {
      const a = parse(spec, coreRegistry);
      const b = parse(spec, coreRegistry, { behavior: false });
      expect(b).toEqual(a);
      expect("rules" in a).toBe(false);
    }
  });

  it("keeps the scene guides byte for byte, full and compact", () => {
    expect(languageGuide(reg)).toBe(fixture("guide-scene-full.txt"));
    expect(languageGuide(reg, { mode: "compact" })).toBe(fixture("guide-scene-compact.txt"));
  });

  it("registers no draggable regions and runs no timers", () => {
    const ui = render(`state px=50\nscene "S" w=100 h=100\n  circle x={px} y=50 r=20 drag=true\n`, { components: ALL, clock: true });
    expect(ui.hits.filter((h) => h.box.node.type === "scene")).toHaveLength(0);
    expect(ui.clock.pending).toBe(0);
  });

  it("uses the screen state name the engine uses", () => {
    expect(SCREEN_STATE).toBe(SCREEN_KEY);
  });
});

describe("rule lines", () => {
  const rule = (line: string) => parse(`state n=0 running=true\n${line}\nbutton "Go" on=toggle:running\n`, reg, { behavior: true });

  it("reads intervals in s and ms, keeping them within 16 ms and 60 s silently", () => {
    expect(rule("every 1s if={running} do=inc:n").rules![0]!.every).toBe(1000);
    expect(rule("every 250ms if={running} do=inc:n").rules![0]!.every).toBe(250);
    expect(rule("every 0.5s if={running} do=inc:n").rules![0]!.every).toBe(500);
    expect(rule("every .5s if={running} do=inc:n").rules![0]!.every).toBe(500);
    const fast = rule("every 1ms if={running} do=inc:n");
    expect(fast.rules![0]!.every).toBe(MIN_RULE_INTERVAL);
    expect(fast.diagnostics).toEqual([]);
    const slow = rule("every 600s if={running} do=inc:n");
    expect(slow.rules![0]!.every).toBe(60_000);
    expect(slow.diagnostics).toEqual([]);
  });

  it("reads on= as do= with nothing to fix", () => {
    const r = rule("every 1s if={running} on=inc:n");
    expect(r.diagnostics).toEqual([]);
    expect(r.rules![0]!.do).toBe("inc:n");
  });

  it("skips a rule with no interval, no do=, or a condition that doesn't parse", () => {
    for (const line of ["every if={running} do=inc:n", "every 1s if={running}", "every 1s if={running &&} do=inc:n", "every 0s do=inc:n"]) {
      const r = rule(line);
      expect(r.rules).toEqual([]);
      expect(r.diagnostics.some((d) => d.severity === "error" && d.line === 2)).toBe(true);
    }
  });

  it("refuses emit, go, back and notify: a spec can't call the app on a timer", () => {
    for (const a of ["emit:tick", "go:home", "back", "notify:'Hi'", "inc:n;emit:tick:{n}"]) {
      const r = rule(`every 1s if={running} do="${a}"`);
      expect(r.rules).toEqual([]);
      expect(r.diagnostics[0]!.message).toMatch(/Rules only change state/);
    }
  });

  it("refuses writes to screen, which would navigate", () => {
    const r = rule("every 1s if={running} do=set:screen:'pay'");
    expect(r.rules).toEqual([]);
    expect(r.diagnostics[0]!.message).toMatch(/can't change screen/);
  });

  it("keeps at most 8 rules and 8 actions each", () => {
    const many = Array.from({ length: MAX_RULES + 2 }, () => "every 1s if={running} do=inc:n").join("\n");
    const r = rule(many);
    expect(r.rules).toHaveLength(MAX_RULES);
    expect(r.diagnostics.filter((d) => /at most 8 rules/.test(d.message))).toHaveLength(2);
    const long = rule(`every 1s if={running} do="${Array(9).fill("inc:n").join(";")}"`);
    expect(long.rules).toEqual([]);
  });

  it("warns about a rule nothing on the screen can stop", () => {
    const r = parse(`state n=0\nevery 1s do=inc:n\ntext "{n}"\n`, reg, { behavior: true });
    expect(r.rules).toHaveLength(1);
    expect(r.diagnostics[0]!.message).toMatch(/Nothing on the screen can stop this rule/);
  });

  it("warns about a rule that would open a dialog", () => {
    const r = parse(`state open=false running=true\nevery 5s if={running} do=set:open:true\nbutton "Stop" on=toggle:running\ndialog "Hi" bind=open\n  text "Hello"\n`, reg, { behavior: true });
    expect(r.diagnostics.map((d) => d.message).join()).toMatch(/can't open or close a dialog/);
  });

  it("is read at the top level wherever it's written, except inside each", () => {
    const top = parse(`state n=0 running=true items=[1]\ncard\n  every 1s if={running} do=inc:n\n  button "Go" on=toggle:running\n`, reg, { behavior: true });
    expect(top.rules).toHaveLength(1);
    const inner = parse(`state n=0 running=true items=[1]\neach items=items as=i\n  every 1s if={running} do=inc:n\nbutton "Go" on=toggle:running\n`, reg, { behavior: true });
    expect(inner.rules).toEqual([]);
    expect(inner.diagnostics[0]!.message).toMatch(/Rules can't go inside each/);
  });

  it("warns about writes to derived values and names nothing defines", () => {
    const r = parse(`state running=true n=0\nderive d={n * 2}\nevery 1s if={running} do="inc:d;set:n:{ghost}"\nbutton "Go" on=toggle:running\n`, reg, { behavior: true });
    const all = r.diagnostics.map((d) => d.message).join("\n");
    expect(all).toMatch(/derive/);
    expect(all).toMatch(/ghost/);
  });

  it("lets rules use the pure math scenes have, and nothing more", () => {
    expect(rule("every 16ms if={running} do=set:n:{sin(n) + cos(n) + tan(n) + atan2(n, 1) + sqrt(4) + clamp(n, 0, 1) + lerp(0, 1, 0.5)}").diagnostics).toEqual([]);
    const ease = rule("every 16ms if={running} do=set:n:{ease(n, 0, 1)}");
    expect(ease.rules).toEqual([]);
  });

  it("streams: every prefix parses into fewer rules, never an error", () => {
    for (const spec of [TIMER, COUNTDOWN, STOCK, FALLING_BALL, POINT_ON_CURVE]) {
      const lines = spec.split("\n");
      let last = 0;
      for (let i = 0; i <= lines.length; i++) {
        const prefix = lines.slice(0, i).join("\n") + (i ? "\n" : "");
        const p = parse(prefix, reg, { behavior: true });
        expect(p.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        expect(p.rules!.length).toBeGreaterThanOrEqual(last);
        last = p.rules!.length;
      }
    }
  });
});

describe("running rules", () => {
  it("starts one interval after its condition turns true, ticks, and stops by itself", () => {
    const ui = on(TIMER);
    ui.clock.advance(5000);
    expect(ui.state.left).toBe(5);
    ui.press("button");
    ui.clock.advance(999);
    expect(ui.state.left).toBe(5);
    ui.clock.advance(1);
    expect(ui.state.left).toBe(4);
    ui.clock.advance(60_000);
    expect(ui.state.left).toBe(0);
    expect(ui.clock.pending).toBe(0);
    expect(ui.sayshape.ruleStatus).toEqual({ count: 1, running: 0, paused: false });
  });

  it("pauses with its condition and starts a full interval later", () => {
    const ui = on(TIMER);
    ui.press("button");
    ui.clock.advance(1500);
    ui.press("button");
    ui.clock.advance(5000);
    expect(ui.state.left).toBe(4);
    ui.press("button");
    ui.clock.advance(999);
    expect(ui.state.left).toBe(4);
    ui.clock.advance(1);
    expect(ui.state.left).toBe(3);
  });

  it("runs chained actions in order, each seeing the last, and rules due together in written order", () => {
    const ui = on(`state running=true vy=0 y=0 log=''\nevery 100ms if={running} do="inc:vy:10;inc:y:{vy}"\nevery 100ms if={running} do="set:log:'{log}{y},'"\nbutton "Stop" on=toggle:running\n`);
    ui.clock.advance(300);
    expect(ui.state.vy).toBe(30);
    expect(ui.state.y).toBe(60);
    expect(ui.state.log).toBe("10,30,60,");
  });

  it("never runs a burst of missed ticks", () => {
    const ui = on(`state running=true n=0\nevery 100ms if={running} do=inc:n\nbutton "Stop" on=toggle:running\n`);
    ui.clock.advance(300);
    expect(ui.state.n).toBe(3);
    ui.sayshape.pauseRules();
    ui.clock.advance(10_000);
    expect(ui.state.n).toBe(3);
    ui.sayshape.resumeRules();
    ui.clock.advance(99);
    expect(ui.state.n).toBe(3);
    ui.clock.advance(1);
    expect(ui.state.n).toBe(4);
  });

  it("doesn't start while the spec streams, and stops when it's replaced", () => {
    const ui = on(`button "x"\n`);
    ui.sayshape.beginStream();
    ui.sayshape.push(`state n=0 running=true\nevery 100ms if={running} do=inc:n\nbutton "Stop" on=toggle:running\n`);
    ui.sayshape.renderNow();
    ui.clock.advance(1000);
    expect(ui.state.n).toBe(0);
    ui.sayshape.endStream();
    ui.sayshape.renderNow();
    ui.clock.advance(1000);
    expect(ui.state.n).toBe(10);
    ui.setSpec(`text "Something else"\n`);
    ui.clock.advance(1000);
    expect(ui.state.n).toBe(10);
    expect(ui.clock.pending).toBe(0);
  });

  it("keeps its timing when an unrelated line changes", () => {
    const spec = `state n=0 running=true\nevery 100ms if={running} do=inc:n\nbutton "Stop" on=toggle:running\n`;
    const ui = on(spec);
    ui.clock.advance(150);
    ui.setSpec(spec + `text "More"\n`);
    ui.clock.advance(50);
    expect(ui.state.n).toBe(2);
  });

  it("stops when the engine is destroyed", () => {
    const ui = on(`state n=0 running=true\nevery 100ms if={running} do=inc:n\nbutton "Stop" on=toggle:running\n`);
    ui.sayshape.destroy();
    expect(ui.clock.pending).toBe(0);
  });

  it("waits for a first press or key with reduced motion", () => {
    const ui = on(`state n=0 running=true\nevery 100ms if={running} do=inc:n\nbutton "Stop" on=toggle:running\n`, { reducedMotion: true });
    ui.clock.advance(1000);
    expect(ui.state.n).toBe(0);
    expect(ui.sayshape.ruleStatus.paused).toBe(true);
    ui.key("Tab");
    ui.clock.advance(100);
    expect(ui.state.n).toBe(1);
  });

  it("never writes the field the person is typing in", () => {
    const ui = on(`state note='' running=true n=0\nevery 100ms if={running} do="set:note:'auto';inc:n"\ninput "Note" bind=note\nbutton "Stop" on=toggle:running\n`);
    ui.clock.advance(100);
    expect(ui.state.note).toBe("auto");
    ui.type("input", "mine", { replace: true });
    ui.clock.advance(500);
    expect(ui.state.note).toBe("mine");
    expect(ui.state.n).toBe(6);
  });

  it("never opens a dialog or changes the screen, even when it writes them", () => {
    const ui = on(`state open=false running=true\nevery 100ms if={running} do=set:open:true\nbutton "Stop" on=toggle:running\ndialog "Hi" bind=open\n  text "Hello"\n`);
    ui.clock.advance(500);
    expect(ui.state.open).toBe(false);
  });

  it("can't grow a list past 500 items", () => {
    const ui = on(`state running=true xs=[]\nevery 16ms if={running} do=add:xs:1\nbutton "Stop" on=toggle:running\n`);
    ui.clock.advance(16 * 600);
    expect((ui.state.xs as unknown[]).length).toBe(500);
    expect(ui.warnings.join()).toMatch(/stopped growing xs at 500/);
  });

  it("tells screen readers nothing per tick, and rebuilds the mirror at most once a second", () => {
    const ui = on(`state running=true n=0\nevery 16ms if={running && n < 300} do=inc:n\nstepper "Count" bind=n max=1000\nbutton "Stop" on=toggle:running\n`);
    const before = ui.mirror.updates;
    ui.clock.advance(3000);
    expect(ui.announcements).toEqual([]);
    expect(ui.mirror.updates - before).toBeLessThanOrEqual(4);
    expect(ui.mirror.quietUpdates).toBeGreaterThan(0);
    // The rule ends (n reaches 300): the mirror catches up at once, not quietly.
    ui.clock.advance(3000);
    const quiet = ui.mirror.quietUpdates, all = ui.mirror.updates;
    expect(all).toBeGreaterThan(quiet);
  });
});

describe("the sandbox", () => {
  it("emits nothing, navigates nowhere and notifies nobody, even with a rule built by hand", () => {
    const ui = on(`screen name=home\n  text "Home"\nscreen name=pay\n  text "Pay"\n`);
    expect(ui.sayshape.currentScreen).toBe("home");
    const hand: RuleDef = {
      line: 1, every: 16, do: "",
      actions: [{ op: "emit", name: "tick" }, { op: "go", screen: "pay" }, { op: "notify", message: "Hi" }, { op: "set", key: "screen", value: "pay" }],
    } as unknown as RuleDef;
    (ui.sayshape as unknown as { runRules(r: RuleDef[]): void }).runRules([hand]);
    ui.sayshape.renderNow();
    expect(ui.emitted).toEqual([]);
    expect(ui.sayshape.currentScreen).toBe("home");
    expect(ui.announcements).toEqual([]);
  });

  it("can't reach JavaScript through a rule's expressions", () => {
    for (const expr of ["constructor.constructor('return 1')()", "n.__proto__", "this", "globalThis", "sin.constructor"]) {
      const ui = on(`state n=1 running=true out=0\nevery 16ms if={running} do=set:out:{${expr}}\nbutton "Stop" on=toggle:running\n`);
      ui.clock.advance(50);
      expect(typeof ui.state.out === "function").toBe(false);
      expect(ui.emitted).toEqual([]);
    }
  });

  it("doesn't run another rule in the same tick: work per tick is bounded", () => {
    const ui = on(`state running=true a=false n=0\nevery 100ms if={running} do=set:a:true\nevery 100ms if={a} do=inc:n\nbutton "Stop" on=toggle:running\n`);
    ui.clock.advance(100);
    expect(ui.state.n).toBe(0);
    ui.clock.advance(100);
    expect(ui.state.n).toBe(1);
  });
});

describe("the slow-down guard", () => {
  /** A clock whose time moves on as ticks do work, so ticks cost something. */
  function costly(costMs: number) {
    let t = 0;
    let seq = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const clock: Clock = {
      now: () => t,
      setTimeout: (fn, ms) => { timers.set(++seq, { at: t + ms, fn }); return seq; },
      clearTimeout: (h) => { timers.delete(h as number); },
    };
    const ticks: Array<{ at: number; rules: number[] }> = [];
    let runner: RuleRunner;
    const host = {
      clock,
      scope: () => true,
      tick: (rules: readonly RuleDef[]) => { ticks.push({ at: t, rules: rules.map((r) => r.every) }); t += costMs; },
    };
    runner = new RuleRunner(host);
    const advance = (ms: number) => {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || due[1].at > end) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
        runner.frameCost(0);
      }
      t = end;
    };
    return { runner, advance, ticks };
  }
  const r = (every: number, line = 1): RuleDef => ({ line, every, do: "inc:n", actions: [] });

  it("slows only the rules faster than the new floor: a 1 s rule stays 1 s", () => {
    const { runner, advance, ticks } = costly(10);
    runner.set([r(16, 1), r(1000, 2)]);
    advance(10_000);
    expect(runner.currentFloor).toBeGreaterThan(MIN_RULE_INTERVAL);
    const slow = ticks.filter((x) => x.rules.includes(1000)).map((x) => x.at);
    const gaps = slow.slice(1).map((v, i) => v - slow[i]!);
    // Within a tick's cost of a second: it waits behind a tick in progress, never a doubled interval.
    for (const g of gaps) expect(Math.abs(g - 1000)).toBeLessThanOrEqual(20);
    expect(slow.length).toBeGreaterThanOrEqual(9);
  });

  it("leaves cheap ticks at their own interval", () => {
    const { runner, advance } = costly(1);
    runner.set([r(16)]);
    advance(5000);
    expect(runner.currentFloor).toBe(MIN_RULE_INTERVAL);
  });
});

describe("the test clock", () => {
  it("draws a scene at the time a test chooses", () => {
    const ui = render(`scene "Dot" w=200 h=100 duration=2 loop=false\n  label "o" x={10 + 90*t} y=50 fill=ink\n`, { components: ALL, clock: true, animate: true });
    const xs = () => ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === "o").map((o) => Math.round(Number(o.args[1])));
    const start = xs()[0]!;
    ui.clock.advance(1000);
    expect(xs()[0]! - start).toBe(90);
  });
});

// ------------------------------------------------------------------ dragging

function sceneAt(ui: Rendered, w: number, h: number) {
  const box = ui.find({ type: "scene" }).box as Box;
  return (x: number, y: number): [number, number] => [box.x + (x * box.w) / w, box.y + (y * box.h) / h];
}
function drag(ui: Rendered, from: [number, number], to: [number, number], opts: { cancel?: boolean } = {}) {
  const p = (type: string, [x, y]: [number, number]) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });
  p("pointermove", from);
  p("pointerdown", from);
  ui.sayshape.renderNow();
  p("pointermove", [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  ui.sayshape.renderNow();
  p("pointermove", to);
  ui.sayshape.renderNow();
  if (opts.cancel) p("pointercancel", to);
  else p("pointerup", to);
  ui.sayshape.renderNow();
}

describe("dragging in scenes", () => {
  const POINT = `state px=100 py=100
scene "Point" w=600 h=300
  circle x={px} y={py} r=14 fill=accent drag=true name="Point"
`;

  it("moves the state its x= and y= read, to where the pointer goes", () => {
    const ui = on(POINT, { width: 640 });
    const at = sceneAt(ui, 600, 300);
    drag(ui, at(100, 100), at(300, 200));
    expect(ui.state.px).toBe(300);
    expect(ui.state.py).toBe(200);
  });

  it("keeps where it was grabbed, and stays inside the picture", () => {
    const ui = on(POINT, { width: 640 });
    const at = sceneAt(ui, 600, 300);
    drag(ui, at(108, 100), at(208, 100));
    expect(ui.state.px).toBe(200);
    drag(ui, at(200, 100), at(5000, -400));
    expect(ui.state.px).toBe(600);
    expect(ui.state.py).toBe(0);
  });

  it("moves only the axes written as a name, within clamp()'s bounds", () => {
    const ui = on(`state u=120\nscene "Curve" w=600 h=300\n  circle x={clamp(u, 40, 560)} y={150 - u/10} r=14 drag=true\n`, { width: 640 });
    const at = sceneAt(ui, 600, 300);
    drag(ui, at(120, 138), at(20, 10));
    expect(ui.state.u).toBe(40);
    expect(Object.keys(ui.state)).toEqual(["u"]);
  });

  it("follows the pointer through a group's move, turn and scale", () => {
    const ui = on(`state a=0\nscene "S" w=400 h=400\n  group x=200 y=200 rotate=90 scale=2\n    circle x={a} y=0 r=10 drag=true\n`, { width: 440 });
    const at = sceneAt(ui, 400, 400);
    // Turned 90°, the group's x runs down the screen, twice as fast.
    drag(ui, at(200, 200), at(200, 300));
    expect(ui.state.a).toBe(50);
  });

  it("drags an item of the scene's each, writing it in its list", () => {
    const ui = on(`state pins=[{id: 'a', x: 100, y: 100}, {id: 'b', x: 300, y: 100}]\nscene "Pins" w=400 h=200\n  each items=pins as=p key={p.id}\n    circle x={p.x} y={p.y} r=14 drag=true\n`, { width: 440 });
    const at = sceneAt(ui, 400, 200);
    drag(ui, at(300, 100), at(250, 150));
    expect(ui.state.pins).toEqual([{ id: "a", x: 100, y: 100 }, { id: "b", x: 250, y: 150 }]);
  });

  it("presses on= when it isn't moved, and puts things back when the browser cancels", () => {
    const ui = on(`state px=100 py=100 sel=''\nscene "P" w=600 h=300\n  circle x={px} y={py} r=14 drag=true on=set:sel:'p'\n`, { width: 640 });
    const at = sceneAt(ui, 600, 300);
    drag(ui, at(100, 100), at(101, 100));
    expect(ui.state.sel).toBe("p");
    expect(ui.state.px).toBe(100);
    drag(ui, at(100, 100), at(200, 200), { cancel: true });
    expect(ui.state.px).toBe(100);
    expect(ui.state.py).toBe(100);
  });

  it("leaves pressable shapes pressing, beside draggable ones", () => {
    const ui = on(`state px=100 sel=''\nscene "P" w=600 h=300\n  circle x={px} y=100 r=14 drag=true\n  rect x=400 y=50 w=100 h=100 on=set:sel:'box'\n`, { width: 640 });
    const at = sceneAt(ui, 600, 300);
    ui.click(...at(450, 100));
    expect(ui.state.sel).toBe("box");
    const regions = ui.hits.filter((h) => h.box.node.type === "scene");
    expect(regions.map((h) => h.drags)).toEqual([undefined, false]);
  });

  it("moves with the arrow keys, Page keys, Home and End", () => {
    const ui = on(`state u=300\nscene "S" w=600 h=300\n  circle x={clamp(u, 100, 600)} y=150 r=14 drag=true name="Knob"\n`, { width: 640 });
    ui.tab();
    ui.key("ArrowRight");
    expect(ui.state.u).toBe(310);
    ui.key("ArrowLeft");
    ui.key("ArrowLeft");
    expect(ui.state.u).toBe(290);
    ui.key("PageUp");
    expect(ui.state.u).toBe(340);
    ui.key("Home");
    expect(ui.state.u).toBe(100);
    ui.key("End");
    expect(ui.state.u).toBe(600);
  });

  it("is a slider moving one way, and a movable part moving both", () => {
    const one = on(`state u=300\nscene "S" w=600 h=300\n  circle x={clamp(u, 100, 500)} y=150 r=14 drag=true name="Knob"\n`);
    expect(JSON.stringify(one.accessibility())).toMatch(/"role":"slider","name":"Knob","state":\["value 300","range 100 to 500"/);
    const two = on(POINT);
    const tree = two.accessibility({ full: true });
    const part = JSON.stringify(tree);
    expect(part).toMatch(/"roleDescription":"movable"/);
    expect(part).toMatch(/x 100, y 100\. Arrow keys move it/);
  });

  it("takes vertical swipes only on shapes that move up and down", () => {
    const ui = on(`state px=100 py=100 u=100\nscene "S" w=600 h=300\n  circle x={px} y={py} r=14 drag=true\n  circle x={u} y=250 r=14 drag=true\n`);
    expect(ui.hits.filter((h) => h.box.node.type === "scene").map((h) => !!h.claimsSwipe)).toEqual([true, false]);
  });

  it("isn't written over by a rule while it's held", () => {
    const ui = on(`state running=true y=100 n=0\nevery 16ms if={running} do="set:y:100;inc:n"\nbutton "Stop" on=toggle:running\nscene "S" w=400 h=300\n  circle x=200 y={y} r=20 drag=true\n`, { width: 440 });
    const at = sceneAt(ui, 400, 300);
    const p = (type: string, [x, y]: [number, number]) => ui.canvas.dispatch(type, { clientX: x, clientY: y, pointerId: 1 });
    p("pointermove", at(200, 100));
    p("pointerdown", at(200, 100));
    p("pointermove", at(200, 200));
    ui.clock.advance(200);
    expect(ui.state.y).toBe(200);
    p("pointerup", at(200, 200));
    ui.clock.advance(20);
    expect(ui.state.y).toBe(100);
  });

  it("warns when it can't tell what a drag moves, or when an axis silently stays still", () => {
    const none = errors(`state a=1\nscene "S" w=100 h=100\n  circle x={a + 1} y=10 r=5 drag=true\n`);
    expect(none[0]!.message).toMatch(/drag=true needs x= or y= to be a state name or item path/);
    const half = errors(`state px=1 py=1\nscene "S" w=100 h=100\n  circle x={px} y={py + 0} r=5 drag=true\n`);
    expect(half[0]!.message).toMatch(/y=\{py \+ 0\} reads py, which this drag doesn't move/);
    // Reading what the drag moves, t, or each's index is fine.
    expect(errors(`state u=1 items=[1, 2]\nscene "S" w=100 h=100 duration=2\n  circle x={u} y={50 - u + 3*sin(t)} r=5 drag=true\n  each items=items as=v index=i\n    circle x={10 + i*30} y={v} r=5 drag=true\n`)).toEqual([]);
  });

  it("warns in the drawing check about shapes that would trap page scrolling", () => {
    const parsed = parse(`state px=100 py=100\nscene "S" w=300 h=300\n  rect x={px} y={py} w=250 h=250 drag=true\n`, reg, { behavior: true });
    expect(reviewScenes(parsed, { behavior: true }).map((d) => d.message).join()).toMatch(/cover over a third of the picture/);
    expect(reviewScenes(parsed).map((d) => d.message).join()).not.toMatch(/cover over a third/);
  });
});

describe("the playground samples", () => {
  it("parse with no problems and draw cleanly", () => {
    for (const spec of [COUNTDOWN, STOCK, FALLING_BALL, POINT_ON_CURVE]) {
      const parsed = parse(spec, reg, { behavior: true });
      expect(parsed.diagnostics).toEqual([]);
      expect(reviewScenes(parsed, { behavior: true })).toEqual([]);
    }
  });

  it("count down, run stock down, drop a ball, and move a point", () => {
    const timer = on(COUNTDOWN);
    timer.press({ type: "button", text: "Start" });
    timer.clock.advance(91_000);
    expect(timer.state.left).toBe(0);
    expect(timer.isShown("callout")).toBe(true);

    const stock = on(STOCK);
    stock.press({ type: "button", text: "Play" });
    stock.clock.advance(30_000);
    expect(stock.state.stock).toBe(0);
    expect((stock.state.history as unknown[]).length).toBeGreaterThan(10);
    stock.press({ type: "button", text: "Restock to 240" });
    expect(stock.state.stock).toBe(240);
    expect(stock.state.history).toEqual([{ day: 0, units: 240 }]);

    const ball = on(FALLING_BALL);
    ball.press({ type: "button", text: "Drop" });
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) { ball.clock.advance(16); ys.push(ball.state.y as number); }
    // It speeds up as it falls, lands on the floor, and bounces back up.
    expect(ys[10]! - ys[5]!).toBeLessThan(ys[20]! - ys[15]!);
    const landed = ys.indexOf(260);
    expect(landed).toBeGreaterThan(0);
    expect(ys[landed + 5]!).toBeLessThan(260);

    const point = on(POINT_ON_CURVE, { width: 640 });
    point.tab();
    point.key("End");
    expect(point.state.px).toBe(540);
  });
});
