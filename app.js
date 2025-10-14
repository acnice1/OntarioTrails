// ==============================
// Ontario Trails — app.js (clean)
// ==============================

// --- Map & Basemap -----------------------------------------------------------
const map = L.map('map', { zoomControl: false }).setView([45.4215, -75.6972], 11);

// Move the zoom control to the upper right
L.control.zoom({ position: 'topright' }).addTo(map);

// OpenStreetMap Standard tiles
const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// --- Base-map search (addresses/places) via Leaflet Control Geocoder --------
// --- restricted to Ontario + Quebec -------------------------
// --- Base-map search strictly limited to Ontario + Quebec --------------------
if (window.L?.Control?.Geocoder) {
  // Ontario + Quebec (loose but covering the provinces)
  const ON_QC_BOUNDS = L.latLngBounds([41.6, -95.0], [62.0, -57.0]);
  const ALLOWED_STATES = new Set(['Ontario', 'Québec', 'Quebec']);

  // Base Nominatim geocoder with server-side hints
  const nom = L.Control.Geocoder.nominatim({
    geocodingQueryParams: {
      countrycodes: 'ca',                          // Canada only
      viewbox: [ON_QC_BOUNDS.getWest(), ON_QC_BOUNDS.getSouth(),
                ON_QC_BOUNDS.getEast(), ON_QC_BOUNDS.getNorth()].join(','),
      bounded: 1                                   // prefer inside viewbox
    }
  });

  // Wrapper that filters client-side for extra strictness
  const constrained = {
    geocode: function (query, cb, context) {
      nom.geocode(query, function (results) {
        const filtered = results.filter(r => {
          const inBox = ON_QC_BOUNDS.contains(r.center);
          const addr  = r.properties?.address || {};
          const inCA  = (addr.country_code || '').toLowerCase() === 'ca';
          const inPQ  = ALLOWED_STATES.has(addr.state || addr.province || '');
          return inBox && inCA && inPQ;
        });
        cb.call(context, filtered);
      });
    },
    reverse: function () {
      // pass-through
      return nom.reverse.apply(nom, arguments);
    }
  };

  const geocoder = L.Control.geocoder({
    geocoder: constrained,
    defaultMarkGeocode: false,
    placeholder: 'Search Ontario / Quebec…'
  })
  .on('markgeocode', (e) => {
    // Fit to feature bounds if available; otherwise center on point
    const g = e.geocode;
    if (g && g.bbox)       map.fitBounds(g.bbox, { maxZoom: 15 });
    else if (g?.center)    map.setView(g.center, 15);
    // Drop a marker for context
    if (g?.center) L.marker(g.center).addTo(map).bindPopup(g.name || 'Location').openPopup();
  })
  .addTo(map);
} else {
  console.warn('Leaflet Control Geocoder not found. Check CDN script tag.');
}



// --- Panel wiring ------------------------------------------------------------
const panel    = document.getElementById('controlPanel');
const toggle   = document.getElementById('controlToggle');
const closeBtn = document.getElementById('closePanelBtn');

// New controls
const showCrosshair = document.getElementById('showCrosshair');
const showStocked   = document.getElementById('showStocked');
const crosshairEl   = document.getElementById('crosshair');

// Crosshair visibility (center reticle)
function updateCrosshair() {
  if (!crosshairEl || !showCrosshair) return;
  crosshairEl.style.display = showCrosshair.checked ? 'block' : 'none';
}
updateCrosshair();
showCrosshair?.addEventListener('change', updateCrosshair);


function openPanel() {
  if (!panel || !toggle) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  toggle.setAttribute('aria-expanded', 'true');
}
function closePanel() {
  if (!panel || !toggle) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  toggle.setAttribute('aria-expanded', 'false');
}
toggle?.addEventListener('click', () =>
  panel?.classList.contains('open') ? closePanel() : openPanel()
);
closeBtn?.addEventListener('click', closePanel);

