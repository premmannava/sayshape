/** How wide a scene is shown, for its layout and for the drawing check. */

/** Smallest share of its own width scale= takes. */
export const MIN_SCENE_SCALE = 0.1;

/**
 * How wide a scene is shown in a space `room` wide: all of it, unless maxw=
 * (screen pixels) or scale= (a share of its own width w) asks for less. Never
 * wider than the space, never under a pixel.
 */
export function shownWidth(room: number, w: number, maxw?: number, scale?: number): number {
  let shown = room;
  if (maxw !== undefined && Number.isFinite(maxw) && maxw > 0) shown = Math.min(shown, maxw);
  if (scale !== undefined && Number.isFinite(scale)) shown = Math.min(shown, w * Math.min(1, Math.max(MIN_SCENE_SCALE, scale)));
  return Math.max(1, shown);
}
