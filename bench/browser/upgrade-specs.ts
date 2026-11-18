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
  fog: `scene "Fog drifting over a lake" w=600 h=340 duration=12 bg="#1E2D44"
  gradient id=lake from="#2F4858" to="#14213D" angle=90
  polygon points="0,210 120,120 230,190 340,100 470,180 600,130 600,220 0,220" fill="#16243A"
  rect x=0 y=210 w=600 h=130 fill="url(lake)"
  group x={-80 + 15*t} y=0 blur=24 opacity=0.85
    ellipse x=160 y=190 rx=150 ry=30 fill="#FFFFFF 45%"
    ellipse x=380 y=212 rx=190 ry=36 fill="#FFFFFF 35%"
    ellipse x=600 y=180 rx=150 ry=28 fill="#FFFFFF 40%"
  label "Morning fog" x=24 y=36 size=22 weight=bold fill="#FFFFFF"`,
  smoke: `scene "Smoke rising from a chimney" w=600 h=340 duration=4 bg=surface
  rect x=0 y=300 w=600 h=40 fill="#7A8B6F"
  polygon points="200,200 320,130 440,200" fill="#8C3B2E"
  rect x=215 y=200 w=210 h=100 fill="#C9A27E"
  rect x=360 y=110 w=34 h=70 fill="#5A3E36"
  group blur=6
    each items={range(8)} as=i
      let u={((t/4) + i/8) % 1}
      circle x={377 + 26*sin(u*6 + i)} y={110 - 100*u} r={10 + 26*u} fill="#6B7280" opacity={0.7*(1 - u)}`,
  snowstormBlur: `scene "Snowstorm" w=600 h=340 duration=10 bg="#16324F"
  each items={range(10)} as=i
    circle x={(i*67 + t*12) % 620 - 10} y={(i*41 + t*18) % 360 - 10} r=2 fill="#FFFFFF" opacity=0.5 blur=2
  each items={range(140)} as=i
    circle x={(i*37 + t*(30 + 20*random(i))) % 620 - 10} y={(i*53 + t*(40 + 30*random(i+7))) % 360 - 10} r={1.5 + 3*random(i+3)} fill="#FFFFFF" opacity={0.5 + 0.5*random(i+11)}
  group blur=4
    each items={range(12)} as=i
      circle x={(i*97 + t*60) % 680 - 40} y={(i*61 + t*90) % 420 - 40} r={10 + 8*random(i+5)} fill="#FFFFFF" opacity=0.8`,
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
};