// --- Layer toggles -----------------------------------------------------------
const showBase   = document.getElementById('showBase');
const showTrails = document.getElementById('showTrails');
const showPinsCk = document.getElementById('showPins');

showBase?.addEventListener('change', () => {
  showBase.checked ? base.addTo(map) : map.removeLayer(base);
});

// --- Trails (OTN.geojson) ----------------------------------------------------
const trailsStyle = { color: '#1472ff', weight: 3, opacity: 0.9 };
const trailsLayer = L.geoJSON(null, { style: trailsStyle });

fetch('./OTN.geojson')
  .then(r => r.json())
  .then(geo => {
    trailsLayer.addData(geo);
    if (showTrails?.checked) trailsLayer.addTo(map);
  })
  .catch(err => console.warn('Failed to load OTN.geojson:', err));

showTrails?.addEventListener('change', () => {
  showTrails.checked ? trailsLayer.addTo(map) : map.removeLayer(trailsLayer);
});

// --- Stocked Lakes (Fish_Stocking_Data.geojson) ------------------------------
// Styling remains simple + readable on all basemaps
const stockedStyle = { radius: 5, color: '#0a7', fillColor: 'rgba(170, 0, 68, 1)', fillOpacity: 0.9 };

/** Utility: pretty-print keys and values for a popup */
function titleCaseKey(k) {
  return String(k)
    .replace(/_/g, ' ')
    .replace(/\b([a-z])/g, s => s.toUpperCase());
}
function formatVal(v) {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  // Try ISO date detection (YYYY-MM-DD or full ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(+d)) return d.toLocaleDateString();
  }
  return String(v);
}

/** Build a rich popup from whatever fields exist */
function stockedPopupContent(props) {
  const p = props || {};
  // Try some common field names for a concise header block
  //const waterbody = p.WATERBODY || p.LAKE_NAME || p.LAKE || p.WATER_BODY || 'Stocked Lake';
  const waterbody = p.OFFICIAL_WATERBODY_NAME || p.WATERBODY || p.LAKE_NAME || p.LAKE || p.WATER_BODY || 'Stocked Lake';
  const species   = p.SPECIES   || p.SPECIES_NAME || p.FISH_SPECIES || null;
  const year      = p.YEAR      || p.STOCK_YEAR   || null;
  const qty       = p.QUANTITY  || p.QTY          || p.NUM_STOCKED  || null;

  // Header
  let html = `<div style="min-width:220px">
    <div style="font-weight:700;margin-bottom:6px">${waterbody}</div>`;

  // Quick facts row (only shows if present)
  const quick = [];
  if (species) quick.push(`<div><b>Species:</b> ${formatVal(species)}</div>`);
  if (year)    quick.push(`<div><b>Year:</b> ${formatVal(year)}</div>`);
  if (qty)     quick.push(`<div><b>Quantity:</b> ${formatVal(qty)}</div>`);
  if (quick.length) {
    html += `<div style="margin-bottom:8px">${quick.join('')}</div>`;
  }

  // Full property table (generic fallback so we never miss fields)
  const rows = Object.keys(p).sort().map(k => {
    // Skip obviously duplicate fields we already surfaced
    if (['WATERBODY','LAKE_NAME','LAKE','WATER_BODY','SPECIES','SPECIES_NAME','FISH_SPECIES','YEAR','STOCK_YEAR','QUANTITY','QTY','NUM_STOCKED'].includes(k)) return '';
    return `<tr><td style="padding:2px 6px 2px 0;white-space:nowrap;color:#335075">${titleCaseKey(k)}</td><td style="padding:2px 0">${formatVal(p[k])}</td></tr>`;
  }).join('');
  if (rows.trim()) {
    html += `<div style="max-height:180px;overflow:auto;border-top:1px solid #e8edf3;padding-top:6px">
      <table style="font-size:12px;border-collapse:collapse">${rows}</table>
    </div>`;
  }
  html += `</div>`;
  return html;
}

