  // ==============================
  // Ontario Trails — app.js
  // - Robust local data loading
  // - Ontario/Quebec-bounded geocoder
  // - Trails / Stocked Lakes (50 km match) / Access Points
  // - Pins, Locate/Follow, Track Recorder
  // - Contours: zoom-gated, midpoint labels, snap-to-nearest click, DEM hover/click fallback
  // - Legend: contour gradient + ticks + zoom hint
  // ==============================

  // --- Map & Basemap -----------------------------------------------------------
  const map = L.map('map', { zoomControl: false }).setView([45.4215, -75.6972], 11);
  L.control.zoom({ position: 'topright' }).addTo(map);

    //// Ensure imagery can render above the basemap
  map.createPane('basePane');
  map.getPane('basePane').style.zIndex = 200;

  map.createPane('imageryPane');
  map.getPane('imageryPane').style.zIndex = 300; // above base

  // OpenStreetMap Basemap
  const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    attribution: '&copy; OpenStreetMap',
    pane: 'basePane'
  }).addTo(map);


  // Ontario Imagery WMTS (toggleable)
  const imagery = L.tileLayer(
    'https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 22,           // your auto-cap code can still correct this later
      attribution: 'Imagery © Ontario LIO',
      pane: 'imageryPane',
      opacity: 1             // will be driven by the slider
    }
  );



