/**
 * Example specs that show the visual features together: the system font and
 * light figures (look type=system, weight=light), named fills and glass
 * (card fill=, variant=glass), and scenes sized, clipped and with icons
 * (maxw=, group clip=true, icon, after=). Rebuilt from a chat session about
 * phone widgets; also rendered by the visual regression suite
 * (visual/cases.ts, `example-*`) in light and dark, and checked by
 * test/example-specs.test.ts.
 *
 * scene: true and device: true mean the spec needs the experimental scene
 * elements (sceneComponents) or device frame (deviceComponents) registered.
 */
export interface ExampleSpec {
  /** What it shows, in a few words. */
  label: string;
  spec: string;
  scene?: boolean;
  /** Needs the experimental device frame (deviceComponents) registered. */
  device?: boolean;
}

export const exampleSpecs: Record<string, ExampleSpec> = {
  "weather-small": {
    label: "A small iPhone-style weather card",
    spec: `look type=system shape=round
card fill=sky gap=4
  text "Phoenix" weight=semibold icon=pin
  text "72°" style=display weight=light
  icon name=sun tone=warn size=md label="Sunny"
  text "Sunny" weight=semibold
  text "H:81° L:58°"
`,
  },
  "forecast-9day": {
    label: "A compact 9-day forecast",
    spec: `look type=system density=compact shape=round
state days=[{d: "Today", i: "sun", lo: 58, hi: 81}, {d: "Thu", i: "sun", lo: 60, hi: 83}, {d: "Fri", i: "cloud", lo: 61, hi: 79}, {d: "Sat", i: "rain", lo: 55, hi: 70}, {d: "Sun", i: "storm", lo: 52, hi: 66}, {d: "Mon", i: "cloud", lo: 54, hi: 72}, {d: "Tue", i: "sun", lo: 57, hi: 77}, {d: "Wed", i: "sun", lo: 59, hi: 80}, {d: "Thu", i: "wind", lo: 56, hi: 74}]
card fill=dusk gap=8
  row align=center fit=true gap=6
    icon name=calendar size=sm
    text "9-day forecast" style=caption weight=semibold
  divider
  each items=days as=day
    row align=center wrap=false
      text "{day.d}" weight=semibold
      icon name={day.i} size=sm
      text "{day.lo}°" align=right
      progress value={day.hi - 50} max=35 tone=warn
      text "{day.hi}°" align=right
`,
  },
  "home-screen": {
    label: "A phone home screen: widgets, a 4×4 grid of app icons and a glass dock",
    scene: true,
    spec: `scene "A phone home screen with a weather widget, sixteen app icons and a dock" w=393 h=852 maxw=295 bg="#0B1D3A"
  gradient id=wall from="#1B3B6F" to="#0B1D3A" angle=90
  group x=0 y=0 clip=true w=393 h=852 rx=48
    rect x=0 y=0 w=393 h=852 fill="url(wall)"
    circle x=60 y=180 r=200 fill="#5AB8F5" opacity=0.35 glow=true
    circle x=360 y=640 r=220 fill="#B07CF7" opacity=0.3 glow=true
    label "9:41" x=40 y=30 size=17 weight=bold fill="#FFFFFF"
    rect x=24 y=70 w=345 h=160 rx=28 fill="#FFFFFF" opacity=0.18
    label "Phoenix" id=city x=44 y=104 size=17 weight=bold fill="#FFFFFF"
    icon name=pin after=city x=6 y=104 size=16 fill="#FFFFFF"
    label "72°" x=44 y=160 size=56 weight=light fill="#FFFFFF"
    icon name=sun x=300 y=110 size=40 fill="#FFD166"
    label "Sunny  H:81° L:58°" x=44 y=208 size=15 fill="#FFFFFF"
    each items={range(16)} as=i
      group x={36 + (i % 4) * 84} y={264 + floor(i / 4) * 96}
        rect x=0 y=0 w=64 h=64 rx=16 fill={pick(['#F28C38', '#2F7FE0', '#40916C', '#B07CF7', '#E5484D', '#FFD166', '#5AB8F5', '#2D6A4F'], i % 8)} shadow=sm
        icon name={pick(['mail', 'calendar', 'map', 'image', 'heart', 'star', 'cloud', 'book', 'chat', 'phone', 'settings', 'search', 'cart', 'bell', 'play', 'wallet'], i)} x=18 y=32 size=28 fill="#FFFFFF"
    rect x=20 y=736 w=353 h=92 rx=32 fill="#FFFFFF" opacity=0.22
    each items={range(4)} as=j
      group x={44 + j * 84} y=750
        rect x=0 y=0 w=64 h=64 rx=16 fill={pick(['#40916C', '#2F7FE0', '#F28C38', '#E5484D'], j)}
        icon name={pick(['phone', 'chat', 'search', 'play'], j)} x=18 y=32 size=28 fill="#FFFFFF"
`,
  },
  "home-device": {
    label: "The same home screen as SayShape layout inside a device frame",
    device: true,
    spec: `look type=system shape=round
state apps=[{n: "Mail", i: "mail"}, {n: "Calendar", i: "calendar"}, {n: "Maps", i: "map"}, {n: "Photos", i: "image"}, {n: "Health", i: "heart"}, {n: "Notes", i: "book"}, {n: "Weather", i: "cloud"}, {n: "Music", i: "play"}]
device "A phone home screen with a weather widget, app tiles and a dock" kind=iphone scale=0.75 status=true
  card fill=sky gap=2
    text "Phoenix" weight=semibold icon=pin
    text "72°" style=display weight=light
    text "Sunny · H:81° L:58°"
  grid min=70 cols=4 gap=10
    each items=apps as=a
      column gap=4
        icon name={a.i} size=lg label="{a.n}"
        text "{a.n}" style=caption
  card variant=glass
    row wrap=false
      button "Phone" icon=phone variant=secondary on=emit:phone
      button "Messages" icon=chat variant=secondary on=emit:messages
`,
  },
  "music-player": {
    label: "A music player card",
    spec: `state playing=true at=74
card variant=glass gap=12
  row align=center
    column gap=2
      text "Midnight City" weight=semibold
      text "M83 · Hurry Up, We're Dreaming" tone=muted
    badge "Lossless" tone=accent
  slider bind=at min=0 max=243
  row wrap=false
    text "1:14" style=caption tone=muted
    text "4:03" style=caption tone=muted align=right
  row justify=between align=center
    button "Back" icon=arrow-left variant=secondary on=set:at:0
    button "{playing ? 'Pause' : 'Play'}" icon={playing ? 'pause' : 'play'} on=toggle:playing
    button "Next" icon=arrow-right variant=secondary on=emit:next
`,
  },
  "landing-hero": {
    label: "A landing-page hero",
    spec: `look mood=bold type=editorial density=airy
card variant=hero gap=16
  badge "New in 0.6" tone=accent
  text "Let your AI show, not tell." style=display
  text "Your model writes a few lines of SayShape and people get a real interface: themed, accessible and safe." style=lead tone=muted
  row fit=true
    button "Get started" on=emit:start
    button "See examples" variant=secondary on=emit:examples
  row
    stat label="Fewer tokens than HTML" value="4.2×" weight=light
    stat label="First paint" value="120 ms" weight=light
    stat label="Runtime dependencies" value="0" weight=light
`,
  },
};
