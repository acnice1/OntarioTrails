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
if (window.L?.Control?.Geocoder) {
  // Approximate bounding box (W, S, E, N)
  const bounds = L.latLngBounds(
    [41.6, -95.0],  // southwest corner
    [62.0, -57.0]   // northeast corner
  );

  L.Control.geocoder({
    defaultMarkGeocode: true,
    placeholder: 'Search Ontario / Quebec…',
    geocoder: L.Control.Geocoder.nominatim({
      viewbox: [
        bounds.getWest(), bounds.getSouth(),
        bounds.getEast(), bounds.getNorth()
      ].join(','),
      bounded: 1,                 // restrict to viewbox
      countrycodes: 'ca'          // only Canada
    })
  }).addTo(map);
} else {
  console.warn('Leaflet Control Geocoder not found. Check CDN script tag.');
}


// --- Panel wiring ------------------------------------------------------------
const panel    = document.getElementById('controlPanel');
const toggle   = document.getElementById('controlToggle');
const closeBtn = document.getElementById('closePanelBtn');

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
