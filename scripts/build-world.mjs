// Builds the map's embedded geometry, pre-projected with Web Mercator so
// meridians stay straight and borders keep the shape people know from
// everyday maps. Run with `npm run build:world`.
import fs from "fs";
import { feature, mesh } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { geoMercator, geoPath } from "d3-geo";

const W = 1000;
// Mercator can't show the poles, so the map runs from 75°N to 56°S
// (Cape Horn). Antarctica is left out, as before.
const NORTH = 75, SOUTH = -56;

const proj = geoMercator().scale(W / (2 * Math.PI)).translate([W / 2, 0]);
proj.translate([W / 2, -proj([0, NORTH])[1]]);
const H = Math.ceil(proj([0, SOUTH])[1]);

function simplified(file, keep) {
  const topo = presimplify(JSON.parse(fs.readFileSync(file, "utf8")));
  return simplify(topo, quantile(topo, keep));
}

// Countries: Natural Earth 1:50m (public domain), lightly simplified, one
// decimal so coastlines stay smooth when zoomed in to a region.
const world = simplified("node_modules/world-atlas/countries-50m.json", 0.2);
const countryPath = geoPath(proj).digits(1);
const countries = feature(world, world.objects.countries).features
  .filter((f) => f.properties.name !== "Antarctica")
  .map((f) => [f.properties.name, countryPath(f) || ""])
  .filter((c) => c[1]);
const out = { w: W, h: H, k: proj.scale(), t: proj.translate(), c: countries };
fs.writeFileSync("src/components/map/world.json", JSON.stringify(out));

// US state borders: US Census via us-atlas (public domain). Only borders
// shared between two states are kept, so coastlines and the national border
// come from the country layer alone and never draw twice.
const us = simplified("node_modules/us-atlas/states-10m.json", 0.4);
const statePath = geoPath(proj).digits(2);
// The 50 states and DC (FIPS codes below 60); territories have no shared land borders.
const states = us.objects.states.geometries.filter((g) => Number(g.id) < 60).map((g) => [
  g.properties.name,
  statePath(mesh(us, us.objects.states, (a, b) => a !== b && a === g)) || "",
]).sort((a, b) => a[0].localeCompare(b[0]));
fs.writeFileSync("src/components/map/states.json", JSON.stringify({
  source: "US Census state boundaries, public domain, via https://github.com/topojson/us-atlas",
  states,
}));

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + " KB";
console.log(countries.length, "countries,", states.length, "states,", H, "tall;", "world", kb(out), "states", kb(states));
