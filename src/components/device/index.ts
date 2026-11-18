/**
 * EXPERIMENTAL, opt-in: `device`, a plain phone or laptop frame around a
 * screen of ordinary SayShape elements, for app and page mockups.
 *
 *   device "Weather app home" kind=iphone scale=0.75 status=true
 *     text "Today" style=title
 *     stat label="Phoenix" value="31°"
 *     button "See the week"
 *
 * It's off unless a host registers deviceComponents (this separate entry
 * point, `sayshape/device`, like scene): without it, "device" is an unknown
 * element, skipped with its children, and the language is what it was.
 *
 * The frame is drawn in theme colors only, with no brand's logo or hardware
 * details. The screens' logical sizes (DEVICE_SIZES) are engine constants.
 */
import type { ComponentDef } from "../../component";
import { device } from "./device";

export { device, deviceScale, type DeviceData } from "./device";
export { DEVICE_KINDS, DEVICE_SIZES, MIN_DEVICE_SCALE, type DeviceKind, type DeviceSize } from "./sizes";
export { STATUS_TIME } from "./frame";

export const deviceComponents: ComponentDef[] = [device];
