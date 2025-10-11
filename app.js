/* ====== Config ====== */
const START_CENTER = [45.0, -77.0];
const START_ZOOM = 8;
const ONTARIO_BBOX = [-95.16, 41.68, -74.34, 56.86].join(','); // lon,lat W,S,E,N
const TRAIL_COLOR = '#1472ff';
const USER_COLOR  = '#ff00a8';

/* ====== Map & Basemaps ====== */
const map = L.map('map', { zoomControl: true }).setView(START_CENTER, START_ZOOM);

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, opacity: 0.6, attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const esriSat = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, opacity: 0.8, attribution: 'Imagery &copy; Esri' }
);

const baseLayers = { 'OSM Standard (faded)': osm, 'Esri World Imagery': esriSat };
const overlays = {};
const layerControl = L.control.layers(baseLayers, overlays, { collapsed: false }).addTo(map);

/* ====== GPS (magenta), locate/follow ====== */
// NOTE: We DO NOT start geolocation on load anymore (avoid gesture warning).
const userMarker = L.circleMarker([0,0], { radius: 7, color: USER_COLOR, fillColor: USER_COLOR, fillOpacity: 0.95 });
let watching = false, follow = false;

function startLocate() {
  map.locate({ watch: true, enableHighAccuracy: true, setView: false });
  watching = true;
}

document.getElementById('locateBtn').addEventListener('click', () => {
  if (!watching) startLocate();                 // user gesture → safe to start
  if (userMarker._latlng) map.setView(userMarker.getLatLng(), Math.max(map.getZoom(), 15));
});

const followBtn = document.getElementById('followBtn');
followBtn.addEventListener('click', () => {
  if (!watching) startLocate();                 // starting watch on gesture is OK
  follow = !follow;
  followBtn.textContent = (follow ? '⏸️ Follow: On' : '▶️ Follow: Off');
  if (follow && userMarker._latlng) map.setView(userMarker.getLatLng(), Math.max(map.getZoom(), 15));
});

map.on('locationfound', e => {
  userMarker.addTo(map).setLatLng(e.latlng);
  if (follow) map.setView(e.latlng, Math.max(map.getZoom(), 15));
});
map.on('locationerror', e => alert('GPS unavailable: ' + e.message));

/* ====== Geocoder (Ontario-wide) ====== */
const geocoder = L.Control.geocoder({
  defaultMarkGeocode: false,
  placeholder: 'Search places, lakes, streets (Ontario)…',
  geocoder: L.Control.Geocoder.nominatim({ geocodingQueryParams: { countrycodes: 'ca', viewbox: ONTARIO_BBOX, bounded: 1 } }),
  position: 'topleft'
})
.on('markgeocode', e => {
  const b = e.geocode.bbox;
  const poly = L.polygon([
    [b.getSouthWest().lat, b.getSouthWest().lng],
    [b.getNorthWest().lat,  b.getNorthWest().lng],
    [b.getNorthEast().lat,  b.getNorthEast().lng],
    [b.getSouthEast().lat,  b.getSouthEast().lng]
  ]);
  map.fitBounds(poly.getBounds(), { maxZoom: 15 });
  L.marker(e.geocode.center).addTo(map).bindPopup(e.geocode.name).openPopup();
})
.addTo(map);

/* ====== Trails (GeoJSON) with filters + search ====== */
let trailsLayer = null, allFeatures = [], filterValues = new Set(), activeFilters = new Set(), searchIndex = {};
const defaultStyle = { color: TRAIL_COLOR, weight: 2, opacity: 1 };
const styleByUse = () => defaultStyle;

function featurePopup(props, layer) {
  const rows = [
    ['Trail', props.TRAIL_NAME || '—'],
    ['Use', props.TRAIL_USE || '—'],
    ['Municipality', props.MUNICIPALITY || props.MUNICIPAL || '—'],
    ['Region', props.REGION || props.DISTRICT || '—'],
    ['Manager', props.MANAGING_ORG || props.OWNER || '—']
  ];
  const btn = `<div style="margin-top:6px"><span class="link-like" data-dl="${layer._fid}">Download GPX</span></div>`;
  return `<div style="min-width:240px">${rows.map(([k,v])=>`<div><b>${k}:</b> ${v}</div>`).join('')}${btn}</div>`;
}
const featureById = new Map();

