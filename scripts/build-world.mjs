// Builds the map's embedded geometry, pre-projected with Web Mercator so
// meridians stay straight and borders keep the shape people know from
// everyday maps. Run with `npm run build:world`.
import fs from "fs";
import { feature, mesh } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { topology } from "topojson-server";
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

// Lakes, rivers and cities: Natural Earth 1:50m (public domain), worldwide.
// Downloaded once into node_modules/.cache, since no npm package carries them.
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
async function naturalEarth(name) {
  const file = `node_modules/.cache/natural-earth/${name}.geojson`;
  if (!fs.existsSync(file)) {
    const res = await fetch(NE + name + ".geojson");
    if (!res.ok) throw new Error(`Couldn't download ${name}: ${res.status}`);
    fs.mkdirSync("node_modules/.cache/natural-earth", { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// One path per Natural Earth scalerank (0 = most important), so the map can
// show big lakes and rivers early and add smaller ones as it zooms in.
function byRank(geojson, keep) {
  let topo = presimplify(topology({ f: geojson }));
  topo = simplify(topo, quantile(topo, keep));
  const path = geoPath(proj).digits(1);
  const ranks = new Map();
  for (const f of feature(topo, topo.objects.f).features) {
    const d = path(f);
    if (!d) continue;
    const r = Number(f.properties.scalerank) || 0;
    ranks.set(r, (ranks.get(r) ?? "") + d);
  }
  return [...ranks].sort((a, b) => a[0] - b[0]);
}
const water = {
  lakes: byRank(await naturalEarth("ne_50m_lakes"), 0.15),
  rivers: byRank(await naturalEarth("ne_50m_rivers_lake_centerlines"), 0.15),
};
fs.writeFileSync("src/components/map/water.json", JSON.stringify(water));

// Cities as [name, x, y, scalerank], most important first, so label
// placement can take them in order and skip the ones that would collide.
const round = (v) => Math.round(v * 10) / 10;
const places = (await naturalEarth("ne_50m_populated_places_simple")).features
  .map((f) => f.properties)
  .sort((a, b) => a.scalerank - b.scalerank || b.pop_max - a.pop_max)
  .map((p) => { const [x, y] = proj([p.longitude, p.latitude]); return [p.name, round(x), round(y), p.scalerank]; })
  .filter(([, , y]) => y >= 0 && y <= H);
fs.writeFileSync("src/components/map/places.json", JSON.stringify(places));

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + " KB";
console.log(countries.length, "countries,", states.length, "states,", places.length, "places,", H, "tall;",
  "world", kb(out), "states", kb(states), "water", kb(water), "places", kb(places));
