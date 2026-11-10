/**
 * The map as one classic script, built into dist/sayshape-map.global.js. Load
 * it after dist/sayshape.global.js; it defines the global `sayshapeMap`:
 *
 *   new sayshape.SayShape(canvas, { components: [...sayshape.coreComponents, ...sayshapeMap.mapComponents] });
 */
export { mapComponents } from "./index";