/* ========= On-click geocode & highlight (Ontario-bounded) ========= */

// Ontario bbox (W,S,E,N)
const ONTARIO_BBOX = [-95.16, 41.68, -74.34, 56.86];

// Convert to Nominatim viewbox string (left,top,right,bottom)
function nomViewboxFrom(bbox) {
  const [W, S, E, N] = bbox;
  return `${W},${N},${E},${S}`;
}
const NOM_VIEWBOX = nomViewboxFrom(ONTARIO_BBOX);

// Simple in-memory cache: name -> candidate (or null)
const geocodeCache = new Map();
const normKey = s => String(s || '').trim().toLowerCase();

// Prefer water features, add small proximity bonus to the clicked dot
function scoreCandidate(c, hintLL) {
  const key = `${c.class}:${c.type}`;
  let score = 0;
  if (key === 'natural:water' || key === 'natural:lake' || key === 'water:lake' ||
      key === 'water:reservoir' || key === 'waterway:riverbank') score += 3;
  const dn = (c.display_name || '').toLowerCase();
  if (dn.includes('lake') || dn.includes('lac')) score += 1;
  if (hintLL) {
    // very rough meters from lat/lng delta (good enough for tie-break)
    const d = Math.hypot(hintLL.lat - parseFloat(c.lat), hintLL.lng - parseFloat(c.lon)) * 111000;
    if (d < 500) score += 3;
    else if (d < 2000) score += 1;
  }
  return score;
}

async function geocodeLake(name, hintLL) {
  const k = normKey(name);
  if (geocodeCache.has(k)) return geocodeCache.get(k);

  const q = `${name}, Ontario, Canada`;
  const params = new URLSearchParams({
    format: 'jsonv2',
    q,
    countrycodes: 'ca',
    viewbox: NOM_VIEWBOX,
    bounded: '1',
    addressdetails: '0',
    polygon_geojson: '1',
    dedupe: '1',
    limit: '8'
  });

  let arr = [];
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'en-CA' },
      referrerPolicy: 'no-referrer-when-downgrade'
      // (Optional) include 'email' param in URL if you want to be explicit for policy
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    arr = await res.json();
  } catch (e) {
    console.warn('Geocode error:', e);
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    geocodeCache.set(k, null);
    return null;
  }

  const best = arr.map(c => ({
    class: c.class,
    type: c.type,
    lat: parseFloat(c.lat),
    lng: parseFloat(c.lon),
    display_name: c.display_name,
    geojson: c.geojson || null,
    _score: scoreCandidate(c, hintLL || null)
  })).sort((a, b) => b._score - a._score)[0];

  geocodeCache.set(k, best || null);
  return best || null;
}

// A small overlay for the highlight geometry
const geocodeHighlight = L.featureGroup().addTo(map);

function pulseLayer(layer, ms = 2000) {
  const t0 = Date.now();
  let on = false;
  const base = (layer.setStyle ? { ...layer.options } : null);
  const iv = setInterval(() => {
    const t = Date.now() - t0;
    if (t > ms) {
      clearInterval(iv);
      if (base && layer.setStyle) layer.setStyle(base);
      return;
    }
    on = !on;
    if (layer.setStyle) {
      layer.setStyle(on ? { opacity: 1, weight: 5, color: '#00c7a9' }
                        : { opacity: 0.5, weight: 3, color: '#00c7a9' });
    } else if (layer.setRadius) {
      layer.setRadius(on ? 9 : 6);
    }
  }, 220);
}