function highlightLayer(layer, ms=2500){ const prev={...layer.options}; layer.setStyle({color:'#ff6b00',weight:5}); setTimeout(()=>layer.setStyle(prev),ms); }
function passesFilter(props){ if(activeFilters.size===0) return true; const v=(props.TRAIL_USE||'').toString().trim(); return activeFilters.has(v); }

function refreshFilter() {
  if (!trailsLayer) return;
  trailsLayer.clearLayers();
  const filtered = allFeatures.filter(f => passesFilter(f.properties));
  filtered.forEach((f) => {
    const g = L.geoJSON(f, {
      style: () => styleByUse(f.properties),
      onEachFeature: (feat, layer) => {
        const fid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        layer._fid = fid; featureById.set(fid, feat);
        layer.bindPopup(featurePopup(feat.properties, layer));
        layer.on('click', () => highlightLayer(layer));
        layer.on('popupopen', (ev)=>{
          const el = ev.popup.getElement().querySelector('[data-dl]');
          if (el) el.addEventListener('click', () => downloadTrailGPX(el.getAttribute('data-dl')));
        });
      }
    });
    g.eachLayer(child => trailsLayer.addLayer(child));
  });
}

function buildFiltersUI() {
  const box = document.getElementById('filters'); box.innerHTML = '';
  [...filterValues].sort().forEach(val => {
    const id = 'f_' + btoa(val).replace(/=/g,'');
    const row = document.createElement('label');
    row.innerHTML = `<input type="checkbox" id="${id}" value="${val}"><span>${val || 'Unspecified'}</span>`;
    box.appendChild(row);
    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeFilters.add(val); else activeFilters.delete(val);
      refreshFilter();
    });
  });
  document.getElementById('selectAll').onclick = () => {
    activeFilters = new Set(filterValues);
    box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    refreshFilter();
  };
  document.getElementById('clearAll').onclick = () => {
    activeFilters.clear();
    box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    refreshFilter();
  };
}

fetch('OTN.geojson')
  .then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => {
    const feats = (data && data.type==='FeatureCollection') ? data.features : [];
    allFeatures = feats;

    feats.forEach(f => { const v=(f.properties?.TRAIL_USE||'').toString().trim(); if(v) filterValues.add(v); });
    if (filterValues.size > 0) buildFiltersUI();

    searchIndex = {};
    feats.forEach(f => {
      const p = f.properties || {};
      const key = [p.TRAIL_NAME, p.MUNICIPALITY || p.MUNICIPAL, p.REGION, p.DISTRICT]
        .filter(Boolean).join(' | ').toLowerCase();
      if (!key) return;
      let center=null; try { center = L.geoJSON(f).getBounds().getCenter(); } catch(e){}
      if (center) searchIndex[key] = center;
    });

    trailsLayer = L.featureGroup().addTo(map);
    layerControl.addOverlay(trailsLayer, 'Trails (OTN)');
    refreshFilter();
    try { map.fitBounds(trailsLayer.getBounds(), { maxZoom: 12 }); } catch(e){}

    if (typeof L.Control.Search === 'function') {
      const trailSearch = new L.Control.Search({
        sourceData: function(text, callResponse) {
          text = text.toLowerCase(); const res = {};
          Object.keys(searchIndex).forEach(k => { if (k.includes(text)) res[k] = searchIndex[k]; });
          callResponse(res);
        },
        formatData: json => json,
        marker: false, zoom: 14,
        textPlaceholder: 'Search trails / municipalities…'
      }).on('search:locationfound', e => { map.setView(e.latlng, 14); });
      map.addControl(trailSearch);
    } else {
      console.warn('Leaflet Control Search plugin missing (continuing without it).');
    }
  })
  .catch(err => { console.error('GeoJSON fetch/parse error:', err); alert('Could not load OTN.geojson.'); });

document.getElementById('resetViewBtn').addEventListener('click', () => map.setView(START_CENTER, START_ZOOM), { passive: true });

/* ====== Pin Drops (persisted) ====== */
const pinLayer = L.featureGroup().addTo(map);
let pins = loadPins(); renderPins();