// Mobile 100vh fix for older browsers (fallback for CSS var(--vh))
function setVHVar() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
setVHVar();
window.addEventListener('resize', setVHVar);
window.addEventListener('orientationchange', setVHVar);


  // --- Helper: safe JSON fetch with multiple candidate paths -------------------
  async function fetchFirstJSON(candidates, opts = {}) {
    const tried = [];
    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store', ...opts });
        if (!res.ok) { tried.push(`${url} [${res.status}]`); continue; }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json') && !ct.includes('application/geo+json')) {
          const text = await res.text();
          try { return JSON.parse(text); } catch { tried.push(`${url} [non-JSON]`); continue; }
        }
        return await res.json();
      } catch (e) {
        tried.push(`${url} [${e?.message || 'fetch error'}]`);
      }
    }
    const msg = `All candidate paths failed:\n- ${tried.join('\n- ')}`;
    throw new Error(msg);
  }

  // --- Base-map search (Ontario/Quebec bounded) -------------------------------
  if (window.L?.Control?.Geocoder) {
    const ON_QC_BOUNDS = L.latLngBounds([41.6, -95.0], [62.0, -57.0]);
    const ALLOWED_STATES = new Set(['Ontario', 'Québec', 'Quebec']);

    const nom = L.Control.Geocoder.nominatim({
      geocodingQueryParams: {
        countrycodes: 'ca',
        viewbox: [ON_QC_BOUNDS.getWest(), ON_QC_BOUNDS.getSouth(),
                  ON_QC_BOUNDS.getEast(), ON_QC_BOUNDS.getNorth()].join(','),
        bounded: 1
      }
    });

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
        return nom.reverse.apply(nom, arguments);
      }
    };

    L.Control.geocoder({
      geocoder: constrained,
      defaultMarkGeocode: false,
      placeholder: 'Search Ontario / Quebec…'
    })
    .on('markgeocode', (e) => {
      const g = e.geocode;
      if (g && g.bbox) map.fitBounds(g.bbox, { maxZoom: 23 });
      else if (g?.center) map.setView(g.center, 15);
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

  const showBaseCk    = document.getElementById('showBase');
  const showTrails    = document.getElementById('showTrails');
  const showPinsCk    = document.getElementById('showPins');
  const showCrosshair = document.getElementById('showCrosshair');
  const showStocked   = document.getElementById('showStocked');
  const showAccess    = document.getElementById('showAccess');
  const showContours  = document.getElementById('showContours');
  const showImagery = document.getElementById('showImagery');


  const crosshairEl   = document.getElementById('crosshair');
  const contourHintEl = document.getElementById('contourHint');

  // Let the panel scroll/tap without panning/zooming the map underneath
if (panel) {
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
}


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

  showBaseCk?.addEventListener('change', () => {
    showBaseCk.checked ? base.addTo(map) : map.removeLayer(base);
  });


// Let the panel scroll without the map/page moving underneath
if (panel) {
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
}

// Lock page scroll when panel is open so it can't slide off-screen
function openPanel() {
  if (!panel || !toggle) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('panel-open');   // <-- lock page
}

function closePanel() {
  if (!panel || !toggle) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('panel-open'); // <-- unlock page
}


  // --- Trails (OTN.geojson) ----------------------------------------------------
  const trailsStyle = { color: '#1472ff', weight: 3, opacity: 0.9 };
  const trailsLayer = L.geoJSON(null, { style: trailsStyle });

  (async function loadTrails() {
    try {
      const data = await fetchFirstJSON([
        './OTN.geojson',
        './data/OTN.geojson',
        '/OTN.geojson',
        '/data/OTN.geojson'
      ]);
      trailsLayer.addData(data);
      if (showTrails?.checked) trailsLayer.addTo(map);
    } catch (err) {
      console.warn('Trails not loaded (OTN.geojson).', err.message);
    }
  })();

  // --- Trails toggle -----------------------------------------------------------
  showTrails?.addEventListener('change', () => {
    showTrails.checked ? trailsLayer.addTo(map) : map.removeLayer(trailsLayer);
  });

  // --- Imagery toggle ----------------------------------------------------------
  showImagery?.addEventListener('change', () => {
    showImagery.checked ? imagery.addTo(map) : map.removeLayer(imagery);
  });

  // Slider elements
  const imageryOpacity = document.getElementById('imageryOpacity');
  const imageryOpacityVal = document.getElementById('imageryOpacityVal');

  // Helper to apply opacity and auto-show imagery when > 0
 function setImageryOpacity(percent) {
  const v = Number.isFinite(percent) ? percent : 100;
  const alpha = Math.max(0, Math.min(1, v / 100));
  imagery.setOpacity(alpha);
  imagery.bringToFront(); // keep imagery above base even if panes collapse to same stack

  if (imageryOpacityVal) imageryOpacityVal.textContent = `${v}%`;

  if (alpha > 0 && !map.hasLayer(imagery)) {
    imagery.addTo(map);
    if (showImagery) showImagery.checked = true; // keep checkbox in sync
  }
}


  // Live update while dragging
  imageryOpacity?.addEventListener('input', (e) => {
    setImageryOpacity(Number(e.target.value));
  });

  // Ensure the slider value is respected when the checkbox is toggled
  showImagery?.addEventListener('change', () => {
    if (showImagery.checked) {
      imagery.addTo(map);
      // apply current slider value (default 100 if missing)
      const v = imageryOpacity ? Number(imageryOpacity.value) : 100;
      imagery.setOpacity(Math.max(0, Math.min(1, v / 100)));
    } else {
      map.removeLayer(imagery);
    }
  });

  // Optional: initialize opacity at load based on slider’s default (100%)
  if (imageryOpacity) setImageryOpacity(Number(imageryOpacity.value));



  // --- Stocked Lakes (Fish_Stocking_Data.geojson) ------------------------------
  // Geocoding + highlight within 50 km of stocking pin
  const ONTARIO_BBOX = [-95.16, 41.68, -74.34, 56.86];
  const NOM_VIEWBOX = `${ONTARIO_BBOX[0]},${ONTARIO_BBOX[3]},${ONTARIO_BBOX[2]},${ONTARIO_BBOX[1]}`; // W,N,E,S
  const geocodeCache = new Map();
  const normKey = s => String(s || '').trim().toLowerCase();
  function nameCacheKey(name, hintLL) {
    if (!hintLL) return normKey(name);
    return `${normKey(name)}@${(+hintLL.lat).toFixed(3)},${(+hintLL.lng).toFixed(3)}`;
  }
  function metersBetween(a, b) {
    const dx = (a.lng - b.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360);
    const dy = (a.lat - b.lat);
    return Math.hypot(dx, dy) * 111320;
  }
  function scoreCandidate(c, hintLL) {
    const key = `${c.class}:${c.type}`;
    let score = 0;
    if (key === 'natural:water' || key === 'natural:lake' || key === 'water:lake' ||
        key === 'water:reservoir' || key === 'waterway:riverbank') score += 3;
    const dn = (c.display_name || '').toLowerCase();
    if (dn.includes('lake') || dn.includes('lac')) score += 1;
    if (hintLL) {
      const d = Math.hypot(hintLL.lat - parseFloat(c.lat), hintLL.lng - parseFloat(c.lon)) * 111000;
      if (d < 500) score += 3;
      else if (d < 2000) score += 1;
    }
    return score;
  }
 
  
  async function geocodeLake(name, hintLL) {
  // cache per (name + ~origin) to avoid cross-lake bleed
  const key = `${String(name).trim().toLowerCase()}@@${
    hintLL ? `${hintLL.lat.toFixed(4)},${hintLL.lng.toFixed(4)}` : 'none'
  }`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

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
    limit: '12'
  });

  let arr = [];
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'en-CA' },
      referrerPolicy: 'no-referrer-when-downgrade'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    arr = await res.json();
  } catch (e) {
    console.warn('Geocode error:', e);
  }

  // Enforce the 50 km rule strictly
  if (hintLL && Array.isArray(arr)) {
    arr = arr.filter(c => metersBetween(
      hintLL, { lat: +c.lat, lng: +c.lon }
    ) <= 50_000);
  }
  if (!arr || arr.length === 0) { geocodeCache.set(key, null); return null; }

  // Choose the closest (after filtering), keep bbox for fallback highlight
  const best = arr.map(c => ({
    class: c.class,
    type: c.type,
    lat: parseFloat(c.lat),
    lng: parseFloat(c.lon),
    display_name: c.display_name,
    geojson: c.geojson || null,
    bbox: Array.isArray(c.boundingbox) ? c.boundingbox.map(Number) : null,
    _d: hintLL ? metersBetween(hintLL, { lat: +c.lat, lng: +c.lon }) : Infinity
  })).sort((a,b) => a._d - b._d)[0];

  geocodeCache.set(key, best || null);
  return best || null;
}



  const geocodeHighlight = L.featureGroup().addTo(map);
  function pulseLayer(layer, ms = 2000) {
    const t0 = Date.now(); let on = false;
    const base = (layer.setStyle ? { ...layer.options } : null);
    const iv = setInterval(() => {
      const t = Date.now() - t0;
      if (t > ms) { clearInterval(iv); if (base && layer.setStyle) layer.setStyle(base); return; }
      on = !on;
      if (layer.setStyle) layer.setStyle(on ? { opacity: 1, weight: 5, color: '#00c7a9' } : { opacity: 0.6, weight: 3, color: '#00c7a9' });
      else if (layer.setRadius) layer.setRadius(on ? 9 : 6);
    }, 220);
  }

  function showGeocodeHighlight(candidate) {
  geocodeHighlight.clearLayers();
  if (!candidate) return;

  let hl;

  // Prefer polygon highlight
  if (candidate.geojson && (candidate.geojson.type === 'Polygon' || candidate.geojson.type === 'MultiPolygon')) {
    hl = L.geoJSON(candidate.geojson, { style: { color: '#00c7a9', weight: 3, fill: false, opacity: 0.8 } })
      .addTo(geocodeHighlight);
    try { map.fitBounds(hl.getBounds(), { padding: [24,24], maxZoom: 15 }); } catch(_) {}
  }
  // Then bbox highlight (Nominatim order: [south, north, west, east])
  else if (Array.isArray(candidate.bbox) && candidate.bbox.length === 4) {
    const [south, north, west, east] = candidate.bbox;
    const bounds = L.latLngBounds([south, west], [north, east]);
    hl = L.rectangle(bounds, { color: '#00c7a9', weight: 2, fill: false, opacity: 0.9 })
      .addTo(geocodeHighlight);
    map.fitBounds(bounds, { padding: [24,24], maxZoom: 15 });
  }
  // Finally a point fallback
  else if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) {
    hl = L.circleMarker([candidate.lat, candidate.lng], { radius: 8, color: '#00c7a9', fillColor: '#00c7a9', fillOpacity: 0.7 })
      .addTo(geocodeHighlight);
    map.setView([candidate.lat, candidate.lng], Math.max(map.getZoom(), 14));
  }

  if (hl) pulseLayer(hl);
}


  const stockedStyle = { radius: 5, color: '#0a7', fillColor: 'rgba(170, 0, 68, 1)', fillOpacity: 0.9 };
  const stockedLayer = L.geoJSON(null, {
    pointToLayer: (feat, latlng) => L.circleMarker(latlng, stockedStyle),
    onEachFeature: (feat, layer) => {
      const p = feat.properties || {};
      const titleCaseKey = k => String(k).replace(/_/g, ' ').replace(/\b([a-z])/g, s => s.toUpperCase());
      const formatVal = v => (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : String(v)));
  
     const waterbody =
  p.Official_Waterbody_Name ||
  p.OFFICIAL_WATERBODY_NAME ||
  p.Official_French_Waterbody_Name ||
  p.Unoffcial_Waterbody_Name ||
  p.WATERBODY || p.LAKE_NAME || p.LAKE || p.WATER_BODY ||
  'Stocked Lake';
  
  const species = p.SPECIES || p.SPECIES_NAME || p.FISH_SPECIES || null;
      const year    = p.YEAR || p.STOCK_YEAR || null;
      const qty     = p.QUANTITY || p.QTY || p.NUM_STOCKED || null;

      layer.bindTooltip(waterbody, { direction: 'top', offset: [0, -6] });

      let html = `<div style="min-width:220px">
        <div style="font-weight:700;margin-bottom:6px">${waterbody}</div>`;
      if (species) html += `<div><b>Species:</b> ${formatVal(species)}</div>`;
      if (year)    html += `<div><b>Year:</b> ${formatVal(year)}</div>`;
      if (qty)     html += `<div><b>Quantity:</b> ${formatVal(qty)}</div>`;

      const skip = new Set([
     'Official_Waterbody_Name',
      'OFFICIAL_WATERBODY_NAME',
      'Unoffcial_Waterbody_Name', 
    'WATERBODY','LAKE_NAME','LAKE','WATER_BODY',
    'SPECIES','SPECIES_NAME','FISH_SPECIES','YEAR','STOCK_YEAR','QUANTITY','QTY','NUM_STOCKED'
  ]);

    
      const rows = Object.keys(p).filter(k => !skip.has(k)).sort()
        .map(k => `<tr><td style="padding:2px 6px 2px 0;color:#335075;white-space:nowrap">${titleCaseKey(k)}</td><td style="padding:2px 0">${formatVal(p[k])}</td></tr>`).join('');
      if (rows) html += `<div style="max-height:180px;overflow:auto;border-top:1px solid #e8edf3;padding-top:6px"><table style="font-size:12px;border-collapse:collapse">${rows}</table></div>`;

      html += `</div>`;
      layer.bindPopup(html);

      // On click: geocode waterbody within 50 km and highlight nearest
      // On click → geocode by name, cache (per location), highlight polygon/bbox/point, zoom + pulse
layer.on('click', async () => {
  const origin = originLatLng(layer, feat);  // <- uses helper to get true lat/lon
  const cand = await geocodeLake(waterbody, origin);
  if (!cand) {
    console.warn('No geocode match within 50 km for', waterbody);
    return;
  }
  showGeocodeHighlight(cand);
});

    }
  });
  let stockedLoaded = false;
  async function ensureStockedLoaded() {
    if (stockedLoaded) return;
    try {
      const gj = await fetchFirstJSON([
        './Fish_Stocking_Data.geojson',
        './data/Fish_Stocking_Data.geojson',
        '/Fish_Stocking_Data.geojson',
        '/data/Fish_Stocking_Data.geojson'
      ]);
      stockedLayer.addData(gj);
      stockedLoaded = true;
    } catch (e) {
      console.warn('Stocked lakes not loaded (Fish_Stocking_Data.geojson).', e.message);
    }
  }
  async function toggleStocked() {
    if (!showStocked) return;
    if (showStocked.checked) { await ensureStockedLoaded(); if (stockedLoaded) stockedLayer.addTo(map); else showStocked.checked = false; }
    else { map.removeLayer(stockedLayer); }
  }
  showStocked?.addEventListener('change', toggleStocked);

  // --- Access Points (Fishing_Access_Point.geojson) ----------------------------
  const accessStyle = { radius: 5, color: '#b85', fillColor: '#f8a55e', fillOpacity: 0.95 };
  function accessPopupContent(p = {}) {
    const titleCaseKey = k => String(k).replace(/_/g, ' ').replace(/\b([a-z])/g, s => s.toUpperCase());
    const formatVal = v => (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : String(v)));
    const name   = p.NAME || p.SITE_NAME || p.ACCESS_POINT_NAME || p.LOCATION_NAME || 'Access Point';
    const water  = p.WATERBODY || p.WATER_BODY || p.LAKE || p.OFFICIAL_WATERBODY_NAME || null;
    const type   = p.TYPE || p.ACCESS_TYPE || p.FEATURE_TYPE || p.FACILITY_TYPE || null;
    const launch = p.LAUNCH_TYPE || p.BOAT_LAUNCH || p.RAMP_TYPE || null;

    let html = `<div class="popup access-popup"><h4>${name}</h4>`;
    if (water)  html += `<div><strong>Waterbody:</strong> ${formatVal(water)}</div>`;
    if (type)   html += `<div><strong>Type:</strong> ${formatVal(type)}</div>`;
    if (launch) html += `<div><strong>Launch:</strong> ${formatVal(launch)}</div>`;

    const keys = Object.keys(p || {}).sort();
    if (keys.length) {
      html += `<details open><summary>Details</summary><div style="max-height:160px;overflow:auto;"><table class="kv">`;
      for (const k of keys) html += `<tr><th>${titleCaseKey(k)}</th><td>${formatVal(p[k])}</td></tr>`;
      html += `</table></div></details>`;
    }
    html += `</div>`;
    return html;
  }
  const accessLayer = L.geoJSON(null, {
    pointToLayer: (feat, latlng) => L.circleMarker(latlng, accessStyle),
    onEachFeature: (feat, layer) => {
      layer.bindPopup(accessPopupContent(feat.properties || {}), { maxWidth: 340 });
    }
  });
  let accessLoaded = false;
  async function ensureAccessLoaded() {
    if (accessLoaded) return;
    try {
      const gj = await fetchFirstJSON([
        './Fishing_Access_Point.geojson',
        './data/Fishing_Access_Point.geojson',
        '/Fishing_Access_Point.geojson',
        '/data/Fishing_Access_Point.geojson'
      ]);
      accessLayer.addData(gj);
      accessLoaded = true;
    } catch (e) {
      console.warn('Access points not loaded (Fishing_Access_Point.geojson).', e.message);
    }
  }
  async function toggleAccess() {
    if (!showAccess) return;
    if (showAccess.checked) { await ensureAccessLoaded(); if (accessLoaded) accessLayer.addTo(map); else showAccess.checked = false; }
    else { map.removeLayer(accessLayer); }
  }
  showAccess?.addEventListener('change', toggleAccess);


  // Auto-detect true max zoom from ArcGIS MapServer capabilities
  (async function autoSetImageryMaxZoom() {
    try {
      const capsUrl = 'https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}'
        .replace(/\/tile\/\{z\}\/\{y\}\/\{x\}.*/, '?f=pjson'); // -> .../MapServer?f=pjson

      const res = await fetch(capsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const lods = json?.tileInfo?.lods;
      if (Array.isArray(lods) && lods.length) {
        // ArcGIS LOD 'level' aligns with Leaflet Z. Take the highest available level.
        const maxLOD = lods.reduce((m, l) => Math.max(m, l?.level ?? 0), 0);

        // Apply to the imagery layer
        imagery.options.maxZoom = maxLOD;

        // If the map's maxZoom is lower (or unset), raise it so users can actually reach that level
        const currentMapMax = map.getMaxZoom();
        if (typeof currentMapMax !== 'number' || currentMapMax < maxLOD) {
          map.setMaxZoom(maxLOD);
        }
        // (No further changes needed: Leaflet will respect the updated options immediately)
        console.info(`Ontario Imagery max zoom set to Z=${maxLOD}`);
      } else {
        console.warn('Imagery capabilities missing tileInfo.lods; leaving default maxZoom.');
      }
    } catch (err) {
      console.warn('Could not auto-detect imagery max zoom:', err);
    }
  })();


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
    pins.push({ type: pinType?.value || 'Other', label: (pinLabel?.value || '').trim(), lat: c.lat, lng: c.lng });
    refreshPins();
  });
  exportPinsBtn?.addEventListener('click', () => {
    if (!pins.length) return;
    const wpts = pins.map(p => `<wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><name>${esc(p.label||p.type)}</name><type>${esc(p.type)}</type></wpt>`).join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
  ${wpts}
  </gpx>`;
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

  // Pins helpers
  function esc(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m])); }
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

  // --- Locate / Follow / Reset -------------------------------------------------
  const locateBtn    = document.getElementById('locateBtn');
  const followBtn    = document.getElementById('followBtn');
  const resetViewBtn = document.getElementById('resetViewBtn');
  let watching = false, watchId = null, follow = false, you = null;

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
  locateBtn?.addEventListener('click', () => { if (!watching) startLocate(); });

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

  // ============================================================================
  // Contours integration (zoom-gated, labels, snap click, DEM) + Legend sync
  // ============================================================================
  const CONTOUR_ZOOM_THRESHOLD = 11;
  const HOVER_ZOOM_THRESHOLD   = 11;
  const ELEV_DOMAIN_MIN = 0, ELEV_DOMAIN_MAX = 700, ELEV_DEFAULT_COLOR = '#666';
  const SNAP_TOLERANCE_PX = 20;

  const LIO_CONTOUR_URL = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/29';
  const DEM_URL         = 'https://ws.geoservices.lrc.gov.on.ca/arcgis5/rest/services/Elevation/Ontario_DEM_ImageryDerived/ImageServer';

  // Legend ticks
  (function syncContourLegendTicks(){
    const minEl = document.getElementById('elevMinTick');
    const midEl = document.getElementById('elevMidTick');
    const maxEl = document.getElementById('elevMaxTick');
    if (minEl) minEl.textContent = ELEV_DOMAIN_MIN;
    if (maxEl) maxEl.textContent = ELEV_DOMAIN_MAX;
    if (midEl) midEl.textContent = Math.round((ELEV_DOMAIN_MIN + ELEV_DOMAIN_MAX) / 2);
  })();


  // Haversine — meters between two lat/lngs
function metersBetween(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
  const q = s1*s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2*s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
}

// Robust origin (layer first, then GeoJSON coords)
function originLatLng(layer, feature) {
  if (layer?.getLatLng) {
    const ll = layer.getLatLng();
    return { lat: ll.lat, lng: ll.lng };
  }
  const g = feature?.geometry;
  if (g?.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return { lat: +g.coordinates[1], lng: +g.coordinates[0] };
  }
  return null;
}


  // Color ramp helpers
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function lerp(a,b,t){return a+(b-a)*t;}
  const stops=[{t:0.00,rgb:[44,127,184]},{t:0.20,rgb:[65,182,196]},{t:0.40,rgb:[127,205,187]},{t:0.50,rgb:[161,217,155]},{t:0.70,rgb:[253,174,97]},{t:0.85,rgb:[217,95,14]},{t:1.00,rgb:[140,81,10]}];
  function colorForElevation(m){
    if(m==null||isNaN(m)) return ELEV_DEFAULT_COLOR;
    const t=clamp((m-ELEV_DOMAIN_MIN)/(ELEV_DOMAIN_MAX-ELEV_DOMAIN_MIN),0,1);
    for(let i=0;i<stops.length-1;i++){
      const a=stops[i], b=stops[i+1];
      if(t>=a.t && t<=b.t){
        const lt=(t-a.t)/(b.t-a.t);
        const r=Math.round(lerp(a.rgb[0],b.rgb[0],lt));
        const g=Math.round(lerp(a.rgb[1],b.rgb[1],lt));
        const bb=Math.round(lerp(a.rgb[2],b.rgb[2],lt));
        return `rgb(${r},${g},${bb})`;
      }
    }
    const last=stops[stops.length-1].rgb; return `rgb(${last[0]},${last[1]},${last[2]})`;
  }
  function getElevationValue(props){
    if(!props) return null;
    const keys = Object.keys(props);
    const candidates = ['ELEVATION','ELEV','CONTOUR','CONTOUR_ELEV','Z','VALUE'];
    for(const k of candidates){
      if(k in props) return props[k];
      const hit = keys.find(x=>x.toLowerCase()===k.toLowerCase());
      if(hit) return props[hit];
    }
    return null;
  }

  // Layers
  const contoursLayer = L.esri.featureLayer({
    url: LIO_CONTOUR_URL,
    where: '1=1',
    precision: 6,
    simplifyFactor: 0.5,
    style: (feature)=>{
      const elev = Number(getElevationValue(feature?.properties));
      return { color: colorForElevation(elev), weight: 1, opacity: 0.95 };
    },
    onEachFeature: (feature, layer)=>{
      if (layer && layer instanceof L.Path) {
        layer.options.interactive = false; // allow snap handler to own clicks
        layer.off();
      }
    }
  });
  const contourLabels = L.layerGroup();
  const labelByLeafletId = new Map();
  const labelByObjectId  = new Map();
  function getObjectId(feature) {
    const props = feature?.properties || {};
    const idField = contoursLayer?.options?.idField || 'OBJECTID';
    return feature?.id ?? props[idField] ?? props.OBJECTID ?? props.FID ?? null;
  }
  function addLabelFor(e) {
    const feature = e?.feature, layer = e?.layer;
    if (!feature || !feature.properties || !layer || !layer.getLatLngs) return;
    const elevRaw = getElevationValue(feature.properties);
    if (elevRaw == null || isNaN(+elevRaw)) return;
    const latlngs = layer.getLatLngs();
    const flat = Array.isArray(latlngs?.[0]) ? latlngs.flat(2) : latlngs;
    if (!flat || flat.length < 2) return;
    const a = flat[0], b = flat[flat.length - 1];
    if (!a || !b || typeof map.distance !== 'function') return;
    if (map.distance(a, b) < 120) return; // reduce clutter
    const mid = flat[Math.floor(flat.length / 2)];
    const marker = L.marker(mid, {
      icon: L.divIcon({ className:'contour-label', html: `${Math.round(+elevRaw)}`, iconSize:[0,0] }),
      interactive: false
    }).addTo(contourLabels);
    if (layer._leaflet_id != null) labelByLeafletId.set(layer._leaflet_id, marker);
    const oid = getObjectId(feature);
    if (oid != null) labelByObjectId.set(oid, marker);
  }
  function removeLabelFor(e) {
    let marker = null;
    const layer = e?.layer;
    if (layer && labelByLeafletId.has(layer._leaflet_id)) {
      marker = labelByLeafletId.get(layer._leaflet_id);
      labelByLeafletId.delete(layer._leaflet_id);
    } else {
      const oid = getObjectId(e?.feature);
      if (oid != null && labelByObjectId.has(oid)) {
        marker = labelByObjectId.get(oid);
        labelByObjectId.delete(oid);
      }
    }
    if (marker) contourLabels.removeLayer(marker);
  }
  contoursLayer.on('createfeature', addLabelFor);
  contoursLayer.on('removefeature', removeLabelFor);

  // Zoom hint + visibility
  function updateContourHint() {
    if (!contourHintEl) return;
    const z = map.getZoom();
    if (!showContours?.checked) {
      contourHintEl.innerHTML = `Enable <b>Contours</b> to view elevation lines`;
      return;
    }
    contourHintEl.innerHTML = (z >= CONTOUR_ZOOM_THRESHOLD)
      ? `Contours loaded (zoom ${z}).`
      : `Zoom to <b>${CONTOUR_ZOOM_THRESHOLD}+</b> to load contours`;
  }
  function updateContourVisibility(){
    const z = map.getZoom();
    const want = (z >= CONTOUR_ZOOM_THRESHOLD) && showContours?.checked;
    const on = map.hasLayer(contoursLayer);
    if (want && !on){
      contoursLayer.addTo(map);
      contourLabels.addTo(map);
      map.on('click', onSnapClick);
      map.on('mousemove', onHoverElev);
    } else if ((!want) && on) {
      map.removeLayer(contoursLayer);
      map.removeLayer(contourLabels);
      labelByLeafletId.clear(); labelByObjectId.clear();
      map.off('click', onSnapClick);
      map.off('mousemove', onHoverElev);
      elevTip.remove();
    }
    updateContourHint();
  }
  map.on('zoomend', updateContourVisibility);
  showContours?.addEventListener('change', updateContourVisibility);

  // DEM identify for hover/click fallback
  let demLayer;
  try{ demLayer = L.esri.imageMapLayer({ url: DEM_URL, opacity:0, pane:'tilePane' }); }
  catch(e){ console.warn('DEM image layer not available:', e); }
  const elevTip = L.tooltip({ permanent:false, direction:'top', offset:[0,-10], className:'elev-tooltip' });
  function fmtMeters(v){ if(v==null||isNaN(v)) return null; return Math.round(v); }
  function debounce(fn,wait){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait); }; }
  const queryDEM = debounce(function(latlng){
    if(!demLayer || !L.esri) return;
    if(map.getZoom() < HOVER_ZOOM_THRESHOLD){ elevTip.remove(); return; }
    try{
      demLayer.identify().at(latlng).run((err,res)=>{
        if(err){ elevTip.remove(); return; }
        const m = fmtMeters(res?.value ?? res?.pixel?.value);
        if(m==null){ elevTip.remove(); return; }
        elevTip.setLatLng(latlng).setContent(
          `<div style="padding:2px 6px;background:rgba(255,255,255,0.95);border:1px solid #ccc;border-radius:6px;font:12px system-ui;">${m} m</div>`
        ).addTo(map);
      });
    }catch(e){ elevTip.remove(); }
  }, 200);

  // Snap-to-nearest contour
  function closestPointOnSegments(pixel, pixelPts) {
    const { pointToSegmentDistance, closestPointOnSegment } = L.LineUtil;
    let best = { dist: Infinity, pt: null, index: -1 };
    for (let i = 0; i < pixelPts.length - 1; i++) {
      const a = pixelPts[i], b = pixelPts[i+1];
      const d = pointToSegmentDistance(pixel, a, b);
      if (d < best.dist) {
        best.dist = d;
        best.pt = closestPointOnSegment ? closestPointOnSegment(pixel, a, b) : null;
        best.index = i;
      }
    }
    return best;
  }
  function flattenLatLngs(latlngs) { return (!latlngs) ? [] : (Array.isArray(latlngs[0]) ? latlngs.flat(2) : latlngs); }
  function findNearestContour(clickLatLng) {
    if (!map.hasLayer(contoursLayer)) return null;
    const clickPx = map.latLngToLayerPoint(clickLatLng);
    let best = { distPx: Infinity, nearestLatLng: null, elev: null };

    contoursLayer.eachFeature((layer) => {
      if (!layer || !layer.getLatLngs) return;
      if (layer.getBounds && !layer.getBounds().pad(0.2).contains(clickLatLng)) return;
      const flat = flattenLatLngs(layer.getLatLngs());
      if (!flat || flat.length < 2) return;
      const pixels = flat.map(ll => map.latLngToLayerPoint(ll));
      const nearest = closestPointOnSegments(clickPx, pixels);
      if (!nearest || nearest.dist == null) return;
      if (nearest.dist < best.distPx) {
        best.distPx = nearest.dist;
        const segA = pixels[nearest.index], segB = pixels[nearest.index+1];
        const px = nearest.pt || new L.Point((segA.x+segB.x)/2, (segA.y+segB.y)/2);
        best.nearestLatLng = map.layerPointToLatLng(px);
        const elev = getElevationValue(layer.feature?.properties || {});
        best.elev = (elev!=null && !isNaN(+elev)) ? Math.round(+elev) : null;
      }
    });

    if (best.distPx <= SNAP_TOLERANCE_PX && best.elev != null) return best;
    return null;
  }
  function onSnapClick(e){
    if (map.hasLayer(contoursLayer)) {
      const nearest = findNearestContour(e.latlng);
      if (nearest) {
        L.popup().setLatLng(nearest.nearestLatLng).setContent(`<b>Elevation:</b> ${nearest.elev} m`).openOn(map);
        return;
      }
    }
    if (demLayer) {
      demLayer.identify().at(e.latlng).run((err,res)=>{
        const v = err ? null : (res?.value ?? res?.pixel?.value);
        const m = (v==null||isNaN(v)) ? null : Math.round(+v);
        if (m!=null) L.popup().setLatLng(e.latlng).setContent(`<b>Elevation:</b> ${m} m`).openOn(map);
      });
    }
  }
  function onHoverElev(e){ queryDEM(e.latlng); }

  updateContourVisibility(); // initial
  toggleAccess();           // initial
  toggleStocked();          // initial
  showPinsCk?.addEventListener('change', () => {
    showPinsCk.checked ? pinsLayer.addTo(map) : map.removeLayer(pinsLayer);
  });
