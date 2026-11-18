/**
 * SayShape's own icons: outline symbols drawn on a 24×24 grid with round
 * strokes, designed from scratch for SayShape (no icon set was copied or
 * traced). Each icon is a few drawing commands; drawIcon paints one in a
 * theme color at any size, so icons follow light and dark like everything else.
 *
 * Commands, one shape per string (coordinates on the 24×24 grid):
 *   M x y, L x y, H x, V y, C x1 y1 x2 y2 x y, Q x1 y1 x y, Z   a path (absolute)
 *   O cx cy r            a circle
 *   A cx cy r from to    an arc, angles in degrees, clockwise from three o'clock
 *   R x y w h r          a rounded rectangle
 *   D cx cy              a small filled dot
 */

/** A small cloud, raised to leave room for rain, snow or a bolt under it. */
const HIGH_CLOUD = "M7 14.5 H17.5 C19.7 14.5 21 12.9 21 11 C21 9 19.5 7.5 17.5 7.4 C16.8 5 14.6 3.2 12 3.2 C9 3.2 6.6 5.4 6.4 8.3 C4.5 8.9 3.5 10.3 3.5 11.6 C3.5 13.3 5 14.5 7 14.5 Z";

/** Five points, worked out once: outer and inner radii alternate. */
function starPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const r = i % 2 ? 4.3 : 9.3;
    pts.push(`${i ? "L" : "M"}${(12 + r * Math.cos(a)).toFixed(2)} ${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ") + " Z";
}

/** Eight teeth around a hub: each tooth is a short flat-topped bump on a round body. */
function gearPath(): string {
  const pts: string[] = [];
  const at = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  for (let i = 0; i < 8; i++) {
    const t = i * 45;
    for (const [d, r] of [[-15, 7.2], [-9, 9.6], [9, 9.6], [15, 7.2]] as const) pts.push(`${pts.length ? "L" : "M"}${at(t + d, r)}`);
  }
  return pts.join(" ") + " Z";
}

/** Short spokes around a center at the given angles (degrees, clockwise from three o'clock), from radius r1 out to r2. */
function rays(cx: number, cy: number, r1: number, r2: number, degs: readonly number[]): string[] {
  return degs.map((d) => {
    const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return `M${(cx + c * r1).toFixed(2)} ${(cy + s * r1).toFixed(2)} L${(cx + c * r2).toFixed(2)} ${(cy + s * r2).toFixed(2)}`;
  });
}

/**
 * A tilted ring round a ball: an ellipse traced in short steps, with the part
 * behind the ball left out (the near half crosses in front of it).
 */
function ringPath(cx: number, cy: number, a: number, b: number, tilt: number, ball: number): string {
  const t0 = (tilt * Math.PI) / 180;
  const out: string[] = [];
  let pen = false;
  for (let i = 0; i <= 72; i++) {
    const t = (i * 5 * Math.PI) / 180;
    const lx = a * Math.cos(t), ly = b * Math.sin(t);
    const x = cx + lx * Math.cos(t0) - ly * Math.sin(t0), y = cy + lx * Math.sin(t0) + ly * Math.cos(t0);
    const show = ly > 0 || Math.hypot(x - cx, y - cy) > ball + 1.6;
    if (show) out.push(`${pen ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`);
    pen = show;
  }
  return out.join(" ");
}

export const ICONS = {
  // Status
  check: ["M5 12.5 L10 17.5 L19 7"],
  "check-circle": ["O 12 12 9", "M8 12.5 L11 15.5 L16.5 9"],
  x: ["M6.5 6.5 L17.5 17.5", "M17.5 6.5 L6.5 17.5"],
  "x-circle": ["O 12 12 9", "M9 9 L15 15", "M15 9 L9 15"],
  warning: ["M12 3.5 L21.5 20 H2.5 Z", "M12 10 V14", "D 12 17"],
  info: ["O 12 12 9", "M12 11 V16.5", "D 12 7.8"],
  help: ["O 12 12 9", "A 12 9.6 2.8 180 405", "M13.98 11.58 L12 13 V14", "D 12 17"],
  clock: ["O 12 12 9", "M12 7 V12 L15.5 14"],
  // Direction and change
  "arrow-up": ["M12 19 V5", "M6 11 L12 5 L18 11"],
  "arrow-down": ["M12 5 V19", "M6 13 L12 19 L18 13"],
  "arrow-left": ["M19 12 H5", "M11 6 L5 12 L11 18"],
  "arrow-right": ["M5 12 H19", "M13 6 L19 12 L13 18"],
  "trend-up": ["M3 17 L9 11 L13 14.5 L20.5 7", "M15 7 H20.5 V12.5"],
  "trend-down": ["M3 7 L9 13 L13 9.5 L20.5 17", "M15 17 H20.5 V11.5"],
  plus: ["M12 5 V19", "M5 12 H19"],
  minus: ["M5 12 H19"],
  refresh: ["A 12 12 8 -60 210", "M1.8 9.2 L5.07 8 L5.7 11.4"],
  // Weather
  sun: ["O 12 12 4", ...Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    return `M${(12 + c * 7).toFixed(2)} ${(12 + s * 7).toFixed(2)} L${(12 + c * 9.5).toFixed(2)} ${(12 + s * 9.5).toFixed(2)}`;
  })],
  moon: ["M20 14.5 C18.9 14.9 17.7 15.1 16.5 15.1 C11.3 15.1 7.1 10.9 7.1 5.7 C7.1 5 7.2 4.3 7.3 3.6 C4.8 5.1 3.2 7.8 3.2 10.9 C3.2 15.9 7.3 20 12.3 20 C15.8 20 18.8 17.9 20 14.5 Z"],
  cloud: ["M7 18.5 H17.5 C20 18.5 21.5 16.5 21.5 14.5 C21.5 12.3 19.8 10.6 17.6 10.5 C16.8 7.6 14.4 5.5 11.5 5.5 C8.2 5.5 5.6 8 5.4 11.2 C3.4 11.9 2.5 13.5 2.5 15 C2.5 17 4.5 18.5 7 18.5 Z"],
  rain: [HIGH_CLOUD, "M8 17.5 L7 20.5", "M12 17.5 L11 20.5", "M16 17.5 L15 20.5"],
  snow: [HIGH_CLOUD, "D 8 18.5", "D 12 20.5", "D 16 18.5"],
  storm: [HIGH_CLOUD, "M12.5 15.5 L10 19 H13.5 L11 22"],
  wind: [
    "M3 9.5 H14 C15.9 9.5 17 8.3 17 6.8 C17 5.4 15.9 4.5 14.7 4.5 C13.6 4.5 12.8 5.2 12.6 6",
    "M3 13.5 H18.5 C20.2 13.5 21.3 14.6 21.3 16 C21.3 17.4 20.2 18.4 18.8 18.4 C17.7 18.4 16.9 17.8 16.6 16.9",
    "M3 17.5 H10",
  ],
  thermometer: ["M10 14.6 V5.5 C10 4.4 10.9 3.5 12 3.5 C13.1 3.5 14 4.4 14 5.5 V14.6", "A 12 17.6 3.6 -56 236", "M12 15.5 V9"],
  droplet: ["M12 3.5 C12 3.5 6 10 6 14.5 C6 17.8 8.7 20.5 12 20.5 C15.3 20.5 18 17.8 18 14.5 C18 10 12 3.5 12 3.5 Z"],
  // Places and travel
  pin: ["M12 21.5 C8.5 17.8 5 14 5 9.8 C5 5.9 8.1 2.8 12 2.8 C15.9 2.8 19 5.9 19 9.8 C19 14 15.5 17.8 12 21.5 Z", "O 12 9.8 2.6"],
  globe: ["O 12 12 9", "M3 12 H21", "M12 3 C9 5.5 7.8 8.6 7.8 12 C7.8 15.4 9 18.5 12 21 C15 18.5 16.2 15.4 16.2 12 C16.2 8.6 15 5.5 12 3 Z"],
  plane: ["M12 2.8 C13 2.8 13.6 3.8 13.6 5 V9.6 L21 14 V16 L13.6 13.8 V18.2 L16 20 V21.5 L12 20.4 L8 21.5 V20 L10.4 18.2 V13.8 L3 16 V14 L10.4 9.6 V5 C10.4 3.8 11 2.8 12 2.8 Z"],
  car: [
    "M5.5 16.5 H3.5 V12.8 C3.5 12 4 11.4 4.7 11.2 L6.6 6.9 C6.9 6.3 7.5 6 8.2 6 H15.8 C16.5 6 17.1 6.3 17.4 6.9 L19.3 11.2 C20 11.4 20.5 12 20.5 12.8 V16.5 H18.5",
    "M9.5 16.5 H14.5", "M4.8 11.2 H19.2", "O 7.5 16.5 2", "O 16.5 16.5 2",
  ],
  truck: ["M14 15.5 V7.5 C14 6.9 13.6 6.5 13 6.5 H3.5 C2.9 6.5 2.5 6.9 2.5 7.5 V15.5 H4.7", "M14 9.5 H17.8 L21 12.8 V15.5 H19.3", "M8.3 15.5 H15.7", "O 6.5 16.8 1.8", "O 17.5 16.8 1.8"],
  home: ["M3.5 11 L12 4 L20.5 11", "M5.5 9.5 V20 H18.5 V9.5", "M10 20 V14.5 H14 V20"],
  building: ["M5 21 V4.5 C5 3.9 5.4 3.5 6 3.5 H14 C14.6 3.5 15 3.9 15 4.5 V21", "M15 9.5 H18 C18.6 9.5 19 9.9 19 10.5 V21", "M3 21 H21", "D 8.5 7.5", "D 11.5 7.5", "D 8.5 11", "D 11.5 11", "D 8.5 14.5", "D 11.5 14.5"],
  map: ["M3.5 6.5 L9 4.5 L15 6.5 L20.5 4.5 V17.5 L15 19.5 L9 17.5 L3.5 19.5 Z", "M9 4.5 V17.5", "M15 6.5 V19.5"],
  // Business and data
  dollar: ["M16.5 7.5 C15.8 6.2 14.2 5.5 12 5.5 C9.4 5.5 7.8 6.8 7.8 8.6 C7.8 13 16.2 10.6 16.2 15.3 C16.2 17.2 14.4 18.5 12 18.5 C9.6 18.5 8 17.6 7.3 16.2", "M12 3 V5.5", "M12 18.5 V21"],
  card: ["R 3 5.5 18 13 2", "M3 10 H21", "M6.5 14.5 H10"],
  cart: ["M2.5 4 H5 L7.4 15 C7.5 15.6 8 16 8.6 16 H17.6 C18.2 16 18.7 15.6 18.8 15 L20.5 7.5 H6", "O 9 19.8 1.2", "O 17 19.8 1.2"],
  package: ["M12 3 L20 7.2 V16.8 L12 21 L4 16.8 V7.2 Z", "M4 7.2 L12 11.4 L20 7.2", "M12 11.4 V21", "M8 5.1 L16 9.3"],
  "bar-chart": ["M4 20 H20", "M7 20 V12", "M12 20 V5.5", "M17 20 V9.5"],
  "pie-chart": ["O 12 12 9", "M12 3 V12 H21"],
  percent: ["M18.5 5.5 L5.5 18.5", "O 7.5 7.5 2.3", "O 16.5 16.5 2.3"],
  tag: ["M3.5 4.5 V11.6 C3.5 12.1 3.7 12.6 4.1 13 L11.5 20.4 C12.3 21.2 13.5 21.2 14.3 20.4 L20.4 14.3 C21.2 13.5 21.2 12.3 20.4 11.5 L13 4.1 C12.6 3.7 12.1 3.5 11.6 3.5 H4.5 C3.9 3.5 3.5 3.9 3.5 4.5 Z", "O 8 8 1.3"],
  briefcase: ["R 3 7.5 18 12.5 2", "M8.5 7.5 V5.5 C8.5 4.9 8.9 4.5 9.5 4.5 H14.5 C15.1 4.5 15.5 4.9 15.5 5.5 V7.5", "M3 13 H21"],
  file: ["M14 3 H7 C6.4 3 6 3.4 6 4 V20 C6 20.6 6.4 21 7 21 H17 C17.6 21 18 20.6 18 20 V7 Z", "M14 3 V7 H18", "M9 12 H15", "M9 15.5 H15"],
  target: ["O 12 12 9", "O 12 12 5", "D 12 12"],
  bolt: ["M13 2.8 L5 13.5 H11.5 L10.5 21.2 L19 10.5 H12.5 Z"],
  idea: ["M9 17.5 V15.6 C7.2 14.4 6 12.4 6 10.2 C6 6.8 8.7 4 12 4 C15.3 4 18 6.8 18 10.2 C18 12.4 16.8 14.4 15 15.6 V17.5 Z", "M9.5 20.5 H14.5"],
  lock: ["R 5 10.5 14 10 2", "M8 10.5 V7.5 C8 5.3 9.8 3.5 12 3.5 C14.2 3.5 16 5.3 16 7.5 V10.5"],
  shield: ["M12 3 L19.5 6 V11.5 C19.5 16 16.5 19.5 12 21 C7.5 19.5 4.5 16 4.5 11.5 V6 Z"],
  key: ["O 8 16 4", "M10.8 13.2 L20 4", "M17 7 L19.5 9.5", "M14 10 L16.5 12.5"],
  wallet: ["R 3 6.5 18 13.5 2.5", "R 14 10.5 7 4.5 2", "D 17 12.75", "M5.5 6.5 L15 3.5 C15.6 3.3 16.5 3.7 16.5 4.4 V6.5"],
  bank: ["M3.5 9 L12 4 L20.5 9 Z", "M6.5 12 V17", "M12 12 V17", "M17.5 12 V17", "M4 20.5 H20"],
  receipt: ["M6 3.5 H18 V20.5 L15 18.5 L12 20.5 L9 18.5 L6 20.5 Z", "M9.5 8 H14.5", "M9.5 11.5 H14.5", "M9.5 15 H12.5"],
  // People and time
  user: ["O 12 8 4", "M4.5 20.5 C4.5 16.6 7.9 13.8 12 13.8 C16.1 13.8 19.5 16.6 19.5 20.5"],
  users: ["O 9 8.5 3.5", "M2.5 20 C2.5 16.6 5.4 14 9 14 C12.6 14 15.5 16.6 15.5 20", "M15.5 5.2 C17.2 5.6 18.3 7 18.3 8.6 C18.3 10.2 17.2 11.6 15.5 12", "M17.5 14.3 C19.8 15 21.5 17.2 21.5 20"],
  calendar: ["R 3.5 5 17 15.5 2", "M3.5 10 H20.5", "M8 3 V7", "M16 3 V7"],
  mail: ["R 3 5.5 18 13 2", "M3.5 7 L12 13 L20.5 7"],
  phone: ["R 7 2.5 10 19 2", "M10.5 18.5 H13.5"],
  chat: ["M4 5.5 C4 4.9 4.4 4.5 5 4.5 H19 C19.6 4.5 20 4.9 20 5.5 V15.5 C20 16.1 19.6 16.5 19 16.5 H9.5 L5.5 20 V16.5 H5 C4.4 16.5 4 16.1 4 15.5 Z"],
  star: [starPath()],
  sparkle: ["M10.5 6 C11 10.2 12.3 12.5 17.5 13 C12.3 13.5 11 15.8 10.5 20 C10 15.8 8.7 13.5 3.5 13 C8.7 12.5 10 10.2 10.5 6 Z", "M18.5 3 V8", "M16 5.5 H21"],
  trophy: ["M7.5 4 H16.5 V10.5 C16.5 13.3 14.5 15.5 12 15.5 C9.5 15.5 7.5 13.3 7.5 10.5 Z", "M7.5 6 H4.5 C4.5 9 5.5 10.5 7.7 11", "M16.5 6 H19.5 C19.5 9 18.5 10.5 16.3 11", "M12 15.5 V19", "M8.5 20.5 H15.5"],
  flag: ["M5.5 21 V3.5", "M5.5 4.5 C8 3.5 10 5.5 12.5 4.5 C14.5 3.7 16 3.8 18.5 4.5 V13.5 C16 12.8 14.5 12.7 12.5 13.5 C10 14.5 8 12.5 5.5 13.5"],
  heart: ["M12 20 C12 20 3.5 15 3.5 9.2 C3.5 6.4 5.6 4.5 8 4.5 C9.7 4.5 11.1 5.4 12 6.8 C12.9 5.4 14.3 4.5 16 4.5 C18.4 4.5 20.5 6.4 20.5 9.2 C20.5 15 12 20 12 20 Z"],
  // Card suits, with heart above: the same weight of line, each about as big.
  // A spade is a heart turned over, on a flared stem.
  spade: [
    "M12 3.5 C12 3.5 3.5 9.2 3.5 13.8 C3.5 16.3 5.4 18 7.7 18 C9.5 18 11.1 17 12 15.4 C12.9 17 14.5 18 16.3 18 C18.6 18 20.5 16.3 20.5 13.8 C20.5 9.2 12 3.5 12 3.5 Z",
    "M12 16.5 C11.9 18.4 11.1 19.8 9.7 20.5 H14.3 C12.9 19.8 12.1 18.4 12 16.5",
  ],
  // A club is three leaves, drawn as the outer arcs of three circles that overlap, on the same stem.
  club: ["A 12 7.5 4 153 387", "A 8.1 13.3 4 12.8 274.8", "A 15.9 13.3 4 -94.8 167.2", "M12 14.6 C11.9 17.6 11.1 19.6 9.7 20.5 H14.3 C12.9 19.6 12.1 17.6 12 14.6"],
  // A diamond's sides curve in a little, as on a card.
  diamond: ["M12 3 C13.9 6.4 16.2 9.4 19 12 C16.2 14.6 13.9 17.6 12 21 C10.1 17.6 7.8 14.6 5 12 C7.8 9.4 10.1 6.4 12 3 Z"],
  bell: ["M6 16.5 V11 C6 7.7 8.7 5 12 5 C15.3 5 18 7.7 18 11 V16.5 L19.5 18 H4.5 Z", "M10 20.5 C10.4 21.3 11.1 21.7 12 21.7 C12.9 21.7 13.6 21.3 14 20.5", "M12 3 V5"],
  // Actions
  search: ["O 10.5 10.5 6.5", "M15.2 15.2 L20.5 20.5"],
  filter: ["M3.5 5 H20.5 L14 12.5 V19 L10 21 V12.5 Z"],
  download: ["M12 3.5 V15", "M7 10.5 L12 15.5 L17 10.5", "M4 20 H20"],
  // Two sheets, the front one whole and the one behind showing only its top-left corner.
  copy: ["R 9 9 11.5 11.5 2", "M15 5.5 V5 C15 4.2 14.3 3.5 13.5 3.5 H5 C4.2 3.5 3.5 4.2 3.5 5 V13.5 C3.5 14.3 4.2 15 5 15 H5.5"],
  share: ["O 6 12 2.5", "O 17.5 6 2.5", "O 17.5 18 2.5", "M8.3 10.8 L15.2 7.2", "M8.3 13.2 L15.2 16.8"],
  link: [
    "M10 14 C11.2 15.3 13 15.4 14.3 14.2 L17.6 10.9 C18.9 9.6 18.9 7.5 17.6 6.2 C16.3 4.9 14.2 4.9 12.9 6.2 L11.9 7.2",
    "M14 10 C12.8 8.7 11 8.6 9.7 9.8 L6.4 13.1 C5.1 14.4 5.1 16.5 6.4 17.8 C7.7 19.1 9.8 19.1 11.1 17.8 L12.1 16.8",
  ],
  sliders: ["M4 7 H7", "M11 7 H20", "O 9 7 2", "M4 12 H13", "M17 12 H20", "O 15 12 2", "M4 17 H5", "M9 17 H20", "O 7 17 2"],
  settings: [gearPath(), "O 12 12 3"],
  edit: ["M4 20 L5 15.5 L15.5 5 C16.3 4.2 17.7 4.2 18.5 5 L19 5.5 C19.8 6.3 19.8 7.7 19 8.5 L8.5 19 Z", "M13.5 7 L17 10.5"],
  trash: ["M4 7 H20", "M9.5 7 V5 C9.5 4.4 9.9 4 10.5 4 H13.5 C14.1 4 14.5 4.4 14.5 5 V7", "M6 7 L7 19.5 C7 20.3 7.7 21 8.5 21 H15.5 C16.3 21 17 20.3 17 19.5 L18 7", "M10 11 V17", "M14 11 V17"],
  eye: ["M2.5 12 C5 7.5 8.3 5.5 12 5.5 C15.7 5.5 19 7.5 21.5 12 C19 16.5 15.7 18.5 12 18.5 C8.3 18.5 5 16.5 2.5 12 Z", "O 12 12 3"],
  upload: ["M12 15 V3.5", "M7 8.5 L12 3.5 L17 8.5", "M4 20 H20"],
  external: ["M18 13.5 V18 C18 19.1 17.1 20 16 20 H6 C4.9 20 4 19.1 4 18 V8 C4 6.9 4.9 6 6 6 H10.5", "M14 4 H20 V10", "M20 4 L11 13"],
  // Files and code
  folder: ["M3.5 6.5 C3.5 5.4 4.4 4.5 5.5 4.5 H9.5 C10 4.5 10.5 4.7 10.8 5.1 L12 6.5 H18.5 C19.6 6.5 20.5 7.4 20.5 8.5 V17.5 C20.5 18.6 19.6 19.5 18.5 19.5 H5.5 C4.4 19.5 3.5 18.6 3.5 17.5 Z"],
  database: ["M4.5 6.5 C4.5 5.1 7.9 4 12 4 C16.1 4 19.5 5.1 19.5 6.5 C19.5 7.9 16.1 9 12 9 C7.9 9 4.5 7.9 4.5 6.5 Z", "M4.5 6.5 V17.5 C4.5 18.9 7.9 20 12 20 C16.1 20 19.5 18.9 19.5 17.5 V6.5", "M4.5 12 C4.5 13.4 7.9 14.5 12 14.5 C16.1 14.5 19.5 13.4 19.5 12"],
  server: ["R 3.5 4 17 6.5 2", "R 3.5 13.5 17 6.5 2", "D 7.5 7.25", "D 7.5 16.75", "M12 7.25 H17", "M12 16.75 H17"],
  code: ["M8.5 7 L3.5 12 L8.5 17", "M15.5 7 L20.5 12 L15.5 17", "M13.5 5 L10.5 19"],
  // An open-ended spanner on the diagonal: a rounded handle widening into a ring with a slot at its tip.
  wrench: ["M3.1 18.7 L2.8 19.4 L2.8 20.2 L3.1 20.9 L3.8 21.2 L4.6 21.2 L5.3 20.9 L12.7 13.4 L14.3 13.9 L16 13.8 L17.6 13.2 L18.9 12 L19.6 10.5 L19.8 8.8 L19.5 7.2 L15.7 10.9 L13.1 8.3 L16.9 4.6 L15.2 4.2 L13.6 4.4 L12 5.1 L10.9 6.4 L10.2 7.9 L10.1 9.6 L10.6 11.2 Z"],
  bug: ["R 7.5 7.5 9 12.5 4.5", "O 12 5.2 2", "M12 10 V18", "M7.5 11 L4 9.5", "M7.5 14 H4", "M7.5 17 L4.5 19", "M16.5 11 L20 9.5", "M16.5 14 H20", "M16.5 17 L19.5 19"],
  // Media and reading
  play: ["M8 5.5 L18.5 12 L8 18.5 Z"],
  pause: ["M8 5.5 V18.5", "M16 5.5 V18.5"],
  image: ["R 3.5 4.5 17 15 2", "O 8.5 9.5 1.5", "M4 17.5 L9.5 12.5 L14 16.5 L16 14.8 L20 18"],
  book: ["M12 6.5 C10 5 7 4.5 4 5 V18 C7 17.5 10 18 12 19.5 C14 18 17 17.5 20 18 V5 C17 4.5 14 5 12 6.5 Z", "M12 6.5 V19.5"],
  // A note, a pair of notes on one beam.
  music: ["O 7 17.5 2.5", "O 17 15.5 2.5", "M9.5 17.5 V6 L19.5 4 V15.5", "M9.5 9.5 L19.5 7.5"],
  video: ["R 3 6.5 12.5 11 2", "M15.5 10.5 L20.5 7.5 V16.5 L15.5 13.5"],
  mic: ["R 9 3 6 11 3", "M5.5 11 C5.5 14.6 8.4 17.5 12 17.5 C15.6 17.5 18.5 14.6 18.5 11", "M12 17.5 V21", "M9 21 H15"],
  volume: ["M4 9.5 V14.5 H7.5 L12 18.5 V5.5 L7.5 9.5 Z", "A 12 12 4 -50 50", "A 12 12 7.5 -50 50"],
  "volume-off": ["M4 9.5 V14.5 H7.5 L12 18.5 V5.5 L7.5 9.5 Z", "M15 9 L21 15", "M21 9 L15 15"],
  // A clock on two feet with a bell over each shoulder.
  alarm: ["O 12 13 7.5", "M12 9.5 V13 L14.5 15", "M3.5 7 L7 3.5", "M20.5 7 L17 3.5", "M6.7 18.3 L5 20.5", "M17.3 18.3 L19 20.5"],
  // A stopwatch: a dial with a crown on top and a button to one side.
  timer: ["O 12 13.5 7.5", "M10 2.5 H14", "M12 2.5 V6", "M12 13.5 L15 10.5", "M18 7 L19.5 5.5"],
  // Devices
  laptop: ["R 4.5 5 15 11 1.5", "M2.5 19 H21.5"],
  tablet: ["R 4.5 3 15 18 2", "M10.5 18 H13.5"],
  watch: ["R 7 6.5 10 11 2.5", "M9 6.5 L9.5 3 H14.5 L15 6.5", "M9 17.5 L9.5 21 H14.5 L15 17.5", "M12 9.5 V12 L13.5 13"],
  camera: ["R 3 7 18 12.5 2", "O 12 13.2 3.5", "M8.5 7 L9.8 4.8 H14.2 L15.5 7"],
  headphones: ["A 12 12.5 8 175 365", "R 4 12.5 3.5 7 1.5", "R 16.5 12.5 3.5 7 1.5"],
  battery: ["R 2.5 7.5 17 9 2", "M21.5 10.5 V13.5", "M6.5 10.5 V13.5", "M10 10.5 V13.5"],
  // Three widening waves over a dot.
  wifi: ["D 12 17.5", "A 12 17.5 3.6 220 320", "A 12 17.5 7.3 220 320", "A 12 17.5 11 220 320"],
  tv: ["R 3 6 18 12.5 2", "M8.5 2.5 L12 6 L15.5 2.5", "M8 21 H16"],
  // Weather, more
  sunrise: ["M2.5 12.5 H21.5", "A 12 12.5 4.5 180 360", ...rays(12, 12.5, 6.5, 8.8, [225, 270, 315]), "M12 21 V16.5", "M9.8 18.7 L12 16.5 L14.2 18.7"],
  sunset: ["M2.5 12.5 H21.5", "A 12 12.5 4.5 180 360", ...rays(12, 12.5, 6.5, 8.8, [225, 270, 315]), "M12 16.5 V21", "M9.8 18.8 L12 21 L14.2 18.8"],
  // A sun showing above and behind a small cloud.
  "cloud-sun": [
    "A 9 9.5 3 100 350", ...rays(9, 9.5, 5, 6.8, [135, 180, 225, 270, 315]),
    "M10 20.5 H18 C19.9 20.5 21 19.1 21 17.5 C21 15.8 19.7 14.5 18 14.5 C17.4 12.4 15.6 11 13.5 11 C11 11 9.1 12.8 8.9 15.2 C7.4 15.6 6.5 16.7 6.5 18 C6.5 19.4 8 20.5 10 20.5 Z",
  ],
  fog: [HIGH_CLOUD, "M5 18 H19", "M8 21 H16"],
  umbrella: ["M3 12 C3 7.3 7 3.5 12 3.5 C17 3.5 21 7.3 21 12 Q18 10 15 12 Q12 10 9 12 Q6 10 3 12 Z", "M12 11 V19 C12 20.1 12.9 21 14 21 C15.1 21 16 20.1 16 19"],
  // Shops and things to buy
  // A shop front: a scalloped awning over a door.
  store: ["M3 9 L4.5 4 H19.5 L21 9 C21 10.7 19.7 12 18 12 C16.3 12 15 10.7 15 9 C15 10.7 13.7 12 12 12 C10.3 12 9 10.7 9 9 C9 10.7 7.7 12 6 12 C4.3 12 3 10.7 3 9 Z", "M5 12 V20 H19 V12", "M10 20 V15.5 H14 V20"],
  gift: [
    "R 3 7.5 18 4 1.2", "M4.5 11.5 V19.5 C4.5 20.1 4.9 20.5 5.5 20.5 H18.5 C19.1 20.5 19.5 20.1 19.5 19.5 V11.5", "M12 7.5 V20.5",
    "M12 7.5 C10.5 4 7 3.5 7 5.8 C7 7 8.5 7.5 12 7.5", "M12 7.5 C13.5 4 17 3.5 17 5.8 C17 7 15.5 7.5 12 7.5",
  ],
  // A ticket with a notch in each end and a torn-off stub.
  ticket: ["M3.5 6 H20.5 V9.5 C19.1 9.5 18 10.6 18 12 C18 13.4 19.1 14.5 20.5 14.5 V18 H3.5 V14.5 C4.9 14.5 6 13.4 6 12 C6 10.6 4.9 9.5 3.5 9.5 Z", "M14.5 8 V9", "M14.5 11.5 V12.5", "M14.5 15 V16"],
  basket: ["M3 10 H21", "M4.5 10 L6.3 18.8 C6.5 19.5 7.1 20 7.8 20 H16.2 C16.9 20 17.5 19.5 17.7 18.8 L19.5 10", "M7 10 L10 4.5", "M17 10 L14 4.5", "M9.5 13 V17", "M12 13 V17", "M14.5 13 V17"],
  // Finding your way
  menu: ["M4 7 H20", "M4 12 H20", "M4 17 H20"],
  grid: ["R 4 4 6.5 6.5 1.5", "R 13.5 4 6.5 6.5 1.5", "R 4 13.5 6.5 6.5 1.5", "R 13.5 13.5 6.5 6.5 1.5"],
  list: ["D 4.5 7", "D 4.5 12", "D 4.5 17", "M8.5 7 H19.5", "M8.5 12 H19.5", "M8.5 17 H19.5"],
  more: ["O 5.5 12 1", "O 12 12 1", "O 18.5 12 1"],
  "chevron-up": ["M6 15 L12 9 L18 15"],
  "chevron-down": ["M6 9 L12 15 L18 9"],
  "chevron-left": ["M15 6 L9 12 L15 18"],
  "chevron-right": ["M9 6 L15 12 L9 18"],
  compass: ["O 12 12 9", "M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z"],
  // The arrowhead a map shows for where you are heading.
  navigation: ["M12 3 L19.5 20 L12 16 L4.5 20 Z"],
  // A winding way from one stop to another.
  route: ["O 6 18 2.2", "O 18 6 2.2", "M8.2 18 H16 C17.7 18 19 16.7 19 15 C19 13.3 17.7 12 16 12 H8 C6.3 12 5 10.7 5 9 C5 7.3 6.3 6 8 6 H15.8"],
  bookmark: ["M6.5 4.5 C6.5 3.9 6.9 3.5 7.5 3.5 H16.5 C17.1 3.5 17.5 3.9 17.5 4.5 V20.5 L12 16.5 L6.5 20.5 Z"],
  send: ["M20.5 3.5 L3.5 10.5 L10.5 13.5 L13.5 20.5 Z", "M10.5 13.5 L20.5 3.5"],
  // Papers
  archive: ["R 3 4 18 4.5 1.5", "M4.5 8.5 V18.5 C4.5 19.6 5.4 20.5 6.5 20.5 H17.5 C18.6 20.5 19.5 19.6 19.5 18.5 V8.5", "M10 12 H14"],
  clipboard: ["M8.5 4.5 H7 C5.9 4.5 5 5.4 5 6.5 V19.5 C5 20.6 5.9 21.5 7 21.5 H17 C18.1 21.5 19 20.6 19 19.5 V6.5 C19 5.4 18.1 4.5 17 4.5 H15.5", "R 8.5 2.5 7 4 1", "M9 11 H15", "M9 15 H15"],
  // A note with its corner turned up.
  note: ["M4 5.5 C4 4.7 4.7 4 5.5 4 H18.5 C19.3 4 20 4.7 20 5.5 V14 L14 20 H5.5 C4.7 20 4 19.3 4 18.5 Z", "M14 20 V15.5 C14 14.7 14.7 14 15.5 14 H20", "M8 8.5 H16", "M8 12 H12.5"],
  // People, more
  "user-plus": ["O 9.5 8 4", "M3 20.5 C3 16.8 5.9 14 9.5 14 C13.1 14 16 16.8 16 20.5", "M19 8.5 V13.5", "M16.5 11 H21.5"],
  "id-badge": ["R 3 5 18 14 2", "O 8.5 10.5 2", "M5.5 16 C5.9 14.6 7.1 13.8 8.5 13.8 C9.9 13.8 11.1 14.6 11.5 16", "M14 10 H18", "M14 13.5 H17"],
  // Signs of activity
  activity: ["M3 12 H7 L9.5 5 L14.5 19 L17 12 H21"],
  gauge: ["A 12 14 8.5 150 390", "M12 14 L15.5 9.5", "D 12 14"],
  flame: ["M12 21 C8.1 21 5.5 18.3 5.5 14.8 C5.5 11 8.5 8.8 9.5 5.5 C10.8 6.7 11.5 8.3 11.4 10 C12.7 8.4 13.3 5.6 12.6 3 C16.4 5 18.5 9.5 18.5 14.5 C18.5 18.2 15.8 21 12 21 Z"],
  // Growing things and food
  // Two leaves on a stem in a pot.
  plant: ["M6.5 13 H17.5 L16.2 19.8 C16.1 20.4 15.6 20.8 15 20.8 H9 C8.4 20.8 7.9 20.4 7.8 19.8 Z", "M12 13 V8", "M12 9.5 C12 6.2 9.6 4.5 5.5 4.5 C5.5 7.8 7.9 9.5 12 9.5 Z", "M12 8 C12 4.7 14.4 3 18.5 3 C18.5 6.3 16.1 8 12 8 Z"],
  leaf: ["M6 18 C5 10.5 10 5 19.5 4.5 C19.5 13.5 14 18.5 6 18 Z", "M4.5 19.5 L14 10"],
  tree: ["M9 16 C6 16 4 13.8 4 11 C4 9 5.2 7.4 6.8 6.7 C7.3 4.6 9.4 3 12 3 C14.6 3 16.7 4.6 17.2 6.7 C18.8 7.4 20 9 20 11 C20 13.8 18 16 15 16 Z", "M12 21 V11", "M12 14 L9.5 11.5", "M12 12.5 L14.5 10"],
  // A ball with a tilted ring round it.
  planet: ["O 12 12 6", ringPath(12, 12, 10.2, 3.2, -24, 6)],
  // A bowl of something hot.
  bowl: ["M3.5 10 H20.5 C20.5 14.7 16.7 18.5 12 18.5 C7.3 18.5 3.5 14.7 3.5 10 Z", "M9 20.5 H15", "M10 3.5 Q11.2 5 10 6.5", "M14 3.5 Q15.2 5 14 6.5"],
  coffee: ["M4.5 9 H15.5 V15 C15.5 17.8 13.3 20 10.5 20 H9.5 C6.7 20 4.5 17.8 4.5 15 Z", "M15.5 10.5 H17 C18.4 10.5 19.5 11.6 19.5 13 C19.5 14.4 18.4 15.5 17 15.5 H15.5", "M8 3 Q9.2 4.5 8 6", "M12 3 Q13.2 4.5 12 6"],
  pizza: ["M12 21 L3.5 5.5 C8.7 3 15.3 3 20.5 5.5 Z", "M4.6 7.5 C9.3 5.5 14.7 5.5 19.4 7.5", "D 10 10.5", "D 14 10.5", "D 12 15"],
  // Around the house
  bed: ["M3 5.5 V19.5", "M3 15.5 H21", "M21 15.5 V19.5", "M11 15.5 V11 H18.5 C19.9 11 21 12.1 21 13.5 V15.5", "O 7 12.5 1.7"],
  sofa: ["M5 10.5 V7.5 C5 6.4 5.9 5.5 7 5.5 H17 C18.1 5.5 19 6.4 19 7.5 V10.5", "M3 12.5 C3 11.4 3.9 10.5 5 10.5 C6.1 10.5 7 11.4 7 12.5 V13.5 H17 V12.5 C17 11.4 17.9 10.5 19 10.5 C20.1 10.5 21 11.4 21 12.5 V17 H3 Z", "M5 17 V19", "M19 17 V19"],
  lamp: ["M8 4 H16 L19 11.5 H5 Z", "M12 11.5 V19.5", "M8 20 H16"],
  // Getting around
  bike: ["O 5.5 15.5 4", "O 18.5 15.5 4", "M5.5 15.5 H12 L9.5 8.5 Z", "M9.5 8.5 H16 L12 15.5", "M16 8.5 L18.5 15.5", "M16 8.5 L15.3 5.5 H18", "M9.5 8.5 L8.8 6", "M7.3 6 H10.3"],
  bus: ["R 4.5 3.5 15 15 2.5", "M4.5 11.5 H19.5", "M9 6.5 H15", "D 8 15", "D 16 15", "M7.5 18.5 V20.5", "M16.5 18.5 V20.5"],
  train: ["R 6 3 12 14.5 3", "M6 10 H18", "M10 6 H14", "D 9 13.8", "D 15 13.8", "M8.5 17.5 L6.5 21", "M15.5 17.5 L17.5 21"],
} satisfies Record<string, readonly string[]>;

/** An icon's own name, as it's listed. */
export type CanonicalIconName = keyof typeof ICONS;

/**
 * Other names models often write for an icon, accepted as that icon: they draw
 * it with no warning, but the guide lists only the icons' own names.
 */
export const ICON_ALIASES = {
  "plant-2": "plant", cup: "coffee", stopwatch: "timer", mute: "volume-off", headset: "headphones",
  coupon: "ticket", shop: "store", couch: "sofa", bicycle: "bike", "layout-grid": "grid", "id-card": "id-badge", dots: "more",
} as const satisfies Record<string, CanonicalIconName>;

/** A name that draws an icon: one of the icons' own names, or an alias of one. */
export type IconName = CanonicalIconName | keyof typeof ICON_ALIASES;
/** The icons' own names, without aliases: what the guide lists. */
export const ICON_NAMES = Object.keys(ICONS) as CanonicalIconName[];

export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name) || Object.hasOwn(ICON_ALIASES, name);
}

/** The icon a name draws: itself, or the icon an alias stands for. */
export function resolveIcon(name: IconName): CanonicalIconName {
  return Object.hasOwn(ICON_ALIASES, name) ? ICON_ALIASES[name as keyof typeof ICON_ALIASES] : (name as CanonicalIconName);
}

/** The icon whose name is closest to a wrong one, for a helpful warning: "tick" → check. */
export function nearestIcon(name: string): CanonicalIconName | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  const ALIASES: Record<string, CanonicalIconName> = {
    tick: "check", ok: "check", done: "check", success: "check-circle", close: "x", error: "x-circle", cancel: "x",
    alert: "warning", caution: "warning", question: "help", time: "clock", up: "arrow-up", down: "arrow-down",
    increase: "trend-up", growth: "trend-up", decrease: "trend-down", decline: "trend-down", add: "plus", remove: "minus",
    sunny: "sun", night: "moon", cloudy: "cloud", rainy: "rain", snowy: "snow", lightning: "storm", thunder: "storm",
    temperature: "thermometer", water: "droplet", location: "pin", place: "pin", world: "globe", earth: "globe",
    flight: "plane", airplane: "plane", travel: "plane", house: "home", office: "building", company: "building",
    money: "dollar", price: "dollar", payment: "card", creditcard: "card", shopping: "cart", order: "package", box: "package",
    delivery: "truck", shipping: "truck", chart: "bar-chart", graph: "bar-chart", pie: "pie-chart", label: "tag",
    work: "briefcase", job: "briefcase", document: "file", goal: "target", energy: "bolt", power: "bolt", insight: "idea",
    tip: "idea", security: "lock", person: "user", people: "users", team: "users", date: "calendar", email: "mail",
    message: "chat", favorite: "star", rating: "star", like: "heart", hearts: "heart", spades: "spade", clubs: "club", diamonds: "diamond", notification: "bell", find: "search",
    export: "download", duplicate: "copy", options: "sliders", delete: "trash", bin: "trash", pencil: "edit", view: "eye", gear: "settings", cog: "settings", storage: "database", host: "server", password: "key", invoice: "receipt", award: "trophy", ai: "sparkle", magic: "sparkle", photo: "image", picture: "image", tool: "wrench", fix: "wrench", script: "code", reload: "refresh", sync: "refresh",
    hamburger: "menu", ellipsis: "more", kebab: "more", next: "chevron-right", back: "chevron-left", expand: "chevron-down", collapse: "chevron-up",
    song: "music", audio: "music", sound: "volume", speaker: "volume", microphone: "mic", film: "video", movie: "video", television: "tv",
    computer: "laptop", smartwatch: "watch", photography: "camera", charge: "battery", wireless: "wifi", internet: "wifi",
    dawn: "sunrise", dusk: "sunset", partlycloudy: "cloud-sun", mist: "fog", haze: "fog",
    shopfront: "store", present: "gift", voucher: "ticket", groceries: "basket", direction: "compass", directions: "route",
    submit: "send", memo: "note", adduser: "user-plus", invite: "user-plus", identity: "id-badge",
    pulse: "activity", heartbeat: "activity", speed: "gauge", meter: "gauge", fire: "flame", hot: "flame",
    nature: "leaf", eco: "leaf", forest: "tree", space: "planet", saturn: "planet", soup: "bowl", food: "bowl", tea: "coffee",
    sleep: "bed", hotel: "bed", furniture: "sofa", cycling: "bike", transit: "bus", rail: "train",
  };
  if (Object.hasOwn(ALIASES, n)) return ALIASES[n]!;
  return ICON_NAMES.find((i) => i.replace(/-/g, "") === n || i.startsWith(n) || n.startsWith(i.replace(/-.*/, ""))) ?? null;
}

type Shape =
  | { k: "path"; ops: Array<[string, number[]]> }
  | { k: "circle"; cx: number; cy: number; r: number }
  | { k: "arc"; cx: number; cy: number; r: number; from: number; to: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; r: number }
  | { k: "dot"; cx: number; cy: number };

const parsed = new Map<string, Shape[]>();

function parseShape(src: string): Shape {
  const tokens = src.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const first = tokens[0] ?? "";
  const nums = (from: number) => tokens.slice(from).map(Number);
  if (first === "O") { const [cx = 0, cy = 0, r = 0] = nums(1); return { k: "circle", cx, cy, r }; }
  if (first === "A") { const [cx = 0, cy = 0, r = 0, from = 0, to = 0] = nums(1); return { k: "arc", cx, cy, r, from, to }; }
  if (first === "R") { const [x = 0, y = 0, w = 0, h = 0, r = 0] = nums(1); return { k: "rect", x, y, w, h, r }; }
  if (first === "D") { const [cx = 0, cy = 0] = nums(1); return { k: "dot", cx, cy }; }
  const ops: Array<[string, number[]]> = [];
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) ops.push([t, []]);
    else ops[ops.length - 1]?.[1].push(Number(t));
  }
  return { k: "path", ops };
}

function shapesOf(name: IconName): Shape[] {
  const own = resolveIcon(name);
  let s = parsed.get(own);
  if (!s) parsed.set(own, (s = ICONS[own].map(parseShape)));
  return s;
}

function tracePath(g: CanvasRenderingContext2D, ops: Array<[string, number[]]>): void {
  let x = 0, y = 0;
  g.beginPath();
  for (const [c, a] of ops) {
    if (c === "M") { [x = x, y = y] = a; g.moveTo(x, y); }
    else if (c === "L") { [x = x, y = y] = a; g.lineTo(x, y); }
    else if (c === "H") { x = a[0] ?? x; g.lineTo(x, y); }
    else if (c === "V") { y = a[0] ?? y; g.lineTo(x, y); }
    else if (c === "C") { const [a1 = 0, b1 = 0, a2 = 0, b2 = 0, x3 = 0, y3 = 0] = a; g.bezierCurveTo(a1, b1, a2, b2, x3, y3); x = x3; y = y3; }
    else if (c === "Q") { const [a1 = 0, b1 = 0, x3 = 0, y3 = 0] = a; g.quadraticCurveTo(a1, b1, x3, y3); x = x3; y = y3; }
    else if (c === "Z") g.closePath();
  }
}

/**
 * Draw an icon with its top-left at (x, y), `size` pixels square, in `color`
 * (a theme color). The stroke stays about 2px at any size, so large icons
 * stay light and small ones stay crisp.
 */
export function drawIcon(g: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string): void {
  const s = size / 24;
  const stroke = Math.min(2, Math.max(1.5, size / 12));
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineWidth = stroke / s;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = color;
  g.fillStyle = color;
  for (const sh of shapesOf(name)) {
    if (sh.k === "path") { tracePath(g, sh.ops); g.stroke(); }
    else if (sh.k === "circle") { g.beginPath(); g.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2); g.stroke(); }
    else if (sh.k === "arc") { g.beginPath(); g.arc(sh.cx, sh.cy, sh.r, (sh.from * Math.PI) / 180, (sh.to * Math.PI) / 180); g.stroke(); }
    else if (sh.k === "rect") {
      const { x: rx, y: ry, w, h, r } = sh;
      g.beginPath();
      g.moveTo(rx + r, ry);
      g.arcTo(rx + w, ry, rx + w, ry + h, r);
      g.arcTo(rx + w, ry + h, rx, ry + h, r);
      g.arcTo(rx, ry + h, rx, ry, r);
      g.arcTo(rx, ry, rx + w, ry, r);
      g.closePath();
      g.stroke();
    } else { g.beginPath(); g.arc(sh.cx, sh.cy, Math.max(1.1, (stroke / s) * 0.6), 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}
