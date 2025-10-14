// geocode_lakes.mjs
// Usage: node geocode_lakes.mjs Fish_Stocking_Data.geojson
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// --- Config ---
const ONTARIO_BBOX = [-95.16, 41.68, -74.34, 56.86]; // lonW,latS,lonE,latN (same as your app)
const SLEEP_MS = 1100; // ~1 req/sec
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "OntarioTrails-Geocoder/1.0 (REPLACE_WITH_YOUR_EMAIL@example.com)";
const ACCEPT_LANG = "en"; // change to "en-CA,fr-CA" if you want bilingual names

// Prefer these classes/types from Nominatim for lakes
const PREFERRED = new Set([
  "natural:water",
  "natural:lake",
  "water:lake",
  "water:reservoir",
  "waterway:riverbank",
  "place:sea", // sometimes large waterbodies
  "boundary:protected_area" // rare but sometimes tagged water polygons
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Robust property picker (handles case/space/underscore differences)
function pickProp(obj, candidates) {
  if (!obj) return null;
  // fast path exact
  for (const key of candidates) {
    const v = obj[key];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  const entries = Object.entries(obj);
  const norm = s => String(s).replace(/[\s_]/g, "").toLowerCase();
  for (const name of candidates) {
    const target = norm(name);
    const hit = entries.find(([k, v]) => v != null && norm(k) === target && String(v).trim() !== "");
    if (hit) return String(hit[1]).trim();
  }
  return null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371000; // m
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function scoreCandidate(c, original) {
  // Prefer lake/water classes/types
  const key = `${c.class}:${c.type}`;
  let score = PREFERRED.has(key) ? 2 : 0;
  // If we have an original point, reward proximity
  if (original) {
    const d = haversine(original.lat, original.lon, parseFloat(c.lat), parseFloat(c.lon));
    // <500 m: strong, <2 km: moderate
    if (d < 500) score += 2;
    else if (d < 2000) score += 1;
    c._distance_m = Math.round(d);
  }
  return score;
}

async function geocodeWaterbody(name, hint) {
  const q = `${name}, Ontario, Canada`;
  const params = new URLSearchParams({
    format: "jsonv2",
    q,
    countrycodes: "ca",
    viewbox: `${ONTARIO_BBOX[0]},${ONTARIO_BBOX[3]},${ONTARIO_BBOX[2]},${ONTARIO_BBOX[1]}`, // W,N,E,S
    bounded: "1",
    addressdetails: "0",
    limit: "8",
    dedupe: "1",
    extratags: "1",
    polygon_geojson: "0"
  });

  const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": ACCEPT_LANG
    }
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const arr = await res.json();

  if (!Array.isArray(arr) || arr.length === 0) return null;

  // Prefer lake/water; then score by proximity if we have original coords
  const withScores = arr.map(c => {
    const s = {
      class: c.class, type: c.type,
      display_name: c.display_name,
      lat: parseFloat(c.lat), lon: parseFloat(c.lon),
      osm_id: c.osm_id, osm_type: c.osm_type
    };
    s._score = scoreCandidate(c, hint);
    s._key = `${c.class}:${c.type}`;
    return s;
  });

  withScores.sort((a, b) => b._score - a._score);
  return withScores[0];
}

async function main() {
  const input = process.argv[2] || "Fish_Stocking_Data.geojson";
  const raw = await fs.readFile(input, "utf8");
  const gj = JSON.parse(raw);
  if (gj.type !== "FeatureCollection") throw new Error("Expected a FeatureCollection");

  const out = structuredClone(gj);
  const report = [];
  let ok = 0, miss = 0;

  for (let i = 0; i < gj.features.length; i++) {
    const f = gj.features[i];
    const p = f.properties || {};
    const name =
      pickProp(p, [
        "OFFICIAL_WATERBODY_NAME",
        "Official Waterbody Name",
        "Official_Waterbody_Name",
        "OFFICIAL WATERBODY NAME",
        "official_waterbody_name"
      ]) ||
      pickProp(p, ["WATERBODY", "LAKE_NAME", "LAKE", "WATER_BODY"]);

    const origLon = f.geometry?.coordinates?.[0];
    const origLat = f.geometry?.coordinates?.[1];
    const orig = (typeof origLat === "number" && typeof origLon === "number")
      ? { lat: origLat, lon: origLon }
      : null;

    let best = null;
    if (name) {
      try {
        best = await geocodeWaterbody(name, orig);
      } catch (e) {
        console.error(`Geocode error for "${name}":`, e.message);
      }
      await sleep(SLEEP_MS);
    }

    if (best) {
      ok++;
      // Update geometry to geocoded point (keeping it as Point)
      out.features[i].geometry = {
        type: "Point",
        coordinates: [best.lon, best.lat]
      };
      // Stamp metadata (non-destructive)
      out.features[i].properties = {
        ...p,
        _geocode_source: "nominatim",
        _geocode_display_name: best.display_name,
        _geocode_class_type: best._key,
        _geocode_osm: `${best.osm_type}/${best.osm_id}`,
        _geocode_confidence: best._score,
        _geocode_distance_m: best._distance_m ?? null,
        _orig_lon: orig?.lon ?? null,
        _orig_lat: orig?.lat ?? null
      };
      report.push({
        name,
        status: "OK",
        lat: best.lat,
        lon: best.lon,
        class_type: best._key,
        distance_m: best._distance_m ?? "",
        osm: `${best.osm_type}/${best.osm_id}`
      });
    } else {
      miss++;
      // Keep original geometry; mark miss
      out.features[i].properties = {
        ...p,
        _geocode_source: "nominatim",
        _geocode_confidence: 0,
        _geocode_note: "no_match",
        _orig_lon: orig?.lon ?? null,
        _orig_lat: orig?.lat ?? null
      };
      report.push({ name: name ?? "(no name)", status: "NO_MATCH" });
    }

    if ((i + 1) % 25 === 0) {
      console.log(`Processed ${i + 1}/${gj.features.length}…`);
    }
  }

  const outName = path.join(path.dirname(input), path.basename(input).replace(/\.geojson$/i, "_geocoded.geojson"));
  await fs.writeFile(outName, JSON.stringify(out));
  console.log(`\nWrote: ${outName}`);

  // CSV report
  const csv = [
    "name,status,lat,lon,class_type,distance_m,osm",
    ...report.map(r =>
      [r.name, r.status, r.lat ?? "", r.lon ?? "", r.class_type ?? "", r.distance_m ?? "", r.osm ?? ""]
        .map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")
    )
  ].join("\n");
  const repName = outName.replace(/\.geojson$/i, "_report.csv");
  await fs.writeFile(repName, csv);
  console.log(`Wrote: ${repName}`);
  console.log(`Summary: matched=${ok}, no_match=${miss}`);
}

await main().catch(e => {
  console.error(e);
  process.exit(1);
});