function showGeocodeHighlight(candidate) {
  geocodeHighlight.clearLayers();
  let hl;
  if (candidate?.geojson && (candidate.geojson.type === 'Polygon' || candidate.geojson.type === 'MultiPolygon')) {
    hl = L.geoJSON(candidate.geojson, { style: { color: '#00c7a9', weight: 3, fill: false, opacity: 0.8 } }).addTo(geocodeHighlight);
    try { map.fitBounds(hl.getBounds(), { padding: [24, 24], maxZoom: 15 }); } catch (_) {}
  } else if (Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng)) {
    hl = L.circleMarker([candidate.lat, candidate.lng], { radius: 8, color: '#00c7a9', fillColor: '#00c7a9', fillOpacity: 0.7 }).addTo(geocodeHighlight);
    map.setView([candidate.lat, candidate.lng], Math.max(map.getZoom(), 14));
  }
  if (hl) pulseLayer(hl);
}

// Helper for robust waterbody name picking inside the feature
function pickProp(obj, candidates) {
  if (!obj) return null;
  // Exact
  for (const name of candidates) {
    const v = obj[name];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  // Case-insensitive & space/underscore-insensitive
  const entries = Object.entries(obj);
  const norm = s => String(s).replace(/[\s_]/g, '').toLowerCase();
  for (const name of candidates) {
    const target = norm(name);
    const hit = entries.find(([k, v]) => v != null && String(v).trim() !== '' && norm(k) === target);
    if (hit) return String(hit[1]).trim();
  }
  return null;
}

/* ========= end geocode helpers ========= */

const stockedLayer = L.geoJSON(null, {
  pointToLayer: (feat, latlng) => L.circleMarker(latlng, stockedStyle),

  onEachFeature: (feat, layer) => {
    const p = feat.properties || {};

    // Preferred -> fallbacks
    const waterbody =
      pickProp(p, [
        'Official_Waterbody_Name',
        'OFFICIAL_WATERBODY_NAME',
        'Unoffcial_Waterbody_Name'
      ]) ||
      pickProp(p, ['WATERBODY', 'LAKE_NAME', 'LAKE', 'WATER_BODY']) ||
      'Unknown waterbody';

    const species = pickProp(p, ['SPECIES', 'SPECIES_NAME', 'FISH_SPECIES']) || '—';
    const year    = pickProp(p, ['YEAR', 'STOCK_YEAR']) || '—';
    const qty     = pickProp(p, ['QUANTITY', 'QTY', 'NUM_STOCKED']) || '—';

    // Tooltip: Official Waterbody Name (robust)
    layer.bindTooltip(waterbody, { direction: 'top', offset: [0, -6] });

    // Popup: header + quick facts + full table of remaining props
    const lat = feat.geometry?.coordinates?.[1]?.toFixed(5);
    const lng = feat.geometry?.coordinates?.[0]?.toFixed(5);

    let html = `
      <div style="min-width:220px">
        <div style="font-weight:700;margin-bottom:6px">${waterbody}</div>
        <div><b>Species:</b> ${species}</div>
        <div><b>Year:</b> ${year}</div>
        <div><b>Quantity:</b> ${qty}</div>`;

    if (lat && lng) {
      html += `<div style="margin-top:6px"><b>Location:</b> ${lat}, ${lng}</div>`;
    }

    const skip = new Set([
      'Official_Waterbody_Name', 'OFFICIAL_WATERBODY_NAME', 'Unoffcial_Waterbody_Name',
      'WATERBODY','LAKE_NAME','LAKE','WATER_BODY',
      'SPECIES','SPECIES_NAME','FISH_SPECIES','YEAR','STOCK_YEAR','QUANTITY','QTY','NUM_STOCKED'
    ]);
    const rows = Object.keys(p)
      .filter(k => !skip.has(k))
      .sort((a,b) => a.localeCompare(b))
      .map(k => {
        const v = p[k]; const val = (v == null || String(v).trim() === '') ? '—' : String(v);
        return `<tr>
          <td style="padding:2px 6px 2px 0;color:#335075;white-space:nowrap">${k.replace(/_/g,' ')}</td>
          <td style="padding:2px 0">${val}</td>
        </tr>`;
      })
      .join('');

    if (rows) {
      html += `<div style="margin-top:8px;max-height:160px;overflow:auto;border-top:1px solid #e8edf3;padding-top:6px">
        <table style="font-size:12px;border-collapse:collapse">${rows}</table>
      </div>`;
    }

    html += `</div>`;

    layer.bindPopup(html);

    // NEW: On click → geocode by name, cache, highlight polygon/point, zoom + pulse
    layer.on('click', async () => {
      const ll = layer.getLatLng ? layer.getLatLng() : null;
      const cand = await geocodeLake(waterbody, ll);
      if (!cand) {
        console.warn('No geocode match for', waterbody);
        return;
      }
      showGeocodeHighlight(cand);
    });
  }
});

// lazy-load once when the user enables the layer (or if pre-checked)
let stockedLoaded = false;
async function ensureStockedLoaded() {
  if (stockedLoaded) return;
  try {
    const r = await fetch('./Fish_Stocking_Data.geojson');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const gj = await r.json();
    stockedLayer.addData(gj);
    stockedLoaded = true;
  } catch (e) {
    console.warn('Failed to load Fish_Stocking_Data.geojson:', e);
  }
}

async function toggleStocked() {
  if (!showStocked) return;
  if (showStocked.checked) {
    await ensureStockedLoaded();
    stockedLayer.addTo(map);
  } else {
    map.removeLayer(stockedLayer);
  }
}
showStocked?.addEventListener('change', toggleStocked);
toggleStocked();



// --- Pins --------------------------------------------------------------------
const pinsLayer       = L.layerGroup().addTo(map);
const pinType         = document.getElementById('pinType');
const pinLabel        = document.getElementById('pinLabel');
const addPinBtn       = document.getElementById('addPinBtn');
const importPinsInput = document.getElementById('importPinsInput');
const exportPinsBtn   = document.getElementById('exportPinsBtn');
const pinCount        = document.getElementById('pinCount');

let pins = [];

function refreshPins() {
  pinsLayer.clearLayers();
  pins.forEach(p => {
    const m = L.marker([p.lat, p.lng], { title: p.label || p.type });
    m.bindTooltip(p.label || p.type);
    m.addTo(pinsLayer);
  });
  if (pinCount) pinCount.textContent = pins.length ? `${pins.length} pin(s)` : '';
}

addPinBtn?.addEventListener('click', () => {
  const c = map.getCenter();
  pins.push({
    type:  pinType?.value || 'Other',
    label: (pinLabel?.value || '').trim(),
    lat:   c.lat,
    lng:   c.lng
  });
  refreshPins();
});

exportPinsBtn?.addEventListener('click', () => {
  if (!pins.length) return;
  const gpx = pinsToGPX(pins);
  downloadText('pins.gpx', gpx, 'application/gpx+xml');
});

importPinsInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text();
  let parsed = [];
  if (file.name.toLowerCase().endsWith('.gpx')) {
    parsed = parseGPXWaypoints(text);
  } else {
    try {
      const gj = JSON.parse(text);
      parsed = gj.features?.map(f => ({
        type:  f.properties?.type || 'Other',
        label: f.properties?.name || '',
        lat:   f.geometry.coordinates[1],
        lng:   f.geometry.coordinates[0]
      })) || [];
    } catch { /* ignore bad JSON */ }
  }
  pins.push(...parsed);
  refreshPins();
  e.target.value = '';
});

