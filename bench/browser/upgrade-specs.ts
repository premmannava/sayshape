/**
 * Specs for the scene upgrades benchmark and renders (upgrades.mjs). Each is
 * a scene a model might write with the newer props: lets, rate, z, light,
 * trails, line style, labels, faded stops, blur, shake, particles, reflections.
 */
export const UPGRADE_SPECS: Record<string, string> = {
  goalLabel: `scene "Goal!" w=600 h=300 duration=3 shake={14*(1 - ease(t, 0.2, 0.8))} bg="#1D3557"
  gradient id=gold from="#FFE08A" to="#E0A100" angle=90
  label "GOAL!" x=300 y=150 size={84 + 12*wave(t, 1)} weight=heavy style=italic align=center fill="url(gold)" stroke="#0B1D3A" width=10`,
  nightGlow: `scene "A moon over a hazy horizon" w=600 h=340 bg="#0B1D3A"
  gradient id=haze from="#E0807A 0%" to="#E0807A 70%" angle=90
  gradient id=moon kind=radial from="#FFF3B0 80%" to="#FFF3B0 0%"
  gradient id=fire kind=radial from="#FFB347" to="#FFB347 0%"
  rect x=0 y=180 w=600 h=160 fill="url(haze)"
  circle x=470 y=80 r=90 fill="url(moon)"
  circle x=470 y=80 r=26 fill="#FFF3B0"
  circle x=150 y=300 r=90 fill="url(fire)"`,
  litPlanets: `scene "Planets lit by their sun" w=600 h=340 duration=12 light=300,170 bg="#0B1026"
  circle x=300 y=170 r=34 fill="#FFD166" glow=true
  each items={range(8)} as=i
    circle x={300 + 230*cos(i*0.785 + t*0.3)} y={170 + 130*sin(i*0.785 + t*0.3)} r=16 fill={pick(['#4CC9F0', '#F72585', '#B5179E', '#7209B7'], i)} shine=true`,
  snowstormShapes: `scene "Snowstorm" w=600 h=340 duration=10 bg="#16324F"
  each items={range(150)} as=i
    circle x={(i*37 + t*(30 + 20*random(i))) % 620 - 10} y={(i*53 + t*(40 + 30*random(i+7))) % 360 - 10} r={1.5 + 3*random(i+3)} fill="#FFFFFF" opacity={0.5 + 0.5*random(i+11)}`,
  solarSystem: `state speed=5 hov=""
scene "The inner planets orbiting the Sun" w=600 h=340 duration=600 rate={speed} light=300,170 bg="#0B1026"
  circle x=300 y=170 r=28 fill="#FFD166" glow=true
  each items={[{name: 'Mercury', r: 60, per: 8.8, a0: 0.4, s: 5, c: '#B7B7B7'}, {name: 'Venus', r: 95, per: 22.5, a0: 2.1, s: 8, c: '#E9C46A'}, {name: 'Earth', r: 130, per: 36.5, a0: 4.0, s: 9, c: '#4CC9F0'}, {name: 'Mars', r: 160, per: 68.7, a0: 5.3, s: 7, c: '#E76F51'}]} as=p
    let a={p.a0 + t*6.2832/p.per}
    ellipse x=300 y=170 rx={p.r} ry={p.r*0.55} fill=none stroke="#FFFFFF 15%" width=1
    group x={300 + p.r*cos(a)} y={170 + p.r*0.55*sin(a)} z={sin(a)} on-hover=set:hov:{p.name} on-leave="set:hov:''"
      circle x=0 y=0 r={p.s} fill={p.c} shine=true
      label "{p.name}" x=0 y={-p.s - 9} size=12 fill="#FFFFFF 80%" align=center opacity={hov == p.name ? 1 : 0.6}
segmented bind=speed options={[1, 5, 20]}`,
  metroRounded: `scene "Two metro lines meeting at Central" w=600 h=340 bg=surface
  path d="M40 280 L200 280 L260 220 L260 120 L420 120 L560 60" fill=none stroke="#E63946" width=10 round=22 cap=round join=round
  path d="M40 60 L180 60 L260 140 L260 300 L560 300" fill=none stroke="#2A9D8F" width=10 round=22 cap=round join=round
  each items={[[200, 280], [260, 170], [420, 120], [180, 60], [400, 300]]} as=s
    circle x={s[0]} y={s[1]} r=8 fill=surface stroke=ink width=3
  label "Central" x=274 y=170 size=15 weight=bold fill=ink`,
  confetti: `scene "Confetti bursts from both sides" w=600 h=340 duration=5 shake={10*(1 - ease(t, 1.3, 1.8))*ease(t, 1.25, 1.3)}
  label "GOAL!" x=300 y=150 size=72 weight=heavy style=italic fill=accent align=center
  emit count=120 from=1.3 x=0 y=330 angle=-60 spread=30 speed=650 gravity=380 drag=1.6 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, #E63946, #FFFFFF"
  emit count=120 from=1.3 x=600 y=330 angle=-120 spread=30 speed=650 gravity=380 drag=1.6 life=3.5 size=9 shape=rect flutter=1 fill="accent, warn, good, #E63946, #FFFFFF"`,
  snowParticles: `scene "Snow blowing in gusts" w=600 h=340 duration=12 bg="#0B1D3A"
  let wind={40*sin(t*PI/3) + 15*sin(t*PI*2/3)}
  each items={range(150)} as=i
    circle x={(i*37 + t*(20 + i % 7)*3 + wind*2) % 640 - 20} y={(i*53 + t*(30 + i % 5)*6) % 380 - 20} r={1 + i % 3} fill="#FFFFFF" opacity={0.4 + 0.1*(i % 5)}
  emit count=450 x=-80 y=-20 w=760 angle=90 spread=20 speed=40 gravity=30 drag=0.8 wind={wind} life=12 size=4 fill="#FFFFFF, #DDE7F5"
  ellipse x=300 y=360 rx=420 ry=60 fill="#E8EEF6"`,
  firework: `scene "A firework bursts over the city" w=600 h=340 duration=4 bg="#0B1D3A"
  line x1=300 y1=340 x2=300 y2={340 - 220*ease(t, 0, 0.9)} stroke="#FFD166" width=3 opacity={1 - ease(t, 0.85, 0.95)}
  emit count=160 from=0.9 x=300 y=120 spread=360 speed=260 gravity=90 drag=1.2 life=2.2 size=4 shape=line fill="#FFD166, warn, #FF6B6B"`,
  skyline: `scene "Harbor at night" w=600 h=340 duration=8 bg="#0B1026"
  circle x=480 y=70 r=22 fill="#FFF3B0" glow=true
  rect x=0 y=220 w=600 h=120 fill="#13204A"
  group reflect=220 ripple=0.35 fade=0.7
    each items={range(30)} as=i
      rect x={i*20} y={220 - 40 - 110*random(i)} w=18 h={40 + 110*random(i)} fill="#1C2550"
    each items={range(30)} as=i
      rect x={i*20 + 6} y={220 - 20 - 90*random(i + 40)} w=5 h=6 fill="#FFD166" opacity={0.5 + 0.5*random(i + 80)}
  label "Harbor at night" x=24 y=36 size=22 weight=bold fill="#FFFFFF"`,
  orbitTrail: `scene "A planet leaving a trail" w=600 h=340 duration=8 bg="#0B1026" light=300,170
  circle x=300 y=170 r=26 fill="#FFD166" glow=true
  group x={300 + 200*cos(t*0.785)} y={170 + 110*sin(t*0.785)} trail=1.2 z={sin(t*0.785)}
    circle x=0 y=0 r=14 fill="#4CC9F0" shine=true
  circle x={-20 + 640*((t % 2.5)/2.5)} y={300 - 200*sin(PI*(t % 2.5)/2.5)} r=10 fill=warn trail=0.4 trail-count=10`,
  snowstormTrails: `scene "Snowstorm with streaks" w=600 h=340 duration=10 bg="#16324F"
  each items={range(150)} as=i
    circle x={(i*37 + t*(30 + 20*random(i))) % 620 - 10} y={(i*53 + t*(40 + 30*random(i+7))) % 360 - 10} r={1.5 + 3*random(i+3)} fill="#FFFFFF" opacity={0.5 + 0.5*random(i+11)} trail=0.3`,
};
