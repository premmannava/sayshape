/**
 * Samples that need the experimental scene elements: the playground offers
 * them only with ?scene=1, where sceneComponents are registered. Each is a
 * plain spec, written with the same language a model is given.
 */
import type { Sample } from "./samples";

/**
 * A factory operations monitor: a production line drawn in a scene from one
 * reusable machine drawing, its machines from a list in state. Pressing a
 * machine (or Tab and Enter) selects it; the details panel and the controls
 * below work on the selected machine, and the scene follows them without a
 * new spec.
 */
export const FACTORY_MONITOR = `state sel='press' speed='Normal' running=true
state machines=[{id: 'cut', name: 'Cutter', kind: 'Laser cutter', x: 110, health: 96, temp: 41, rate: 118}, {id: 'press', name: 'Press', kind: 'Hydraulic press', x: 300, health: 71, temp: 78, rate: 96}, {id: 'weld', name: 'Welder', kind: 'Robot welder', x: 490, health: 38, temp: 92, rate: 64}, {id: 'pack', name: 'Packer', kind: 'Box packer', x: 680, health: 88, temp: 36, rate: 110}]
derive m={find(machines, 'id', sel)}
derive pace={running ? (speed == 'Slow' ? 1 : speed == 'Fast' ? 3 : 2) : 0}
card
  row align=top
    column gap=4
      text "Line 3 operations" style=title
      text "Press a machine to see its details" tone=muted
    badge "{running ? 'Running' : 'Stopped'}" tone={running ? 'good' : 'warn'}
  scene "Production line 3: cutter, press, welder and packer on one conveyor" w=800 h=280 duration=12
    define "machine"
      rect x=-70 y=-84 w=140 h=128 rx=16 fill=raised stroke=line width=2
      rect x=-54 y=-68 w=108 h=50 rx=10 fill="{tone} 14%"
      circle x=-28 y=-43 r=17 fill=none stroke={tone} width=3
      group x=-28 y=-43 rotate={t * spin * 30}
        line x1=-11 y1=0 x2=11 y2=0 stroke={tone} width=3
        line x1=-5 y1=-9 x2=5 y2=9 stroke={tone} width=3
        line x1=-5 y1=9 x2=5 y2=-9 stroke={tone} width=3
      label "{health}%" x=26 y=-43 size=22 weight=bold align=center fill=ink
      rect x=-54 y=-8 w=108 h=8 rx=4 fill=line
      rect x=-54 y=-8 w={1.08 * health} h=8 rx=4 fill={tone}
      label "{title}" x=0 y=22 size=20 weight=bold align=center fill=ink
      circle x=56 y=-98 r={tone == 'bad' ? 9 + 4 * wave(t, 1) : 9} fill={tone}
    define "crate"
      rect x=-15 y=-15 w=30 h=30 rx=5 fill=series4 stroke="ink 25%"
      line x1=-15 y1=0 x2=15 y2=0 stroke="ink 20%" width=2
    rect x=0 y=0 w=800 h=280 fill=surface
    each items=machines as=mc
      rect x={mc.x - 4} y=172 w=8 h=60 fill=line
    rect x=20 y=232 w=760 h=28 rx=14 fill=line
    each items={range(8)} as=i
      use "crate" x={20 + ((i / 8 + t * pace / 12) % 1) * 760} y=214
    each items=machines as=mc
      group x={mc.x} y=128 on=set:sel:{mc.id} selected={sel == mc.id} name="{mc.name}, {mc.health}% health" tip="{mc.kind}: {mc.rate} parts/h"
        use "machine" args={{title: mc.name, health: mc.health, tone: mc.health >= 80 ? 'good' : mc.health >= 50 ? 'warn' : 'bad', spin: running ? round(mc.rate / 30) / 3 : 0}}
  row align=top
    details "{m.name}" subtitle="{m.kind}"
      detail "Health" value="{m.health}%" tone={m.health >= 80 ? 'good' : m.health >= 50 ? 'warn' : 'bad'}
      detail "Temperature" value="{m.temp} °C"
      detail "Output" value="{m.rate} parts/h"
      detail "Next step" value={m.health >= 80 ? 'Nothing to do' : m.health >= 50 ? 'Inspect this week' : 'Service now'}
    column gap=12
      text "Line controls" style=lead
      switch "Line running" bind=running
      segmented bind=speed options="Slow,Normal,Fast"
      each items=machines as=mc
        slider "{mc.name} output: {mc.rate} parts/h" bind=mc.rate min=0 max=150 step=6 if={mc.id == sel}
      button "Request service for {m.name}" variant=secondary on=emit:service:{m.id} disabled={m.health >= 80}`;

export const sceneSamples: Record<string, Sample> = {
  factoryMonitor: {
    label: "Factory monitor (scene)",
    prompt: "Show line 3 of our plant as a live diagram: machines with their health, parts moving along the conveyor, and let me pick a machine to see its details and adjust it.",
    spec: FACTORY_MONITOR,
  },
};