showPinsCk?.addEventListener('change', () => {
  showPinsCk.checked ? pinsLayer.addTo(map) : map.removeLayer(pinsLayer);
});

// --- Locate / Follow / Reset -------------------------------------------------
const locateBtn    = document.getElementById('locateBtn');
const followBtn    = document.getElementById('followBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

let watching = false;
let watchId  = null;
let follow   = false;
let you      = null;

function ensureMarker() {
  if (!you) you = L.circleMarker([0,0], { radius: 6, color: '#ff00a8' }).addTo(map);
  return you;
}

function startLocate() {
  if (watching) return;
  if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
  watching = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      ensureMarker().setLatLng([latitude, longitude]);
      if (follow) map.setView([latitude, longitude]);
    },
    (err) => console.warn('Geolocation error:', err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  if (locateBtn) locateBtn.disabled = true;
}

function stopLocate() {
  if (!watching) return;
  navigator.geolocation.clearWatch(watchId);
  watching = false; watchId = null;
  if (locateBtn) locateBtn.disabled = false;
}

locateBtn?.addEventListener('click', () => {
  if (!watching) startLocate();
});

followBtn?.addEventListener('click', () => {
  follow = !follow;
  if (followBtn) followBtn.textContent = follow ? '▶️ Follow: On' : '▶️ Follow: Off';
  if (follow && you) map.setView(you.getLatLng());
});

const HOME = { center: [45.4215, -75.6972], zoom: 11 };
resetViewBtn?.addEventListener('click', () => {
  follow = false;
  if (followBtn) followBtn.textContent = '▶️ Follow: Off';
  map.setView(HOME.center, HOME.zoom);
});

// --- Track recorder ----------------------------------------------------------
let track = [];
let trackLine = null;

const trackStartBtn = document.getElementById('trackStartBtn');
const trackStopBtn  = document.getElementById('trackStopBtn');
const trackSaveBtn  = document.getElementById('trackSaveBtn');

function onTrackPoint(e){
  track.push({ lat: e.latlng.lat, lng: e.latlng.lng, time: new Date().toISOString() });
  if (trackLine) map.removeLayer(trackLine);
  trackLine = L.polyline(track.map(p => [p.lat, p.lng]), { color: '#ff6b00', weight: 3 }).addTo(map);
}

trackStartBtn?.addEventListener('click', () => {
  track = [];
  if (!watching) startLocate();
  map.on('locationfound', onTrackPoint);
  if (trackStartBtn) trackStartBtn.disabled = true;
  if (trackStopBtn)  trackStopBtn.disabled  = false;
  if (trackSaveBtn)  trackSaveBtn.disabled  = true;
});

trackStopBtn?.addEventListener('click', () => {
  map.off('locationfound', onTrackPoint);
  if (trackStartBtn) trackStartBtn.disabled = false;
  if (trackStopBtn)  trackStopBtn.disabled  = true;
  if (trackSaveBtn)  trackSaveBtn.disabled  = track.length === 0;
});

trackSaveBtn?.addEventListener('click', () => {
  if (!track.length) return;
  const gpx = trackToGPX(track);
  downloadText('track.gpx', gpx, 'application/gpx+xml');
});

// --- Helpers (GPX & download) -----------------------------------------------
function esc(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'
  }[m]));
}

function trackToGPX(points){
  const seg = points.map(p =>
    `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${p.time}</time></trkpt>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
 <trk><name>Recorded Track</name><trkseg>${seg}</trkseg></trk>
</gpx>`;
}

function pinsToGPX(list){
  const wpts = list.map(p =>
    `<wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.label||p.type)}</name><type>${esc(p.type)}</type></wpt>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
 ${wpts}
</gpx>`;
}

function parseGPXWaypoints(xml){
  const res = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  doc.querySelectorAll('wpt').forEach(w => {
    const lat = parseFloat(w.getAttribute('lat'));
    const lng = parseFloat(w.getAttribute('lon'));
    const name = w.querySelector('name')?.textContent || '';
    const type = w.querySelector('type')?.textContent || 'Other';
    if (!isNaN(lat) && !isNaN(lng)) res.push({ type, label: name, lat, lng });
  });
  return res;
}

function downloadText(filename, text, mime){
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// --- PWA OFF (keep disabled while developing) -------------------------------
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('./service-worker.js').catch(err => console.warn('SW reg failed:', err));
//   });
// }
