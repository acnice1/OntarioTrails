// ===== Setup Leaflet map =====
const map = L.map('map', { zoomControl: true }).setView([45.4215, -75.6972], 11);
const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// (Optional) geocoder & search – comment out if not needed
if (window.L.Control && L.Control.Geocoder) {
  L.Control.geocoder({ defaultMarkGeocode: false }).addTo(map);
}
if (window.L.Control && L.Control.Search) {
  new L.Control.Search({
    layer: null, // plug a layer if you want feature search
    position: 'topleft',
    initial: false
  }).addTo(map);
}

// ===== Panel wiring =====
const panel = document.getElementById('controlPanel');
const toggle = document.getElementById('controlToggle');
const closeBtn = document.getElementById('closePanelBtn');

function openPanel() {
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  toggle.setAttribute('aria-expanded', 'true');
}
function closePanel() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  toggle.setAttribute('aria-expanded', 'false');
}
toggle.addEventListener('click', () =>
  panel.classList.contains('open') ? closePanel() : openPanel()
);
closeBtn.addEventListener('click', closePanel);

// ===== Layers visible toggles =====
const showBase = document.getElementById('showBase');
const showTrails = document.getElementById('showTrails');
const showPinsCk = document.getElementById('showPins');

// --- Trails layer (OTN.geojson) ---
const trailsStyle = { color: '#1472ff', weight: 3, opacity: 0.9 };
const trailsLayer = L.geoJSON(null, { style: trailsStyle });

// Load trails once; add to map if checkbox is on
fetch('./OTN.geojson')
  .then(res => res.json())
  .then(gj => {
    trailsLayer.addData(gj);
    if (showTrails?.checked) trailsLayer.addTo(map);
  })
  .catch(err => console.warn('Failed to load OTN.geojson:', err));

// Toggle handlers
showBase.addEventListener('change', () => {
  showBase.checked ? base.addTo(map) : map.removeLayer(base);
});
showTrails.addEventListener('change', () => {
  showTrails.checked ? trailsLayer.addTo(map) : map.removeLayer(trailsLayer);
});
showPinsCk.addEventListener('change', () => {
  showPinsCk.checked ? pinsLayer.addTo(map) : map.removeLayer(pinsLayer);
});

// ===== Pins =====
const pinsLayer = L.layerGroup().addTo(map);
const pinType = document.getElementById('pinType');
const pinLabel = document.getElementById('pinLabel');
const addPinBtn = document.getElementById('addPinBtn');
const importPinsInput = document.getElementById('importPinsInput');
const exportPinsBtn = document.getElementById('exportPinsBtn');
const pinCount = document.getElementById('pinCount');

let pins = [];
function refreshPins() {
  pinsLayer.clearLayers();
  pins.forEach(p => L.marker([p.lat, p.lng]).bindTooltip(p.label || p.type).addTo(pinsLayer));
  pinCount.textContent = pins.length ? `${pins.length} pin(s)` : '';
}
addPinBtn.addEventListener('click', () => {
  const c = map.getCenter();
  pins.push({ type: pinType.value, label: pinLabel.value.trim(), lat: c.lat, lng: c.lng });
  refreshPins();
});
exportPinsBtn.addEventListener('click', () => {
  if (!pins.length) return;
  const gpx = pinsToGPX(pins);
  downloadText('pins.gpx', gpx, 'application/gpx+xml');
});
importPinsInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text();
  let parsed = [];
  if (file.name.toLowerCase().endsWith('.gpx')) {
    parsed = parseGPXWaypoints(text);
  } else {
    try { parsed = JSON.parse(text).features?.map(f => ({ 
      type: f.properties?.type || 'Other',
      label: f.properties?.name || '',
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]
    })) || []; } catch {}
  }
  pins.push(...parsed); refreshPins();
  e.target.value = '';
});

// ===== Locate / Follow / Reset =====
const locateBtn = document.getElementById('locateBtn');
const followBtn = document.getElementById('followBtn');
const resetViewBtn = document.getElementById('resetViewBtn');

let watching = false;
let watchId = null;
let follow = false;
let you = null;

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
  locateBtn.disabled = true;
}
function stopLocate() {
  if (!watching) return;
  navigator.geolocation.clearWatch(watchId);
  watching = false; watchId = null;
  locateBtn.disabled = false;
}

locateBtn.addEventListener('click', () => {
  if (!watching) startLocate();
});

followBtn.addEventListener('click', () => {
  follow = !follow;
  followBtn.textContent = follow ? '▶️ Follow: On' : '▶️ Follow: Off';
  if (follow && you) map.setView(you.getLatLng());
});

const HOME = { center: [45.4215, -75.6972], zoom: 11 };
resetViewBtn.addEventListener('click', () => {
  follow = false; followBtn.textContent = '▶️ Follow: Off';
  map.setView(HOME.center, HOME.zoom);
});

// ===== Track recorder (uses your existing helpers) =====
let track = [];
let trackLine = null;

const trackStartBtn = document.getElementById('trackStartBtn');
const trackStopBtn = document.getElementById('trackStopBtn');
const trackSaveBtn = document.getElementById('trackSaveBtn');

function onTrackPoint(e){
  track.push({lat:e.latlng.lat, lng:e.latlng.lng, time:new Date().toISOString()});
  if (trackLine) map.removeLayer(trackLine);
  trackLine = L.polyline(track.map(p=>[p.lat,p.lng]), {color:'#ff6b00', weight:3}).addTo(map);
}

trackStartBtn.addEventListener('click', () => {
  track = [];
  if (!watching) startLocate();
  map.on('locationfound', onTrackPoint);
  trackStartBtn.disabled = true; trackStopBtn.disabled = false; trackSaveBtn.disabled = true;
});

trackStopBtn.addEventListener('click', () => {
  map.off('locationfound', onTrackPoint);
  trackStartBtn.disabled = false; trackStopBtn.disabled = true; trackSaveBtn.disabled = track.length===0;
});

trackSaveBtn.addEventListener('click', () => {
  if (!track.length) return;
  const gpx = trackToGPX(track);
  downloadText('track.gpx', gpx, 'application/gpx+xml');
});

// ===== GPX helpers & pinsToGPX / parseGPXWaypoints / downloadText =====
// (kept from your file; unchanged)
function esc(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&apos;' }[m])); }
function trackToGPX(track){
  const seg = track.map(p=>`<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${p.time}</time></trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">\n <trk><name>Recorded Track</name><trkseg>${seg}</trkseg></trk>\n</gpx>`;
}
function pinsToGPX(pins){
  const wpts = pins.map(p=>`<wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.label||p.type)}</name><type>${esc(p.type)}</type></wpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">\n ${wpts}\n</gpx>`;
}
function parseGPXWaypoints(xml){
  const res = []; const doc = new DOMParser().parseFromString(xml, 'application/xml');
  doc.querySelectorAll('wpt').forEach(w=>{
    const lat = parseFloat(w.getAttribute('lat')); const lng = parseFloat(w.getAttribute('lon'));
    const name = w.querySelector('name')?.textContent || ''; const type = w.querySelector('type')?.textContent || 'Other';
    if (!isNaN(lat)&&!isNaN(lng)) res.push({ type, label:name, lat, lng });
  });
  return res;
}
function downloadText(filename, text, mime){
  const blob = new Blob([text], {type:mime||'text/plain'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// ===== PWA OFF (commented out) =====
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('./service-worker.js').catch(err => console.warn('SW reg failed:', err));
//   });
// }