function loadPins(){ try { return JSON.parse(localStorage.getItem('pins')||'[]'); } catch(e){ return []; } }
function savePins(){ localStorage.setItem('pins', JSON.stringify(pins)); document.getElementById('pinCount').textContent = `${pins.length} pin(s)`; }
function renderPins(){
  pinLayer.clearLayers();
  pins.forEach((p,i) => {
    const m = L.marker([p.lat,p.lng], { draggable:true, title: p.label||p.type });
    m.bindPopup(`<b>${p.type}</b><br>${p.label||''}<br><span class="link-like" data-del="${i}">Delete</span>`);
    m.on('dragend', (e) => { const ll=e.target.getLatLng(); p.lat=ll.lat; p.lng=ll.lng; savePins(); });
    m.on('popupopen', (ev)=>{
      const el = ev.popup.getElement().querySelector('[data-del]');
      if (el) el.addEventListener('click', () => { pins.splice(i,1); renderPins(); });
    });
    pinLayer.addLayer(m);
  });
  savePins();
}
document.getElementById('addPinBtn').addEventListener('click', () => {
  const type  = document.getElementById('pinType').value;
  const label = document.getElementById('pinLabel').value.trim();
  const c = map.getCenter();
  pins.push({ type, label, lat:c.lat, lng:c.lng });
  renderPins();
});
document.getElementById('exportPinsBtn').addEventListener('click', () => {
  const gpx = pinsToGPX(pins);
  downloadText('pins.gpx', gpx, 'application/gpx+xml');
});
document.getElementById('importPinsInput').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return; const text = await f.text();
  if (f.name.toLowerCase().endsWith('.gpx')) {
    const imported = parseGPXWaypoints(text);
    pins = pins.concat(imported); renderPins();
  } else {
    try {
      const obj = JSON.parse(text);
      if (obj.type === 'FeatureCollection') {
        (obj.features||[]).forEach(ft=>{
          if (ft.geometry?.type==='Point') {
            const [lng,lat] = ft.geometry.coordinates;
            const props = ft.properties || {};
            pins.push({ type: props.type||'Other', label: props.label||'', lat, lng });
          }
        });
        renderPins();
      } else if (Array.isArray(obj)) {
        pins = pins.concat(obj.filter(p=>p.lat&&p.lng)); renderPins();
      } else {
        alert('Unrecognized JSON. Use array of {lat,lng,type,label} or GeoJSON.');
      }
    } catch(e){ alert('Unrecognized pins format. Use JSON/GeoJSON/GPX.'); }
  }
  e.target.value = '';
});

/* ====== Track Recorder ====== */
let track = [], trackLine = null;
const trackStartBtn = document.getElementById('trackStartBtn');
const trackStopBtn  = document.getElementById('trackStopBtn');
const trackSaveBtn  = document.getElementById('trackSaveBtn');

trackStartBtn.addEventListener('click', () => {
  track = [];
  if (!watching) startLocate();              // user gesture → safe
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

function onTrackPoint(e){
  track.push({lat:e.latlng.lat, lng:e.latlng.lng, time:new Date().toISOString()});
  if (trackLine) map.removeLayer(trackLine);
  trackLine = L.polyline(track.map(p=>[p.lat,p.lng]), {color:'#ff6b00', weight:3}).addTo(map);
}

/* ====== GPX helpers ====== */
function esc(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[m])); }
function trackToGPX(track){
  const seg = track.map(p=>`<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${p.time}</time></trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Recorded Track</name><trkseg>${seg}</trkseg></trk>
</gpx>`;
}
function pinsToGPX(pins){
  const wpts = pins.map(p=>`<wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.label||p.type)}</name><type>${esc(p.type)}</type></wpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
  ${wpts}
</gpx>`;
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

/* ====== Download a single trail as GPX ====== */
function downloadTrailGPX(fid){
  const feat = featureById.get(fid);
  if (!feat) return alert('Trail not found.');
  const g = feat.geometry;
  function segToTrkseg(coords){
    return coords.map(([lng,lat])=>`<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`).join('');
  }
  let segs = '';
  if (g.type==='LineString') segs = `<trkseg>${segToTrkseg(g.coordinates)}</trkseg>`;
  else if (g.type==='MultiLineString') segs = g.coordinates.map(c=>`<trkseg>${segToTrkseg(c)}</trkseg>`).join('');
  else return alert('Unsupported geometry.');
  const name = esc((feat.properties?.TRAIL_NAME)||'Selected Trail');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${name}</name>${segs}</trk>
</gpx>`;
  downloadText((name||'trail')+'.gpx', gpx, 'application/gpx+xml');
}

/* ====== PWA: Service Worker registration (optional) ====== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(err => console.warn('SW reg failed:', err));
  });
}
