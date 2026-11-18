/**
 * The devices a `device` frame can be, at their standard logical sizes. These
 * are fixed engine constants, like a slide's DESIGN_W: a screen of the real
 * size is what makes an app mockup read true, and the spec only picks a kind.
 * Spacing, type, radii and colors inside the screen still come from the theme.
 */
export const DEVICE_KINDS = ["iphone", "android", "laptop"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** The smallest share of its real size a device is drawn at. */
export const MIN_DEVICE_SCALE = 0.1;

/** A device's screen and frame, in device pixels. */
export interface DeviceSize {
  kind: DeviceKind;
  phone: boolean;
  screenW: number;
  screenH: number;
  /** The frame around the screen, on every side (a laptop's lid). */
  bezel: number;
  /** How far in from the frame's left the lid starts: a laptop's base is wider than its lid. */
  lidX: number;
  frameW: number;
  frameH: number;
  /** A laptop's base under the lid; 0 for phones. */
  baseH: number;
  /** The status bar's height, and how far in from the screen's sides its time and icons sit. */
  statusH: number;
  statusPad: number;
  /** What the content keeps clear of at the top without a status bar (a phone's camera), and at the bottom (a phone's home bar). */
  top: number;
  bottom: number;
}

const phone = (kind: DeviceKind, screenW: number, screenH: number, statusH: number, top: number, bottom: number): DeviceSize => {
  const bezel = 12;
  return { kind, phone: true, screenW, screenH, bezel, lidX: 0, frameW: screenW + bezel * 2, frameH: screenH + bezel * 2, baseH: 0, statusH, statusPad: 28, top, bottom };
};

const laptop = (): DeviceSize => {
  const screenW = 1440, screenH = 900, bezel = 24, baseH = 28;
  const lidW = screenW + bezel * 2;
  // The base sticks out past the lid on both sides.
  const frameW = Math.round(lidW * 1.12);
  return { kind: "laptop", phone: false, screenW, screenH, bezel, lidX: (frameW - lidW) / 2, frameW, frameH: screenH + bezel * 2 + baseH, baseH, statusH: 28, statusPad: 16, top: 0, bottom: 0 };
};

export const DEVICE_SIZES: Readonly<Record<DeviceKind, DeviceSize>> = {
  iphone: phone("iphone", 393, 852, 54, 54, 34),
  android: phone("android", 412, 915, 40, 40, 24),
  laptop: laptop(),
};
