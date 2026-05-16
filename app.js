  // ============================================================================
  // Ontario Trails — app.js
  // - Robust local data loading
  // - Ontario/Quebec-bounded geocoder
  // - Trails / Stocked Lakes (50 km match) / Access Points
  // - Pins, Locate/Follow, Track Recorder
  // - Contours: zoom-gated, midpoint labels, snap-to-nearest click, DEM hover/click
  // - Legend: contour gradient + ticks + zoom hint
  // ============================================================================


  // ---------------------------------------------------------------------------
  // Map & Panes & Basemap
  // ---------------------------------------------------------------------------
const map = L.map('map', {
  zoomControl: false,
  attributionControl: false,
  maxZoom: 22
}).setView([45.4215, -75.6972], 11);
 const zoomControl = L.control.zoom({ position: 'topright' }).addTo(map);

function updateZoomControlTitles() {
  const z = map.getZoom();
  const maxZ = map.getMaxZoom();
  const minZ = map.getMinZoom();

  const zoomInBtn = document.querySelector('.leaflet-control-zoom-in');
  const zoomOutBtn = document.querySelector('.leaflet-control-zoom-out');

  if (zoomInBtn) {
    const nextZ = Math.min(z + 1, maxZ);
    zoomInBtn.title = `Zoom in to z${nextZ}`;
    zoomInBtn.setAttribute('aria-label', `Zoom in to z${nextZ}`);
  }

  if (zoomOutBtn) {
    const nextZ = Math.max(z - 1, minZ);
    zoomOutBtn.title = `Zoom out to z${nextZ}`;
    zoomOutBtn.setAttribute('aria-label', `Zoom out to z${nextZ}`);
  }
}

updateZoomControlTitles();
map.on('zoomend', updateZoomControlTitles);
 // override default Leaflet attribution prefix with our own (kept concise to allow room for OSM + LIO credits)
 L.control.attribution({ position: 'bottomleft' }).addTo(map);

  // April 4, added scale control for better distance context (especially with contours)

  const scaleControl = L.control.scale({
  position: 'bottomright',
  metric: true,
  imperial: false
}).addTo(map);

function updateScaleZoomLabel() {
  const scaleEl = document.querySelector('.leaflet-control-scale');
  if (!scaleEl) return;

  let zoomEl = scaleEl.querySelector('.scale-zoom-label');

  if (!zoomEl) {
    zoomEl = document.createElement('span');
    zoomEl.className = 'scale-zoom-label';
    scaleEl.appendChild(zoomEl);
  }

  zoomEl.textContent = `z${Math.round(map.getZoom())}`;
}


updateScaleZoomLabel();
map.on('zoomend', updateScaleZoomLabel);


  // Pane order: base < imagery < CLUPA
  map.createPane('basePane');
  map.getPane('basePane').style.zIndex = 200;

  map.createPane('imageryPane');
  map.getPane('imageryPane').style.zIndex = 300; // above base

// OSM basemap
// ---------------------------------------------------------------------------
// Basemaps
// ---------------------------------------------------------------------------

const ONTARIO_TILE_BOUNDS = L.latLngBounds(
  [41.6377, -95.15965],
  [57.50826, -74.30998]
);

// Live OSM basemap
const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 22,
  maxNativeZoom: 19,
  attribution: '&copy; OpenStreetMap',
  pane: 'basePane'
});

// Offline R2 basemap
// Replace with your actual public R2/custom-domain URL.
const OFFLINE_BASEMAP_TILE_TEMPLATE = 'https://pub-19f9e9e1492a49faaa32e257355e1973.r2.dev/{z}/{x}/{y}.png';

const offlineBase = L.tileLayer(OFFLINE_BASEMAP_TILE_TEMPLATE, {
  minZoom: 0,
  maxZoom: 22,
  maxNativeZoom: 13,
  bounds: ONTARIO_TILE_BOUNDS,
  noWrap: true,
  attribution: '© MapTiler © OpenStreetMap contributors',
  pane: 'basePane'
});

const BASEMAP_SETTING_KEY = 'ontarioTrails.baseMapMode.v1';

function setBaseMapMode(mode = 'online') {
  if (map.hasLayer(base)) map.removeLayer(base);
  if (map.hasLayer(offlineBase)) map.removeLayer(offlineBase);

  if (mode === 'online') {
    base.addTo(map);
  } else if (mode === 'offline') {
    offlineBase.addTo(map);
  }

  if (baseMapModeSelect) baseMapModeSelect.value = mode;

  try {
    localStorage.setItem(BASEMAP_SETTING_KEY, mode);
  } catch {}
}

  // CLUPA pane (above imagery/contours)
  map.createPane('clupaPane');
  map.getPane('clupaPane').style.zIndex = 360; // imagery was 300

  // Ontario Imagery WMTS (toggleable; opacity controlled by slider)
const ONTARIO_IMAGERY_TILE_TEMPLATE =
  'https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}';

const imagery = L.tileLayer(
  ONTARIO_IMAGERY_TILE_TEMPLATE,
  {
    maxZoom: 22,
    maxNativeZoom: 19,
    attribution: 'Imagery © Ontario LIO',
    pane: 'imageryPane',
    opacity: 1
  }
);

  // ---------------------------------------------------------------------------
  // Mobile viewport fallback (JS var for older browsers' 100vh quirk)
  // ---------------------------------------------------------------------------
  function setVHVar() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  setVHVar();
  window.addEventListener('resize', setVHVar);
  window.addEventListener('orientationchange', setVHVar);


  // ---------------------------------------------------------------------------
  /* Helper: fetch the first available JSON from candidate paths */
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

const SERVER_ROUTES_URL = './data/routes/routes.json';

async function loadServerRoutes() {
  const res = await fetch(SERVER_ROUTES_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Routes HTTP ${res.status}`);
  return await res.json();
}

async function initServerRoutes() {
  try {
    const json = await loadServerRoutes();

    const routes = Array.isArray(json)
      ? json
      : Array.isArray(json?.routes)
        ? json.routes
        : [];

serverRoutes = routes
  .map((route, idx) => {
    const points = Array.isArray(route?.points)
      ? route.points
          .filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng))
          .map(p => ({ lat: +p.lat, lng: +p.lng }))
      : [];

    const storedLengthKm = Number(route?.lengthKm);

    return {
      name: route?.name || `Saved Route ${idx + 1}`,
      version: Number.isFinite(+route?.version) ? +route.version : 1,
      type: route?.type || 'plot-route',
      lengthKm: Number.isFinite(storedLengthKm) ? storedLengthKm : routeDistanceKm(points),
      points
    };
  })
  .filter(route => route.points.length > 0);

    renderServerRoutes();
if (showServerRoutesCk?.checked) serverRoutesLayer.addTo(map);
else map.removeLayer(serverRoutesLayer);

  } catch (err) {
    console.warn('Saved routes not loaded:', err);
    if (showServerRoutesCk) showServerRoutesCk.checked = false;
  }
}

  // ---------------------------------------------------------------------------
  // Geocoder in Panel (Ontario/Quebec-bounded Nominatim wrapper)
  // ---------------------------------------------------------------------------
  const searchInput   = document.getElementById('searchInput');
  const searchBtn     = document.getElementById('searchBtn');
  const searchResults = document.getElementById('searchResults');

  let searchMarker = null;

  let searchSeq = 0;               // increments each query to ignore stale results
  let typingSeq = 0;               // tracks the latest keystroke

  // Simple debouncer to limit how often a function can run (used for live search)
  const debouncer = (fn, wait = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};


  (function initPanelSearch(){
    if (!window.L?.Control?.Geocoder) {
      console.warn('Leaflet Control Geocoder not found. Check CDN script tag.');
      return; 
    }
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


    function keepAllowed(r) {
  const inBox = !!r?.center && ON_QC_BOUNDS.contains(r.center);
  const addr  = r?.properties?.address || {};
  const country = (addr.country_code || '').toLowerCase();
  const state = addr.state || addr.province || '';

  const inCA = !country || country === 'ca';
  const inPQ = !state || ALLOWED_STATES.has(state);

  return inBox && inCA && inPQ;
}

const constrained = {
  geocode: function(query, cb, context){
    nom.geocode(query, function(results){
      cb.call(context, (results || []).filter(keepAllowed));
    });
  }
};


  function setResultsMessage(msg){
    if (!searchResults) return;
    searchResults.innerHTML = `<div class="empty">${msg}</div>`;
  }

  // Search zoom caps (kept local to the search IIFE)
  const SEARCH_MAX_ZOOM_BBOX  = 15;       // cap when fitting a bbox
  const SEARCH_POINT_ZOOM     = 13;       // target zoom for point results
  const SEARCH_BOUNDS_PADDING = [32, 32]; // a bit more breathing room

    // Minimum OSM trail segment length shown in search results only.
  // This does NOT affect OSM trail caching or map display.
  const OSM_TRAIL_SEARCH_MIN_SEGMENT_LENGTH_M = 200;

    // Cached OSM trail search highlight layer.
  // This is separate from the main OSM trail layer so selected search results stand out.
  const osmTrailSearchHighlight = L.geoJSON(null, {
    style: {
      color: '#ff7a00',
      weight: 7,
      opacity: 0.95
    },
    onEachFeature: (feat, layer) => {
      layer.bindPopup(
        typeof trailOSMPopupContent === 'function'
          ? trailOSMPopupContent(feat.properties || {}, feat)
          : 'OSM trail',
        { maxWidth: 340 }
      );
    }
  }).addTo(map);

  function normalizeSearchText(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function osmResultDistanceText(meters) {
    if (!Number.isFinite(+meters)) return '';
    const m = +meters;

    if (m < 1000) return `${Math.round(m)} m from map centre`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km from map centre`;
  }

  function featureBoundsFromGeoJSON(feature) {
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      return bounds?.isValid?.() ? bounds : null;
    } catch {
      return null;
    }
  }

  function longestFeature(features = []) {
    let best = null;
    let bestKm = -1;

    features.forEach(feature => {
      const km =
        typeof lineStringLengthKm === 'function'
          ? lineStringLengthKm(feature?.geometry?.coordinates || [])
          : 0;

      if (km > bestKm) {
        bestKm = km;
        best = feature;
      }
    });

    return best || features[0] || null;
  }

  function featureCollectionBounds(features = []) {
    let combined = null;

    features.forEach(feature => {
      const b = featureBoundsFromGeoJSON(feature);
      if (!b) return;

      if (!combined) combined = b;
      else combined.extend(b);
    });

    return combined;
  }

  function featureCenter(feature) {
    const b = featureBoundsFromGeoJSON(feature);
    return b ? b.getCenter() : null;
  }

  function osmFeatureSearchName(feature) {
    const p = feature?.properties || {};

    if (typeof osmTrailName === 'function') {
      return osmTrailName(p);
    }

    return (
      p.name ||
      p['name:en'] ||
      p.official_name ||
      p.alt_name ||
      p.ref ||
      ''
    );
  }

  function osmFeatureSearchDisplayName(feature) {
    const p = feature?.properties || {};

    if (typeof osmTrailDisplayName === 'function') {
      return osmTrailDisplayName(p);
    }

    return osmFeatureSearchName(feature) || `Unnamed OSM ${p.highway || 'path'}`;
  }

  function osmFeatureSearchId(feature) {
    const p = feature?.properties || {};

    if (typeof osmTrailId === 'function') {
      return osmTrailId(p);
    }

    if (p.__osmType && p.__osmId) return `${p.__osmType}/${p.__osmId}`;
    return '';
  }

  function osmFeatureSearchKey(feature) {
    if (typeof osmTrailFeatureKey === 'function') {
      return osmTrailFeatureKey(feature);
    }

    const p = feature?.properties || {};
    if (p.__osmType && p.__osmId) return `${p.__osmType}:${p.__osmId}`;
    return JSON.stringify(feature?.geometry?.coordinates || []);
  }

  function osmFeatureMatchesQuery(feature, qNorm) {
    const p = feature?.properties || {};
    const name = osmFeatureSearchName(feature);
    const id = osmFeatureSearchId(feature);

    const haystack = normalizeSearchText([
      name,
      id,
      p.ref,
      p.highway,
      p.surface,
      p.access,
      p.foot,
      p.bicycle,
      p.horse
    ].filter(Boolean).join(' '));

    // Normal named trail search.
    if (haystack.includes(qNorm)) return true;

    // Allow a deliberate search for unnamed cached paths.
    if (!name && ['unnamed', 'unnamed osm', 'osm path', 'osm trail'].includes(qNorm)) {
      return true;
    }

    return false;
  }

  function searchCachedOsmTrails(q) {
    const qNorm = normalizeSearchText(q);
    if (qNorm.length < 3) return [];

        const features = Array.isArray(osmTrailFeatures)
      ? osmTrailFeatures.filter(feature => {
          const km =
            typeof lineStringLengthKm === 'function'
              ? lineStringLengthKm(feature?.geometry?.coordinates || [])
              : 0;

          return Number.isFinite(km) && (km * 1000) >= OSM_TRAIL_SEARCH_MIN_SEGMENT_LENGTH_M;
        })
      : [];

    if (!features.length) return [];
    const origin = map.getCenter();
    const groups = [];

    features
      .filter(feature => osmFeatureMatchesQuery(feature, qNorm))
      .forEach(feature => {
        const name = osmFeatureSearchName(feature);
        const displayName = osmFeatureSearchDisplayName(feature);
        const center = featureCenter(feature);
        const baseKey = name
          ? normalizeSearchText(name)
          : normalizeSearchText(osmFeatureSearchId(feature) || displayName);

        // Group same-name segments that are reasonably nearby.
        // Same name far away becomes a separate result.
        let group = null;

        if (name && center) {
          group = groups.find(g =>
            g.baseKey === baseKey &&
            g.center &&
            g.center.distanceTo(center) <= 15000
          );
        } else {
          group = groups.find(g => g.baseKey === baseKey);
        }

        if (!group) {
          group = {
            __kind: 'osmTrail',
            class: 'osm-trail',
            type: 'trail',
            baseKey,
            name: displayName,
            center,
            features: []
          };
          groups.push(group);
        }

        group.features.push(feature);

        const bounds = featureCollectionBounds(group.features);
        if (bounds) {
          group.bbox = bounds;
          group.center = bounds.getCenter();
        }
      });

    return groups
      .map(group => {
        const representative = longestFeature(group.features);
        const lengthKm =
          typeof lineStringLengthKm === 'function'
            ? lineStringLengthKm(representative?.geometry?.coordinates || [])
            : null;

        const center = group.center || featureCenter(representative);
        const distanceMeters = center ? origin.distanceTo(center) : Infinity;

        return {
          ...group,
          representative,
          center,
          distanceMeters,
          lengthKm,
          properties: {
            display_name: group.name,
            source: 'Cached OSM trails'
          }
        };
      })
      .sort((a, b) => {
        const an = normalizeSearchText(a.name);
        const bn = normalizeSearchText(b.name);

        const aExact = an === qNorm ? 1 : 0;
        const bExact = bn === qNorm ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aStarts = an.startsWith(qNorm) ? 1 : 0;
        const bStarts = bn.startsWith(qNorm) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;

        return (a.distanceMeters || Infinity) - (b.distanceMeters || Infinity);
      })
      .slice(0, 10);
  }

  function openOsmTrailSearchResult(result) {
    if (!result?.features?.length) return;

    // Ensure main OSM trails are visible.
    if (showTrailsOSM) showTrailsOSM.checked = true;

    try {
      if (typeof ensureTrailsOSMLoaded === 'function') {
        ensureTrailsOSMLoaded();
      }

      if (typeof trailsOSMLayer !== 'undefined' && !map.hasLayer(trailsOSMLayer)) {
        trailsOSMLayer.addTo(map);
      }
    } catch {}

    // Highlight the matched grouped trail result.
    osmTrailSearchHighlight.clearLayers();
    osmTrailSearchHighlight.addData({
      type: 'FeatureCollection',
      features: result.features
    });

    const bounds = result.bbox || featureCollectionBounds(result.features);

    if (bounds) {
      map.fitBounds(bounds, {
        padding: SEARCH_BOUNDS_PADDING,
        maxZoom: SEARCH_MAX_ZOOM_BBOX
      });
    } else if (result.center) {
      map.setView(result.center, SEARCH_POINT_ZOOM);
    }

    const repKey = osmFeatureSearchKey(result.representative);

    setTimeout(() => {
      const layers = osmTrailSearchHighlight.getLayers();

      const repLayer =
        layers.find(layer => osmFeatureSearchKey(layer.feature) === repKey) ||
        layers[0];

      if (repLayer) {
        const popupLatLng =
          repLayer.getBounds?.()?.getCenter?.() ||
          result.center ||
          map.getCenter();

        try {
          repLayer.openPopup(popupLatLng);
        } catch {}
      }
    }, 150);
  }

    function renderResults(list) {
    if (!searchResults) return;
    searchResults.innerHTML = '';

    if (!Array.isArray(list) || list.length === 0) {
      setResultsMessage('No results found.');
      return;
    }

    const MAX_RESULTS = 12;

    if (list.length >= MAX_RESULTS) {
      const note = document.createElement('div');
      note.className = 'empty';
      note.style.fontStyle = 'italic';
      note.style.padding = '6px 10px';
      note.textContent = `Showing first ${MAX_RESULTS} matches. Try refining your search.`;
      searchResults.appendChild(note);
    }

    list.slice(0, MAX_RESULTS).forEach(r => {
      const div = document.createElement('div');
      div.className = 'item';

      if (r.__kind === 'osmTrail') {
        const title = r.name || 'OSM trail';
        const segmentLength =
          Number.isFinite(+r.lengthKm)
            ? `${(+r.lengthKm).toFixed(2)} km segment`
            : 'segment length unknown';

        const distance = osmResultDistanceText(r.distanceMeters);
        const count = Array.isArray(r.features) && r.features.length > 1
          ? ` · ${r.features.length} segments`
          : '';

        div.innerHTML = `
          <div style="font-weight:700">${esc(title)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">
                       OSM trail · ${segmentLength}${count}${distance ? ` · ${distance}` : ''}
          </div>
        `;

        div.addEventListener('click', () => {
          openOsmTrailSearchResult(r);
          loadOsmTrailsAfterSearchMoveIfEnabled();
        });
        searchResults.appendChild(div);
        return;
      }

      div.textContent = r.name || r.html || r.properties?.display_name || 'Result';

           div.addEventListener('click', () => {
        if (r.bbox) {
          map.fitBounds(r.bbox, {
            maxZoom: SEARCH_MAX_ZOOM_BBOX,
            padding: SEARCH_BOUNDS_PADDING
          });
        } else if (r.center) {
          map.setView(r.center, SEARCH_POINT_ZOOM);
        }

        if (searchMarker) map.removeLayer(searchMarker);

        if (r.center) {
          searchMarker = L.marker(r.center)
            .addTo(map)
            .bindPopup(r.name || r.properties?.display_name || 'Location')
            .openPopup();
        }

        loadOsmTrailsAfterSearchMoveIfEnabled();
      });

      searchResults.appendChild(div);
    });
  }



  // --- helpers: keep just above runSearch -----------------------------


// detect water-like results by Nominatim class/type
function isWaterFeature(r) {
  const c = (r.class || '').toLowerCase();
  const t = (r.type  || '').toLowerCase();

  if (c === 'waterway') return true;
  if (c === 'natural' && ['water','lake','bay','strait','spring'].includes(t)) return true;
  if (c === 'water') return true;

  if (['reservoir','harbour','harbor','lagoon','pond','wetland'].includes(t)) return true;

  if (c === 'place' && ['sea','bay','ocean','strait','fjord','gulf','sound','inlet'].includes(t)) return true;

  if (c === 'nrcan' && t === 'lake') return true;

  return false;
}

// FIXED typo + expanded detection
function nameSuggestsWater(r) {
  const s = (r.name || r.properties?.display_name || '').toLowerCase();
  return /\b(lake|lac|river|rivière|creek|pond|bay|harbour|harbor|reservoir|canal|strait|inlet|marsh|lagoon|wetland|water)\b/.test(s);
}

// dedupe
function dedupeBySignature(list) {
  const round = (n) => Math.round(n * 10000) / 10000;
  const seen = new Set();
  const out = [];

  for (const r of list) {
    const name = (r.name || r.properties?.display_name || '').toLowerCase();
    const c = r.center || { lat: 0, lng: 0 };

    const sig = `${name}|${round(c.lat)},${round(c.lng)}|${(r.class||'')}:${(r.type||'')}`;

    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(r);
    }
  }
  return out;
}

const geocodeP = (geocoder, query) => new Promise(res => {
  geocoder.geocode(query, (results) => res(results || []));
});

async function geocodeNRCAN(q) {
  const clean = String(q || '').trim();
  if (!clean) return [];

  const url =
    `https://geogratis.gc.ca/services/geoname/en/geonames.json?q=${encodeURIComponent(clean)}&province[]=35`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    if (!res.ok) throw new Error(`NRCan HTTP ${res.status}`);

    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];

   
    return items
  .filter(item => {
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    const provinceDesc = String(item.province?.description || '').toLowerCase();
    const provinceCode = String(item.province?.code || item.province?.id || item.provinceCode || '');

    const isOntarioOrQuebec =
      provinceDesc === 'ontario' ||
      provinceCode === '35';

    if (!isOntarioOrQuebec) return false;

    const name = String(item.name || '').toLowerCase();
    const generic = String(item.generic?.term || item.concise?.term || '').toLowerCase();

    return (
      generic.includes('lake') ||
      generic.includes('lac') ||
      name.includes(' lake') ||
      name.startsWith('lake ') ||
      name.startsWith('lac ')
    );
  })
       .sort((a, b) => {
    const origin = map.getCenter();

    const da = origin.distanceTo(
      L.latLng(Number(a.latitude), Number(a.longitude))
    );

    const db = origin.distanceTo(
      L.latLng(Number(b.latitude), Number(b.longitude))
    );

    return da - db;
  })
  .map(item => {
        const center = L.latLng(Number(item.latitude), Number(item.longitude));
        const generic = item.generic?.term || item.concise?.term || 'GNBC';
        const province = item.province?.description || 'Ontario';
        const location = item.location ? `, ${item.location}` : '';

        return {
          name: `${item.name}${location} — ${generic}`,
          center,
          bbox: null,
          class: 'nrcan',
          type: 'lake',
          properties: {
            display_name: `${item.name}${location}, ${province}`,
            address: {
              country_code: 'ca',
              state: province
            },
            source: 'NRCan/GNBC',
            id: item.id
          }
        };
      });

  } catch (err) {
    console.warn('NRCan/GNBC search failed:', err);
    return [];
  }
}

let _lastWaterAugmentAt = 0;
const WATER_WORD_RE = /\b(lake|lac|river|rivière|creek|pond)\b/i;


// --- UPDATED runSearch ---------------------------------
const runSearch = async (q, mySeq) => {
  if (!q || q.length < 3) {
    setResultsMessage('Type at least 3 characters…');
    return;
  }

  setResultsMessage('Searching…');

  try {
    // 1. Primary search
    const primaryRaw = await geocodeP(constrained, q);
    const primary = primaryRaw.filter(keepAllowed);

    if (mySeq !== searchSeq) return;

    // 2. Always consider water augmentation if no strong result
const hasGoodWater = primary.some(r => isWaterFeature(r) || nameSuggestsWater(r));
const userAskedForWater = WATER_WORD_RE.test(q) || /\b(lake|lac|pond|reservoir|water)\b/i.test(q);

const now = Date.now();
const throttleOk = (now - _lastWaterAugmentAt) >= 800;

let extras = [];

    // KEY CHANGE:
    // Run fallback EVEN if user typed "Lake"
    if (!hasGoodWater && userAskedForWater && throttleOk) {
      _lastWaterAugmentAt = now;

      const suffixes = [' lake', ' river', ' lac'];

      for (const suffix of suffixes) {
        const results = await geocodeP(nom, `${q.replace(WATER_WORD_RE, '').trim()}${suffix}`);

        if (mySeq !== searchSeq) return;

        const filtered = results
          .filter(keepAllowed)
          .filter(r => isWaterFeature(r) || nameSuggestsWater(r));

        extras.push(...filtered);
      }
    }

     // NRCan/GNBC authoritative fallback for official Ontario lake names.
    // This helps when Nominatim/OSM does not return an official named lake.
 if (userAskedForWater) {
  const nrcanResults = await geocodeNRCAN(q);
  if (mySeq !== searchSeq) return;
  extras.push(...nrcanResults);
}


    // 3. Search cached OSM trails.
    // This is local/offline only. Online Overpass trail-name search will be a later pass.
    const osmTrailResults = searchCachedOsmTrails(q);

    // Merge + dedupe.
    // Keep OSM trail results first so named trail matches are visible before generic geocoder results.
    let merged = dedupeBySignature([...osmTrailResults, ...primary, ...extras]);
    
    // 5. Sort by water relevance first, then distance from current map centre.
    // OSM trail results remain eligible and will usually appear near the top when name-matched.    

const origin = map.getCenter();

merged.sort((a, b) => {
  const aw = isWaterFeature(a) || nameSuggestsWater(a);
  const bw = isWaterFeature(b) || nameSuggestsWater(b);

  if (aw !== bw) return bw - aw;

  const ac = a.center;
  const bc = b.center;

  if (!ac && !bc) return 0;
  if (!ac) return 1;
  if (!bc) return -1;

  const da = origin.distanceTo(ac);
  const db = origin.distanceTo(bc);

  return da - db;
});

    renderResults(merged);

  } catch (err) {
    if (mySeq !== searchSeq) return;
    console.warn('Search error:', err);
    setResultsMessage('Search failed. Try again.');
  }
};


  // Button still works (immediate search)
  searchBtn?.addEventListener('click', () => {
    const q = (searchInput?.value || '').trim();
    searchSeq++; runSearch(q, searchSeq);
  });

  // Hit Enter still works
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { searchSeq++; runSearch((searchInput.value || '').trim(), searchSeq); }
  });

  // NEW: dynamic search after 3 chars (debounced)
  const debouncedTypeSearch = debouncer(() => {
    const q = (searchInput?.value || '').trim();
    searchSeq = ++typingSeq;         // advance both; this seq marks the latest typing intent
    if (q.length < 3) setResultsMessage('Type at least 3 characters…');
    else runSearch(q, searchSeq);
  }, 300);

  searchInput?.addEventListener('input', () => {
    const q = (searchInput?.value || '').trim();
    if (!q) { setResultsMessage(''); return; }
    debouncedTypeSearch();
  });

  })();


  // ---------------------------------------------------------------------------
  // Panel wiring (single consolidated version)
  // ---------------------------------------------------------------------------
  const panel    = document.getElementById('controlPanel');
  const toggle   = document.getElementById('controlToggle');
  const closeBtn = document.getElementById('closePanelBtn');
  const utilityToggleBtn = document.getElementById('utilityToggleBtn');
  const searchToggleBtn = document.getElementById('searchToggleBtn');

  const showBaseCk    = document.getElementById('showBase');
  const showTrails    = document.getElementById('showTrails'); // OTN trails (blue)
  const showTrailsOSM = document.getElementById('showTrailsOSM'); // OSM trails (orange)
  const showPinsCk    = document.getElementById('showPins');
  const showServerRoutesCk = document.getElementById('showServerRoutes');
  const showCrosshair = document.getElementById('showCrosshair');
  const showStocked   = document.getElementById('showStocked');
  const showAccess    = document.getElementById('showAccess');
  const showContours  = document.getElementById('showContours');
  const showImagery   = document.getElementById('showImagery');

  const settingAutoLoadOsmAfterSearch = document.getElementById('settingAutoLoadOsmAfterSearch');

  const crosshairEl   = document.getElementById('crosshair');
  const contourHintEl = document.getElementById('contourHint');
  const baseMapModeSelect = document.getElementById('baseMapMode');
  // Panel: stop map/page interaction when touching inside the panel
  if (panel) {
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
  }

  // Panel open/close with body lock (single source of truth)
  function openPanel() {
    if (!panel || !toggle) return;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('panel-open');
  }
  function closePanel() {
    if (!panel || !toggle) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('panel-open');
  }

  // Listeners (defined once)
  toggle?.addEventListener('click', () =>
    panel?.classList.contains('open') ? closePanel() : openPanel()
  );
  closeBtn?.addEventListener('click', closePanel);


  //
  // ---------------------------------------------------------------------------
// Tabs: robust mobile-safe tab system
// ---------------------------------------------------------------------------

const mainTabs = document.getElementById('mainTabs');
const utilityTabs = document.getElementById('utilityTabs');

const MAIN_TAB_IDS = [
  'tab-map',
  'tab-pins',
  'tab-track'
];

const UTILITY_TAB_IDS = [
  'tab-settings',
  'tab-emergency',
  'tab-compass',
  'tab-health'
];

const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

function forceShow(el, displayValue = 'block') {
  if (!el) return;
  el.hidden = false;
  el.removeAttribute('hidden');
  el.style.setProperty('display', displayValue, 'important');
}

function forceHide(el) {
  if (!el) return;
  el.hidden = true;
  el.setAttribute('hidden', '');
  el.style.setProperty('display', 'none', 'important');
}

function isUtilityTabId(id) {
  return UTILITY_TAB_IDS.includes(id);
}

function setTabMode(mode = 'main') {
  if (!panel) return;

  const utilityMode = mode === 'utility';
  const searchMode = mode === 'search';
  const mainMode = mode === 'main';

  panel.classList.toggle('utility-tabs-mode', utilityMode);
  panel.classList.toggle('search-tabs-mode', searchMode);
  panel.classList.toggle('main-tabs-mode', mainMode);

  // Hard-force tab row visibility. This avoids mobile/PWA CSS weirdness.
  if (utilityMode) {
    forceHide(mainTabs);
    forceShow(utilityTabs, 'flex');
  } else if (searchMode) {
    forceHide(mainTabs);
    forceHide(utilityTabs);
  } else {
    forceShow(mainTabs, 'flex');
    forceHide(utilityTabs);
  }

  utilityToggleBtn?.setAttribute('aria-expanded', utilityMode ? 'true' : 'false');
  utilityToggleBtn?.classList.toggle('active', utilityMode);

  searchToggleBtn?.setAttribute('aria-expanded', searchMode ? 'true' : 'false');
  searchToggleBtn?.classList.toggle('active', searchMode);
}

function activateTab(id) {
  const target = document.getElementById(id);
  if (!target) return;

  const utilityTab = isUtilityTabId(id);
  const searchTab = id === 'tab-search';

  setTabMode(searchTab ? 'search' : utilityTab ? 'utility' : 'main');

  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === id);
  });

  tabPanels.forEach(panelEl => {
    const on = panelEl.id === id;
    panelEl.classList.toggle('active', on);

    if (on) {
      forceShow(panelEl, 'block');
    } else {
      forceHide(panelEl);
    }
  });

  try {
    localStorage.setItem('ontarioTrails.lastTab', id);
  } catch {}

  setTimeout(() => {
    try { map.invalidateSize(); } catch {}
  }, 60);
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.tab);
  });
});

utilityToggleBtn?.addEventListener('click', () => {
  const currentlyUtility = panel?.classList.contains('utility-tabs-mode');

  if (currentlyUtility) {
    activateTab('tab-map');
  } else {
    activateTab('tab-settings');
    try { updateOfflineStatus?.(); } catch {}
    try { updateEmergencyInfo?.(); } catch {}
    try { updateLayerHealth?.(); } catch {}
    try { renderOfflineAreas?.(); } catch {}
  }
});

searchToggleBtn?.addEventListener('click', () => {
  const currentlySearch = panel?.classList.contains('search-tabs-mode');

  if (currentlySearch) {
    activateTab('tab-map');
  } else {
    activateTab('tab-search');

    // Put the cursor straight into the search box.
    setTimeout(() => {
      try { searchInput?.focus?.(); } catch {}
    }, 80);
  }
});

(function restoreLastTab() {
  const saved = localStorage.getItem('ontarioTrails.lastTab') || 'tab-map';

  // Safer default: always start in the main controls unless the user explicitly taps settings/search.
  const initialTab =
    UTILITY_TAB_IDS.includes(saved) || saved === 'tab-search'
      ? 'tab-map'
      : saved;

  activateTab(initialTab);
})();

  /*showBaseCk?.addEventListener('change', () => {
    showBaseCk.checked ? base.addTo(map) : map.removeLayer(base);
  }); */
  baseMapModeSelect?.addEventListener('change', () => {
  setBaseMapMode(baseMapModeSelect.value || 'online');
});

(function initBaseMapMode() {
  let saved = 'online';

  try {
    saved = localStorage.getItem(BASEMAP_SETTING_KEY) || 'online';
  } catch {}

  if (!['online', 'offline', 'none'].includes(saved)) saved = 'online';

  setBaseMapMode(saved);
})();

  function updateCrosshair() {
    if (!crosshairEl || !showCrosshair) return;
    crosshairEl.style.display = showCrosshair.checked ? 'block' : 'none';
  }
  updateCrosshair();
  showCrosshair?.addEventListener('change', updateCrosshair);



  // ---------------------------------------------------------------------------
  // Trails (OTN.geojson) + toggle
  // ---------------------------------------------------------------------------
const trailsStyle = {
  color: '#1472ff',
  weight: 6,
  opacity: 0.8,
  interactive: false
};

function trailPopupContent(p = {}) {
  const val = (v) => (v == null || v === '' ? '—' : String(v));
  const lengthKm = Number.isFinite(+p.TRAIL_LENGTH_KM)
    ? `${(+p.TRAIL_LENGTH_KM).toFixed(1)} km`
    : '—';

  const website = p.TRAIL_ASSOCIATION_WEBSITE
    ? (() => {
        const raw = String(p.TRAIL_ASSOCIATION_WEBSITE).trim();
        const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${raw}</a>`;
      })()
    : '—';

  return `
    <div style="min-width:240px">
      <div style="font-weight:700;margin-bottom:6px">${val(p.TRAIL_NAME)}</div>
      <div><b>Use:</b> ${val(p.TRAIL_USE)}</div>
      <div><b>Length:</b> ${lengthKm}</div>
      <div><b>On-road:</b> ${val(p.ON_ROAD_FLG)}</div>
      <div><b>Managed by:</b> ${val(p.TRAIL_ASSOCIATION)}</div>
      <div><b>Website:</b> ${website}</div>
      ${
        p.DESCRIPTION
          ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e8edf3">${val(p.DESCRIPTION)}</div>`
          : ''
      }
    </div>`;
}

const trailsVisualLayer = L.geoJSON(null, {
  style: trailsStyle
});

const trailsHitLayer = L.geoJSON(null, {
  style: {
    color: '#1472ff',
    weight: 18,
    opacity: 0.01
  },
  onEachFeature: (feat, layer) => {
    layer.bindPopup(trailPopupContent(feat.properties || {}), { maxWidth: 340 });

    layer.on('click', (e) => {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      layer.openPopup(e.latlng);
    });
  }
});

const trailsLayer = L.layerGroup();

  (async function loadTrails() {
    try {
      const data = await fetchFirstJSON([
        './data/OTN.geojson',
        '/data/OTN.geojson'
      ]);
      trailsVisualLayer.addData(data);
trailsHitLayer.addData(data);
trailsLayer.addLayer(trailsVisualLayer);
trailsLayer.addLayer(trailsHitLayer);

if (showTrails?.checked) trailsLayer.addTo(map);
    } catch (err) {
      console.warn('Trails not loaded (OTN.geojson).', err.message);
    }
  })();

  showTrails?.addEventListener('change', () => {
    showTrails.checked ? trailsLayer.addTo(map) : map.removeLayer(trailsLayer);
  });


// ---------------------------------------------------------------------------
// Trails (OSM Overpass live/cache) + toggle
// ---------------------------------------------------------------------------
// First-pass implementation:
// - Replaces the static ./data/OSM_paths.geojson dependency.
// - Checkbox shows/hides locally cached OSM trails.
// - Load/Refresh button downloads OSM trail/path ways for the visible map area.
// - Bulk visible-area loading is blocked below z13 to reduce Overpass load.
// - Downloaded trails are stored in browser localStorage and reused offline.

const loadOsmTrailsBtn = document.getElementById('loadOsmTrailsBtn');
const osmTrailsStatus = document.getElementById('osmTrailsStatus');

const OSM_TRAILS_CACHE_KEY = 'ontarioTrails.osmTrails.features.v1';
const OSM_TRAILS_AREAS_KEY = 'ontarioTrails.osmTrails.areas.v1';
const OSM_TRAILS_MIN_LOAD_ZOOM = 13;
const OSM_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

let osmTrailFeatures = [];
let osmTrailsLoading = false;

function setOsmTrailsStatus(msg) {
  if (osmTrailsStatus) osmTrailsStatus.textContent = msg;
}

function osmTrailName(p = {}) {
  return (
    p.name ||
    p['name:en'] ||
    p.official_name ||
    p.alt_name ||
    p.ref ||
    ''
  );
}

function osmTrailDisplayName(p = {}) {
  const name = osmTrailName(p);
  if (name) return name;

  const type = p.highway || p.route || 'path';
  return `Unnamed OSM ${type}`;
}

function osmTrailId(p = {}) {
  if (p.__osmType && p.__osmId) return `${p.__osmType}/${p.__osmId}`;
  if (p.id) return String(p.id);
  return 'OSM trail';
}

function osmTrailFeatureKey(feature) {
  const p = feature?.properties || {};
  if (p.__osmType && p.__osmId) return `${p.__osmType}:${p.__osmId}`;
  return JSON.stringify(feature?.geometry?.coordinates || []);
}

function osmTrailFeatureBounds(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return null;

  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;

  coords.forEach(c => {
    if (!Array.isArray(c) || c.length < 2) return;

    const lng = Number(c[0]);
    const lat = Number(c[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    south = Math.min(south, lat);
    west = Math.min(west, lng);
    north = Math.max(north, lat);
    east = Math.max(east, lng);
  });

  if (![south, west, north, east].every(Number.isFinite)) return null;

  return { south, west, north, east };
}

function storedBoundsToLeafletBounds(b) {
  if (!b) return null;

  const south = Number(b.south);
  const west = Number(b.west);
  const north = Number(b.north);
  const east = Number(b.east);

  if (![south, west, north, east].every(Number.isFinite)) return null;
  return L.latLngBounds([south, west], [north, east]);
}

function featureIntersectsBounds(feature, bounds) {
  const fb = osmTrailFeatureBounds(feature);
  const fbLeaflet = storedBoundsToLeafletBounds(fb);

  if (!fbLeaflet || !bounds) return false;
  return fbLeaflet.intersects(bounds);
}

function lineStringLengthKm(coords = []) {
  let meters = 0;

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];

    if (!Array.isArray(a) || !Array.isArray(b)) continue;

    const aLL = L.latLng(Number(a[1]), Number(a[0]));
    const bLL = L.latLng(Number(b[1]), Number(b[0]));

    if (
      Number.isFinite(aLL.lat) &&
      Number.isFinite(aLL.lng) &&
      Number.isFinite(bLL.lat) &&
      Number.isFinite(bLL.lng)
    ) {
      meters += aLL.distanceTo(bLL);
    }
  }

  return meters / 1000;
}

function trailOSMPopupContent(p = {}, feature = null) {
  const val = (v) => (v == null || v === '' ? '—' : String(v));

  const name = osmTrailDisplayName(p);
  const isUnnamed = !osmTrailName(p);
  const lengthKm = lineStringLengthKm(feature?.geometry?.coordinates || []);

  const surface = p.surface || null;
  const difficulty = p.sac_scale || p.difficulty || null;

  const access  = p.access || null;
  const bicycle = p.bicycle || null;
  const foot    = p.foot || null;
  const horse   = p.horse || null;

  let html = `
    <div style="min-width:240px">
      <div style="font-weight:700;margin-bottom:6px">${esc(name)}</div>
  `;

  if (isUnnamed) {
    html += `<div style="font-size:12px;opacity:.75;margin-bottom:6px">${esc(osmTrailId(p))}</div>`;
  }

  html += `<div><b>Segment length:</b> ${Number.isFinite(lengthKm) ? `${lengthKm.toFixed(2)} km` : '—'}</div>`;

  if (surface) html += `<div><b>Surface:</b> ${esc(val(surface))}</div>`;
  if (difficulty) html += `<div><b>Difficulty:</b> ${esc(val(difficulty))}</div>`;
  if (access)  html += `<div><b>Access:</b> ${esc(val(access))}</div>`;
  if (foot)    html += `<div><b>Foot:</b> ${esc(val(foot))}</div>`;
  if (bicycle) html += `<div><b>Bicycle:</b> ${esc(val(bicycle))}</div>`;
  if (horse)   html += `<div><b>Horse:</b> ${esc(val(horse))}</div>`;

  html += `</div>`;
  return html;
}

function osmTrailVisualStyle(feature) {
  const p = feature?.properties || {};
  const named = !!osmTrailName(p);

  return {
    color: named ? '#8b5a2b' : '#b59a7a',
    weight: named ? 2.0 : 1.2,
    opacity: named ? 0.8 : 0.5
  };
}

function osmTrailHitStyle() {
  return {
    color: '#000',
    weight: 18,
    opacity: 0.01
  };
}

const trailsOSMVisualLayer = L.geoJSON(null, {
  style: osmTrailVisualStyle,
  interactive: false
});

const trailsOSMHitLayer = L.geoJSON(null, {
  style: osmTrailHitStyle,
  onEachFeature: (feat, layer) => {
    layer.bindPopup(trailOSMPopupContent(feat.properties || {}, feat), { maxWidth: 340 });

    layer.on('click', (e) => {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      layer.openPopup(e.latlng);
    });
  }
});

const trailsOSMLayer = L.layerGroup([
  trailsOSMVisualLayer,
  trailsOSMHitLayer
]);


function loadOsmTrailFeaturesFromStorage() {
  try {
    const raw = localStorage.getItem(OSM_TRAILS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];

    return Array.isArray(arr)
      ? arr.filter(f =>
          f?.type === 'Feature' &&
          f?.geometry?.type === 'LineString' &&
          Array.isArray(f.geometry.coordinates) &&
          f.geometry.coordinates.length >= 2
        )
      : [];
  } catch {
    return [];
  }
}

function saveOsmTrailFeaturesToStorage(features = osmTrailFeatures) {
  try {
    localStorage.setItem(OSM_TRAILS_CACHE_KEY, JSON.stringify(features));
  } catch (err) {
    console.warn('Could not save OSM trail cache:', err);
    setOsmTrailsStatus('OSM trails loaded, but browser storage is full or unavailable.');
  }
}

function loadOsmTrailAreas() {
  try {
    const raw = localStorage.getItem(OSM_TRAILS_AREAS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOsmTrailAreas(areas) {
  try {
    localStorage.setItem(OSM_TRAILS_AREAS_KEY, JSON.stringify(areas));
  } catch {}
}

function renderOsmTrailsLayer() {
  const collection = {
    type: 'FeatureCollection',
    features: osmTrailFeatures
  };

  trailsOSMVisualLayer.clearLayers();
  trailsOSMHitLayer.clearLayers();

  trailsOSMVisualLayer.addData(collection);
  trailsOSMHitLayer.addData(collection);
}

function addOrRefreshOsmTrailAreaRecord(bounds, featureCount) {
  const areas = loadOsmTrailAreas();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const newArea = {
    id: `osm-trails-area-${Date.now()}`,
    createdAt: new Date().toISOString(),
    featureCount,
    bounds: {
      south: sw.lat,
      west: sw.lng,
      north: ne.lat,
      east: ne.lng
    }
  };

  const newBounds = storedBoundsToLeafletBounds(newArea.bounds);

  const kept = areas.filter(area => {
    const oldBounds = storedBoundsToLeafletBounds(area.bounds);
    return !(oldBounds && newBounds && oldBounds.intersects(newBounds));
  });

  kept.push(newArea);
  saveOsmTrailAreas(kept);
}

function dedupeOsmTrailFeatures(features) {
  const seen = new Set();
  const out = [];

  features.forEach(feature => {
    const key = osmTrailFeatureKey(feature);
    if (seen.has(key)) return;

    seen.add(key);
    out.push(feature);
  });

  return out;
}

function osmTrailCacheSummary() {
  const total = osmTrailFeatures.length;
  const named = osmTrailFeatures.filter(f => !!osmTrailName(f.properties || {})).length;
  const unnamed = Math.max(0, total - named);

  return { total, named, unnamed };
}

function updateOsmTrailStatusIdle() {
  const { total, named, unnamed } = osmTrailCacheSummary();

  if (total > 0) {
    setOsmTrailsStatus(`${total} cached OSM trail segment(s): ${named} named, ${unnamed} unnamed.`);
  } else {
    setOsmTrailsStatus('No cached OSM trails yet. Zoom to z13+ and load the visible area.');
  }
}

function updateOsmLoadButtonState() {
  if (!loadOsmTrailsBtn) return;

  const z = map.getZoom();
  const canLoad = z >= OSM_TRAILS_MIN_LOAD_ZOOM && !osmTrailsLoading;

  loadOsmTrailsBtn.disabled = !canLoad;

  if (z < OSM_TRAILS_MIN_LOAD_ZOOM) {
    loadOsmTrailsBtn.title = `Zoom in to z${OSM_TRAILS_MIN_LOAD_ZOOM}+ to load OSM trails. Current zoom: z${z}.`;
  } else {
    loadOsmTrailsBtn.title = 'Load or refresh OSM trails for the visible map area.';
  }
}

function buildOverpassTrailQuery(bounds) {
  const s = bounds.getSouth();
  const w = bounds.getWest();
  const n = bounds.getNorth();
  const e = bounds.getEast();
  const bbox = `${s},${w},${n},${e}`;

  return `
[out:json][timeout:25];
(
  way["highway"~"^(path|footway|track|bridleway|cycleway)$"](${bbox});
  way["route"~"^(hiking|foot|bicycle|mtb|ski)$"](${bbox});
  way["trail_visibility"](${bbox});
);
out tags geom;
`;
}

async function fetchOsmTrailsFromOverpass(bounds) {
  const body = new URLSearchParams({
    data: buildOverpassTrailQuery(bounds)
  });

  const res = await fetch(OSM_OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': 'application/json'
    },
    body
  });

  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}`);
  }

  const json = await res.json();
  const elements = Array.isArray(json?.elements) ? json.elements : [];

  return elements
    .filter(el =>
      el.type === 'way' &&
      Array.isArray(el.geometry) &&
      el.geometry.length >= 2
    )
    .map(el => {
      const tags = el.tags || {};

      return {
        type: 'Feature',
        properties: {
          ...tags,
          __osmType: el.type,
          __osmId: el.id
        },
        geometry: {
          type: 'LineString',
          coordinates: el.geometry
            .map(pt => [Number(pt.lon), Number(pt.lat)])
            .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
        }
      };
    })
    .filter(f => f.geometry.coordinates.length >= 2);
}

async function loadOsmTrailsForVisibleArea() {
  const z = map.getZoom();

  if (z < OSM_TRAILS_MIN_LOAD_ZOOM) {
    setOsmTrailsStatus(`Zoom in to z${OSM_TRAILS_MIN_LOAD_ZOOM}+ to load OSM trails. Current zoom: z${z}.`);
    updateOsmLoadButtonState();
    return;
  }

  if (osmTrailsLoading) return;

  const bounds = map.getBounds();

  osmTrailsLoading = true;
  updateOsmLoadButtonState();

  if (loadOsmTrailsBtn) loadOsmTrailsBtn.textContent = 'Loading OSM trails…';
  setOsmTrailsStatus('Querying Overpass for visible map area…');

  try {
    const fresh = await fetchOsmTrailsFromOverpass(bounds);

    // Refresh overlapping cached data automatically, then add fresh data.
    const kept = osmTrailFeatures.filter(feature => !featureIntersectsBounds(feature, bounds));
    osmTrailFeatures = dedupeOsmTrailFeatures([...kept, ...fresh]);

    saveOsmTrailFeaturesToStorage(osmTrailFeatures);
    addOrRefreshOsmTrailAreaRecord(bounds, fresh.length);
    renderOsmTrailsLayer();

    if (showTrailsOSM?.checked && !map.hasLayer(trailsOSMLayer)) {
      trailsOSMLayer.addTo(map);
    }

    const { total } = osmTrailCacheSummary();
    setOsmTrailsStatus(`Loaded ${fresh.length} OSM trail segment(s). Cache now has ${total}.`);

    try { updateLayerHealth?.(); } catch {}
  } catch (err) {
    console.warn('OSM Overpass trail load failed:', err);
    setOsmTrailsStatus(`OSM trail load failed: ${err?.message || 'network error'}.`);
  } finally {
    osmTrailsLoading = false;
    if (loadOsmTrailsBtn) loadOsmTrailsBtn.textContent = 'Load / Refresh OSM trails';
    updateOsmLoadButtonState();
  }
}

function ensureTrailsOSMLoaded() {
  // Compatibility shim for existing Layer Health / Load all calls.
  // OSM trails are no longer loaded from ./data/OSM_paths.geojson.
  osmTrailFeatures = loadOsmTrailFeaturesFromStorage();
  renderOsmTrailsLayer();
  updateOsmTrailStatusIdle();
  return Promise.resolve();
}

// Initial OSM cache load.
osmTrailFeatures = loadOsmTrailFeaturesFromStorage();
renderOsmTrailsLayer();
updateOsmTrailStatusIdle();
updateOsmLoadButtonState();

showTrailsOSM?.addEventListener('change', async () => {
  await ensureTrailsOSMLoaded();

  if (showTrailsOSM.checked) {
    trailsOSMLayer.addTo(map);
  } else {
    map.removeLayer(trailsOSMLayer);
  }
});

loadOsmTrailsBtn?.addEventListener('click', loadOsmTrailsForVisibleArea);

map.on('zoomend', () => {
  updateOsmLoadButtonState();
});

// Optional: load/refresh OSM trails after a search result moves the map.
// Controlled by Settings > Auto-load OSM trails after search.
function loadOsmTrailsAfterSearchMoveIfEnabled() {
  if (!settingAutoLoadOsmAfterSearch?.checked) return;

  // Give Leaflet a moment to complete fitBounds/setView and update zoom/bounds.
  setTimeout(() => {
    try {
      if (typeof loadOsmTrailsForVisibleArea === 'function') {
        loadOsmTrailsForVisibleArea();
      }
    } catch (err) {
      console.warn('OSM trail auto-load after search failed:', err);
    }
  }, 350);
}


  // ---------------------------------------------------------------------------
  // Imagery (toggle + opacity slider)
  // ---------------------------------------------------------------------------
  const imageryOpacity = document.getElementById('imageryOpacity');
  const imageryOpacityVal = document.getElementById('imageryOpacityVal');

  // Helper to apply opacity and auto-show imagery when > 0
  function setImageryOpacity(percent) {
    const v = Number.isFinite(percent) ? percent : 100;
    const alpha = Math.max(0, Math.min(1, v / 100));
    imagery.setOpacity(alpha);
    imagery.bringToFront(); // keep imagery visually above base

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

  // Single consolidated toggle handler that reapplies slider value
  showImagery?.addEventListener('change', () => {
    if (showImagery.checked) {
      imagery.addTo(map);
      const v = imageryOpacity ? Number(imageryOpacity.value) : 100;
      imagery.setOpacity(Math.max(0, Math.min(1, v / 100)));
    } else {
      map.removeLayer(imagery);
    }
  });

  // Initialize opacity from slider default
  if (imageryOpacity) setImageryOpacity(Number(imageryOpacity.value));
// ---------------------------------------------------------------------------
// Offline Area Download: Satellite imagery tiles + OTN GeoJSON
// ---------------------------------------------------------------------------
// const CACHE_VERSION = window.APP_VERSION || 'dev';

const OFFLINE_IMAGERY_CACHE = 'ontario-trails-offline-imagery-v1';
const OFFLINE_BASEMAP_CACHE = 'ontario-trails-offline-basemap-v1';
const OFFLINE_DATA_CACHE    = 'ontario-trails-offline-data-v1';
const OFFLINE_AREAS_KEY     = 'ontarioTrails.offlineAreas.v1';

const OFFLINE_DEFAULT_MIN_ZOOM = 5;
const OFFLINE_BASEMAP_MAX_NATIVE_ZOOM = 13;
const OFFLINE_MAX_DOWNLOAD_ZOOM = 19;

const offlineAreaNameInput  = document.getElementById('offlineAreaName');
//const offlineMinZoomInput   = document.getElementById('offlineMinZoom');
const useOfflineBoxCk       = document.getElementById('useOfflineBox');
const offlineMaxZoomInput   = document.getElementById('offlineMaxZoom');
const offlineEstimateBtn    = document.getElementById('offlineEstimateBtn');

const offlineBoxWidthInput  = document.getElementById('offlineBoxWidth');
const offlineBoxHeightInput = document.getElementById('offlineBoxHeight');
const offlineBoxWidthMinus  = document.getElementById('offlineBoxWidthMinus');
const offlineBoxWidthPlus   = document.getElementById('offlineBoxWidthPlus');
const offlineBoxHeightMinus = document.getElementById('offlineBoxHeightMinus');
const offlineBoxHeightPlus  = document.getElementById('offlineBoxHeightPlus');

const offlineDownloadBtn    = document.getElementById('offlineDownloadBtn');
const offlineClearBtn       = document.getElementById('offlineClearBtn');
const offlineStatus         = document.getElementById('offlineStatus');

const showOfflineAreasCk    = document.getElementById('showOfflineAreas');
const downloadOfflineBasemapCk  = document.getElementById('downloadOfflineBasemap');
const downloadSatelliteImageryCk = document.getElementById('downloadSatelliteImagery');

const OFFLINE_MAX_TILE_DOWNLOAD = 900;

function setOfflineStatus(msg) {
  if (offlineStatus) offlineStatus.textContent = msg;
}
const offlineAreasLayer = L.layerGroup();
offlineAreasLayer.addTo(map);

function getStoredOfflineTileCount() {
  const areas = loadOfflineAreas();
  return areas.reduce((sum, area) => {
    const n = Number(area.tileCount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function getOfflineBoxValue(input, fallback) {
  const n = Number.parseFloat(input?.value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.20, Math.min(1.00, n));
}

function getOfflineDownloadBounds() {
  if (!useOfflineBoxCk?.checked) {
    return map.getBounds();
  }

  const boxWidth = getOfflineBoxValue(offlineBoxWidthInput, 0.82);
  const boxHeight = getOfflineBoxValue(offlineBoxHeightInput, 0.40);

  const size = map.getSize();
  const center = map.latLngToContainerPoint(map.getCenter());

  const halfW = size.x * boxWidth / 2;
  const halfH = size.y * boxHeight / 2;

  const nwPoint = L.point(center.x - halfW, center.y - halfH);
  const sePoint = L.point(center.x + halfW, center.y + halfH);

  return L.latLngBounds(
    map.containerPointToLatLng(nwPoint),
    map.containerPointToLatLng(sePoint)
  );
}

function loadOfflineAreas() {
  try {
    const raw = localStorage.getItem(OFFLINE_AREAS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOfflineAreas(areas) {
  try {
    localStorage.setItem(OFFLINE_AREAS_KEY, JSON.stringify(areas));
  } catch {}
}

function boundsToStoredArea(bounds, minZ, maxZ, tileCount, name) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const cleanName = String(name || '').trim();

  return {
    id: `offline-area-${Date.now()}`,
    name: cleanName || `Offline area ${new Date().toLocaleDateString()}`,
    createdAt: new Date().toISOString(),
    minZ,
    maxZ,
    tileCount,
    bounds: {
      south: sw.lat,
      west: sw.lng,
      north: ne.lat,
      east: ne.lng
    }
  };
}

function renderOfflineAreas() {
  offlineAreasLayer.clearLayers();

  const showBoxes = showOfflineAreasCk ? showOfflineAreasCk.checked : true;

  if (!showBoxes) {
    if (map.hasLayer(offlineAreasLayer)) {
      map.removeLayer(offlineAreasLayer);
    }
    return;
  }

  if (!map.hasLayer(offlineAreasLayer)) {
    offlineAreasLayer.addTo(map);
  }

  const areas = loadOfflineAreas();

  areas.forEach((area, idx) => {
    const b = area.bounds;
    if (!b) return;

    const leafletBounds = L.latLngBounds(
      [b.south, b.west],
      [b.north, b.east]
    );

    const rect = L.rectangle(leafletBounds, {
      color: '#1472ff',
      weight: 3,
      dashArray: '8 6',
      fillColor: '#1472ff',
      fillOpacity: 0.10,
      interactive: false
    }).addTo(offlineAreasLayer);

    const label = area.name || `Offline area ${idx + 1}`;
    const date = area.createdAt
      ? new Date(area.createdAt).toLocaleDateString()
      : 'Unknown date';

  /*  rect.bindPopup(
      `<div style="min-width:220px">
        <div style="font-weight:700;margin-bottom:6px">${label}</div>
        <div><b>Downloaded:</b> ${date}</div>
        <div><b>Zoom:</b> ${area.minZ}–${area.maxZ}</div>
        <div><b>Tiles:</b> ${area.tileCount ?? '—'}</div>
      </div>`
    ); */

const labelText = `${label} · Z${area.minZ}–${area.maxZ}`;

L.marker(leafletBounds.getNorthEast(), {
  interactive: false,
  keyboard: false,
  icon: L.divIcon({
    className: 'offline-area-label-icon',
    html: `<div class="offline-area-label">${esc(labelText)}</div>`,

    // Anchor the marker at the top-right corner,
    // but pull the label left and slightly down so it sits inside the box.
    iconSize: [160, 26],
    iconAnchor: [168, -8]
  })
}).addTo(offlineAreasLayer);

});

  console.info(`Rendered ${areas.length} offline area box(es).`);
}

function addOfflineAreaRecord(bounds, minZ, maxZ, tileCount) {
  const areas = loadOfflineAreas();
  const name = offlineAreaNameInput?.value || '';

  areas.push(boundsToStoredArea(bounds, minZ, maxZ, tileCount, name));

  saveOfflineAreas(areas);
  renderOfflineAreas();
}

showOfflineAreasCk?.addEventListener('change', () => {
  renderOfflineAreas();
});

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getOfflineZoomRange() {
  const currentZ = Math.round(map.getZoom());

  const minZ = OFFLINE_DEFAULT_MIN_ZOOM;

  const maxZ = clampInt(
    offlineMaxZoomInput?.value,
    OFFLINE_DEFAULT_MIN_ZOOM,
    OFFLINE_MAX_DOWNLOAD_ZOOM,
    Math.max(
      OFFLINE_DEFAULT_MIN_ZOOM,
      Math.min(OFFLINE_MAX_DOWNLOAD_ZOOM, currentZ + 1)
    )
  );

  if (offlineMaxZoomInput) offlineMaxZoomInput.value = String(maxZ);

  return { minZ, maxZ };
}

function tileUrlFromTemplate(template, z, x, y) {
  return template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y);
}

function getTileRangeForBounds(bounds, z) {
  const tileSize = 256;

  const nw = map.project(bounds.getNorthWest(), z).divideBy(tileSize).floor();
  const se = map.project(bounds.getSouthEast(), z).divideBy(tileSize).floor();

  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);

  return { minX, maxX, minY, maxY };
}

function buildImageryTileUrlList(bounds, minZ, maxZ) {
  const urls = [];

  for (let z = minZ; z <= maxZ; z++) {
    const r = getTileRangeForBounds(bounds, z);

    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) {
        urls.push(tileUrlFromTemplate(ONTARIO_IMAGERY_TILE_TEMPLATE, z, x, y));
      }
    }
  }

  return urls;
}
function buildOfflineBasemapTileUrlList(bounds, minZ, maxZ) {
  const urls = [];

  for (let z = minZ; z <= maxZ; z++) {
    const r = getTileRangeForBounds(bounds, z);

    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) {
        urls.push(tileUrlFromTemplate(OFFLINE_BASEMAP_TILE_TEMPLATE, z, x, y));
      }
    }
  }

  return urls;
}


async function cacheOfflineVectorData() {
  if (!('caches' in window)) return {
    ok: false,
    cached: 0,
    total: 3,
    failed: ['Cache API unavailable']
  };

  // OSM trails are no longer cached from ./data/OSM_paths.geojson.
  // They now use the browser localStorage cache populated by live Overpass loads.
  const datasets = [
    {
      name: 'OTN trails',
      candidates: [
        './data/OTN.geojson',
        '/data/OTN.geojson'
      ]
    },
    {
      name: 'Stocked lakes',
      candidates: [
        './data/Fish_Stocking_Data.geojson',
        '/data/Fish_Stocking_Data.geojson'
      ]
    },
    {
      name: 'Water access points',
      candidates: [
        './data/Fishing_Access_Point.geojson',
        '/data/Fishing_Access_Point.geojson'
      ]
    }
  ];

  const cache = await caches.open(OFFLINE_DATA_CACHE);

  let cached = 0;
  const failed = [];

  for (const dataset of datasets) {
    let datasetCached = false;

    for (const url of dataset.candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;

        await cache.put(url, res.clone());
        cached++;
        datasetCached = true;
        break;
      } catch (err) {
        console.warn(`${dataset.name} cache attempt failed:`, url, err);
      }
    }

    if (!datasetCached) {
      failed.push(dataset.name);
    }
  }

  return {
    ok: failed.length === 0,
    cached,
    total: datasets.length,
    failed
  };
}

async function cacheTileUrl(url, cache) {
  // no-cors allows cross-origin imagery tiles to be stored as opaque responses.
  const req = new Request(url, { mode: 'no-cors' });
  const existing = await cache.match(req, { ignoreVary: true });

  if (existing) return 'cached';

  const res = await fetch(req);
  await cache.put(req, res.clone());
  return 'downloaded';
}

const offlinePreviewBoxLayer = L.layerGroup().addTo(map);

function renderOfflineDownloadPreviewBox() {
  offlinePreviewBoxLayer.clearLayers();

  if (!useOfflineBoxCk?.checked) return;

  const bounds = getOfflineDownloadBounds();

  L.rectangle(bounds, {
    color: '#ff7a00',
    weight: 2,
    dashArray: '6 6',
    fillColor: '#ff7a00',
    fillOpacity: 0.08,
    interactive: false
  }).addTo(offlinePreviewBoxLayer);
}

function syncOfflineBoxControls() {
  const on = !!useOfflineBoxCk?.checked;

  [
    offlineBoxWidthInput,
    offlineBoxHeightInput,
    offlineBoxWidthMinus,
    offlineBoxWidthPlus,
    offlineBoxHeightMinus,
    offlineBoxHeightPlus
  ].forEach(el => {
    if (el) el.disabled = !on;
  });

  renderOfflineDownloadPreviewBox();
}

function adjustOfflineBoxInput(input, delta) {
  if (!input) return;

  const current = getOfflineBoxValue(input, Number.parseFloat(input.value) || 0.50);
  const next = Math.max(0.20, Math.min(1.00, +(current + delta).toFixed(2)));

  input.value = next.toFixed(2);
  renderOfflineDownloadPreviewBox();
}

async function estimateOfflineArea() {
  if (!('caches' in window)) {
    setOfflineStatus('Offline cache is not available in this browser.');
    return;
  }

const { minZ, maxZ } = getOfflineZoomRange();
const bounds = getOfflineDownloadBounds();

const basemapMaxZ = Math.min(maxZ, OFFLINE_BASEMAP_MAX_NATIVE_ZOOM);
const basemapMinZ = Math.min(minZ, basemapMaxZ);

const basemapUrls = downloadOfflineBasemapCk?.checked
  ? buildOfflineBasemapTileUrlList(bounds, basemapMinZ, basemapMaxZ)
  : [];

const imageryUrls = downloadSatelliteImageryCk?.checked
  ? buildImageryTileUrlList(bounds, minZ, maxZ)
  : [];

  const total = basemapUrls.length + imageryUrls.length;

  let storageMsg = '';
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = estimate.usage ? (estimate.usage / 1024 / 1024).toFixed(1) : '?';
      const quotaMB = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(0) : '?';
      storageMsg = ` Storage: ${usedMB} MB used of ~${quotaMB} MB available.`;
    } catch {}
  }

const areaLabel = useOfflineBoxCk?.checked ? 'Selected download box' : 'Current visible area';

setOfflineStatus(
  `${areaLabel} would download about ${total} tile(s), zoom ${minZ}–${maxZ}. ` +
  `Basemap: ${basemapUrls.length}. Imagery: ${imageryUrls.length}.` +
  storageMsg
);
}

async function downloadOfflineArea() {
  if (!('caches' in window)) {
    setOfflineStatus('Offline cache is not available in this browser.');
    return;
  }

const { minZ, maxZ } = getOfflineZoomRange();
const bounds = getOfflineDownloadBounds();

const basemapMaxZ = Math.min(maxZ, OFFLINE_BASEMAP_MAX_NATIVE_ZOOM);
const basemapMinZ = Math.min(minZ, basemapMaxZ);

const basemapUrls = downloadOfflineBasemapCk?.checked
  ? buildOfflineBasemapTileUrlList(bounds, basemapMinZ, basemapMaxZ)
  : [];

const imageryUrls = downloadSatelliteImageryCk?.checked
  ? buildImageryTileUrlList(bounds, minZ, maxZ)
  : [];

  const jobs = [
    ...basemapUrls.map(url => ({
      url,
      cacheName: OFFLINE_BASEMAP_CACHE,
      kind: 'basemap'
    })),
    ...imageryUrls.map(url => ({
      url,
      cacheName: OFFLINE_IMAGERY_CACHE,
      kind: 'imagery'
    }))
  ];

     const vectorDataResult = await cacheOfflineVectorData();
    
 if (!jobs.length) {
  const dataStatus = vectorDataResult.ok
    ? 'All offline data cached.'
    : `Offline data partially cached. Missing: ${vectorDataResult.failed.join(', ')}.`;

  setOfflineStatus(`No map tiles selected. ${dataStatus}`);
  return;
}

  if (jobs.length > OFFLINE_MAX_TILE_DOWNLOAD) {
    setOfflineStatus(
      `This area is too large: ${jobs.length} tiles. Reduce the visible area or lower the max zoom. Limit is ${OFFLINE_MAX_TILE_DOWNLOAD} tiles.`
    );
    return;
  }

  offlineDownloadBtn.disabled = true;
  offlineEstimateBtn.disabled = true;

  try {
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch {}
    }

setOfflineStatus(
  `Caching offline data and ${jobs.length} tile(s)… ` +
  `Basemap: ${basemapUrls.length}. Imagery: ${imageryUrls.length}.`
);

 

    const cacheMap = new Map();
    let downloaded = 0;
    let alreadyCached = 0;
    let failed = 0;

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      try {
        let cache = cacheMap.get(job.cacheName);

        if (!cache) {
          cache = await caches.open(job.cacheName);
          cacheMap.set(job.cacheName, cache);
        }

        const result = await cacheTileUrl(job.url, cache);
        if (result === 'cached') alreadyCached++;
        else downloaded++;
      } catch (err) {
        failed++;
        console.warn('Tile cache failed:', job.url, err);
      }

      if (i % 10 === 0 || i === jobs.length - 1) {
setOfflineStatus(
  `Offline download: ${i + 1}/${jobs.length} tiles processed. ` +
  `${downloaded} new, ${alreadyCached} already cached, ${failed} failed. ` +
  `Data: ${vectorDataResult.cached}/${vectorDataResult.total ?? 3} cached.`
);

        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (failed < jobs.length) {
      addOfflineAreaRecord(bounds, minZ, maxZ, jobs.length);
      if (offlineAreaNameInput) offlineAreaNameInput.value = '';
    }

   const dataStatus = vectorDataResult.ok
  ? 'All offline data cached.'
  : `Offline data partially cached. Missing: ${vectorDataResult.failed.join(', ')}.`;

setOfflineStatus(
  `Offline area ready. Tiles: ${downloaded} new, ${alreadyCached} already cached, ${failed} failed. ` +
  `Basemap: ${basemapUrls.length}. Imagery: ${imageryUrls.length}. ` +
  dataStatus
);
  } finally {
    offlineDownloadBtn.disabled = false;
    offlineEstimateBtn.disabled = false;
  }
}


async function clearOfflineImagery() {
  if ('caches' in window) {
    await caches.delete(OFFLINE_IMAGERY_CACHE);
    await caches.delete(OFFLINE_BASEMAP_CACHE);
  }

  localStorage.removeItem(OFFLINE_AREAS_KEY);
  renderOfflineAreas();

  setOfflineStatus('Offline basemap/imagery caches and downloaded area boxes cleared. Offline vector data cache was left in place.');
}

offlineEstimateBtn?.addEventListener('click', estimateOfflineArea);
offlineDownloadBtn?.addEventListener('click', downloadOfflineArea);
offlineClearBtn?.addEventListener('click', clearOfflineImagery);

useOfflineBoxCk?.addEventListener('change', syncOfflineBoxControls);

offlineBoxWidthInput?.addEventListener('input', renderOfflineDownloadPreviewBox);
offlineBoxHeightInput?.addEventListener('input', renderOfflineDownloadPreviewBox);

offlineBoxWidthMinus?.addEventListener('click', () => adjustOfflineBoxInput(offlineBoxWidthInput, -0.05));
offlineBoxWidthPlus?.addEventListener('click', () => adjustOfflineBoxInput(offlineBoxWidthInput, 0.05));
offlineBoxHeightMinus?.addEventListener('click', () => adjustOfflineBoxInput(offlineBoxHeightInput, -0.05));
offlineBoxHeightPlus?.addEventListener('click', () => adjustOfflineBoxInput(offlineBoxHeightInput, 0.05));

map.on('moveend zoomend resize', renderOfflineDownloadPreviewBox);

syncOfflineBoxControls();

// Sensible defaults based on the current map zoom.
(function initOfflineZoomDefaults() {
  const z = Math.round(map.getZoom());

  if (offlineMaxZoomInput) {
    offlineMaxZoomInput.value = String(
      Math.max(13, Math.min(OFFLINE_MAX_DOWNLOAD_ZOOM, z + 1))
    );
  }

  renderOfflineAreas();
})();

  // ---------------------------------------------------------------------------
  // Stocked Lakes (Fish_Stocking_Data.geojson) + Nominatim geocode highlight
  // ---------------------------------------------------------------------------
  const ONTARIO_BBOX = [-95.16, 41.68, -74.34, 56.86];
  const NOM_VIEWBOX = `${ONTARIO_BBOX[0]},${ONTARIO_BBOX[3]},${ONTARIO_BBOX[2]},${ONTARIO_BBOX[1]}`; // W,N,E,S
  const geocodeCache = new Map();
  const normKey = s => String(s || '').trim().toLowerCase();

  function nameCacheKey(name, hintLL) {
    if (!hintLL) return normKey(name);
    return `${normKey(name)}@${(+hintLL.lat).toFixed(3)},${(+hintLL.lng).toFixed(3)}`;
  }
  function metersBetween(a, b) { // Planar approximation used for 50 km geocode filtering
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

      // On click → geocode by name, cache (per location), highlight polygon/bbox/point, zoom + pulse
      layer.on('click', async () => {
        const origin = originLatLng(layer, feat); // helper to get true lat/lon
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
        './data/Fish_Stocking_Data.geojson',
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


  // ---------------------------------------------------------------------------
  // Access Points (Fishing_Access_Point.geojson)
  // ---------------------------------------------------------------------------
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
        './data/Fishing_Access_Point.geojson'
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


  // ---------------------------------------------------------------------------
  // CLUPA (Crown Land Use Policy Atlas) — outlines + labels (declare first)
  // ---------------------------------------------------------------------------
  const CLUPA_SERVICE_URL = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer';

  // Lightweight outline layers for clarity
  const clupaProvOutline = L.esri.featureLayer({
    url: `${CLUPA_SERVICE_URL}/5`,
    pane: 'clupaPane',
    fields: ['OBJECTID','NAME_ENG','NAME_FR'],
    precision: 5,
    simplifyFactor: 0.7,
    style: { color: '#ff2d55', weight: 2, fillOpacity: 0, opacity: 1 }
  });

  const clupaOverlayOutline = L.esri.featureLayer({
    url: `${CLUPA_SERVICE_URL}/4`,
    pane: 'clupaPane',
    fields: ['OBJECTID','NAME_ENG','NAME_FR','DESIGNATION_ENG'],
    precision: 5,
    simplifyFactor: 0.7,
    style: { color: '#1472ff', weight: 2, fillOpacity: 0, opacity: 1, dashArray: '6,4' }
  });

  // Small, non-interactive labels at polygon centers
  const clupaLabels = L.layerGroup({ pane: 'clupaPane' });

  function addClupaLabel(e) {
    const lyr = e.layer;
    if (!lyr || !lyr.getBounds) return;
    const center = lyr.getBounds().getCenter();
    const p = lyr.feature?.properties || {};
    const name = p.NAME_ENG || p.NAME_FR || p.DESIGNATION_ENG || '';
    if (!name) return;
    L.marker(center, {
      icon: L.divIcon({ className: 'clupa-label', html: name, iconSize: [0,0] }),
      interactive: false
    }).addTo(clupaLabels);
  }

  // Soft, non-interactive fills for CLUPA (drawn under outlines)
  const clupaProvFill = L.esri.featureLayer({
    url: `${CLUPA_SERVICE_URL}/5`,
    pane: 'clupaPane',
    fields: ['OBJECTID'],              // minimal payload
    precision: 5,
    simplifyFactor: 0.7,
    style: {
      // Same hue as your outline, but no stroke and translucent fill
      color: '#ff2d55',               // stroke color (kept, but weight=0)
      weight: 0,
      fillColor: '#ff2d55',
      fillOpacity: 0.18
    },
    onEachFeature: (_f, layer) => {
      layer.options.interactive = false; // let map clicks pass through to Identify
      layer.off();
    }
  });

  const clupaOverlayFill = L.esri.featureLayer({
    url: `${CLUPA_SERVICE_URL}/4`,
    pane: 'clupaPane',
    fields: ['OBJECTID'],
    precision: 5,
    simplifyFactor: 0.7,
    style: {
      color: '#1472ff',
      weight: 0,
      fillColor: '#1472ff',
      fillOpacity: 0.20
    },
    onEachFeature: (_f, layer) => {
      layer.options.interactive = false;
      layer.off();
    }
  });

  function removeClupaLabel(e) {
    // prune labels within the removed feature’s bounds
    const b = e.layer?.getBounds?.(); if (!b) return;
    clupaLabels.eachLayer(l => { if (b.contains(l.getLatLng())) clupaLabels.removeLayer(l); });
  }
  clupaProvOutline.on('createfeature', addClupaLabel);
  clupaProvOutline.on('removefeature', removeClupaLabel);
  clupaOverlayOutline.on('createfeature', addClupaLabel);
  clupaOverlayOutline.on('removefeature', removeClupaLabel);

  // Rendered server-side fills; set pane so they sit above imagery/contours
  const clupaProv = L.esri.dynamicMapLayer({
    url: CLUPA_SERVICE_URL,
    layers: [5],          // CLUPA Provincial
    opacity: 0.55,
    pane: 'clupaPane'
  });

  const clupaOverlay = L.esri.dynamicMapLayer({
    url: CLUPA_SERVICE_URL,
    layers: [4],          // CLUPA Overlay
    opacity: 0.65,
    pane: 'clupaPane'
  });

  // Toggles (CLUPA)
  const showCLUPAProv   = document.getElementById('showCLUPAProv');
  const showCLUPAOverlay= document.getElementById('showCLUPAOverlay');

  // Master toggle: turn BOTH CLUPA layers on/off (fills + outlines + labels)
  function setClupaAll(on) {
    setClupaProv(on);
    setClupaOverlay(on);
    // keep any legacy per-layer checkboxes visually in sync if they exist
    if (typeof showCLUPAProv   !== 'undefined' && showCLUPAProv)    showCLUPAProv.checked = on;
    if (typeof showCLUPAOverlay!== 'undefined' && showCLUPAOverlay) showCLUPAOverlay.checked = on;
  }


  showCLUPAProv?.addEventListener('change', () => setClupaProv(showCLUPAProv.checked));
  showCLUPAOverlay?.addEventListener('change', () => setClupaOverlay(showCLUPAOverlay.checked));


  function setClupaProv(on) {
    if (on) {
      clupaProvFill.addTo(map);
      clupaProvOutline.addTo(map);
      clupaLabels.addTo(map);
      // If you still want the server-rendered layer under the fill, uncomment:
      // clupaProv.addTo(map);
    } else {
      map.removeLayer(clupaProvFill);
      map.removeLayer(clupaProvOutline);
      // map.removeLayer(clupaProv);
      if (!showCLUPAOverlay?.checked) map.removeLayer(clupaLabels);
    }
  }

  function setClupaOverlay(on) {
    if (on) {
      clupaOverlayFill.addTo(map);
      clupaOverlayOutline.addTo(map);
      clupaLabels.addTo(map);
      // clupaOverlay.addTo(map);
    } else {
      map.removeLayer(clupaOverlayFill);
      map.removeLayer(clupaOverlayOutline);
      // map.removeLayer(clupaOverlay);
      if (!showCLUPAProv?.checked) map.removeLayer(clupaLabels);
    }
  }


  // Identify-on-click (only when one/both CLUPA toggles are on)
  map.on('click', (e) => {
    const masterOn = !!showCLUPA?.checked;

    // Define these (don’t leave them commented)
    const provOn = masterOn ? true : !!showCLUPAProv?.checked;
    const overOn = masterOn ? true : !!showCLUPAOverlay?.checked;

    const active = [];
    if (provOn) active.push(5);
    if (overOn) active.push(4);
    if (!active.length) return;

    L.esri.identifyFeatures({ url: CLUPA_SERVICE_URL })
      .on(map)
      .at(e.latlng)
      .layers(`visible:${active.join(',')}`)
      .tolerance(8)
      .returnGeometry(false)
      .run((err, fc) => {
        if (err || !fc?.features?.length) return;
        const f = fc.features[0];
        const p = f.properties || {};
        const name = p.NAME_ENG || p.NAME_FR || p.DESIGNATION_ENG || 'Area';
        const policy = p.POLICY_IDENT ? `<div><b>Policy ID:</b> ${p.POLICY_IDENT}</div>` : '';
        const des   = p.DESIGNATION_ENG ? `<div><b>Designation:</b> ${p.DESIGNATION_ENG}</div>` : '';
        const cat   = p.CATEGORY_ENG ? `<div><b>Category:</b> ${p.CATEGORY_ENG}</div>` : '';
        L.popup()
          .setLatLng(e.latlng)
          .setContent(`<div style="min-width:220px"><div style="font-weight:700;margin-bottom:6px">${name}</div>${des}${cat}${policy}</div>`)
          .openOn(map);
      });
  });



  // ---------------------------------------------------------------------------
  // Imagery: fetch capabilities to auto-set map/layer max zoom
  // ---------------------------------------------------------------------------
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


  // ---------------------------------------------------------------------------
  // Pins (add/import/export; tooltip; count)
  // ---------------------------------------------------------------------------

  // Persist pins
  const PINS_KEY = 'ontarioTrails.pins.v1';

  function loadPinsFromStorage() {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(p =>
        Number.isFinite(+p.lat) && Number.isFinite(+p.lng)
      ) : [];
    } catch { return []; }
  }

  function savePinsToStorage() {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); } catch {}
  }

  const pinsLayer       = L.layerGroup().addTo(map);
  const pinType         = document.getElementById('pinType');
  const pinLabel        = document.getElementById('pinLabel');
  const addPinBtn       = document.getElementById('addPinBtn');
  const importPinsInput = document.getElementById('importPinsInput');
  const exportPinsBtn   = document.getElementById('exportPinsBtn');
  const pinCount        = document.getElementById('pinCount');

    // ---------------------------------------------------------------------------
// Pin icons by type (emoji-based for simplicity; easy to swap for custom SVG)
// ---------------------------------------------------------------------------
const PIN_ICONS = {
  'Camping':  '🏕️',
  'Trailhead': '🥾',
  'Water':    '💧',
  'Viewpoint':'📸',
  'Hazard':   '⚠️',
  'Parking':  '🅿️',
  'Other':    '📍'
};

// Generate a small divIcon for a given type
function iconForType(type) {
  const emoji = PIN_ICONS[type] || PIN_ICONS['Other'];
  return L.divIcon({
    className: 'leaflet-div-icon custom-pin-icon', // add base class
    html: `<div class="pin-emoji">${emoji}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24]
  });
}

  let pins = loadPinsFromStorage();

  addPinBtn?.addEventListener('click', () => {
    const c = map.getCenter();
    pins.push({ type: pinType?.value || 'Other', label: (pinLabel?.value || '').trim(), lat: c.lat, lng: c.lng });
     savePinsToStorage(); 
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
    savePinsToStorage(); 
    refreshPins();
    e.target.value = '';
  });

  // Pin helpers
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


function refreshPins() {
  pinsLayer.clearLayers();
  pins.forEach((p, idx) => {
    const m = L.marker([p.lat, p.lng], {
      title: p.label || p.type,
      icon: iconForType(p.type)
   });

    m.bindTooltip(p.label || p.type);
    m.addTo(pinsLayer);

    const doDelete = () => {
      // remove index safely (handles duplicates)
      pins.splice(idx, 1);
      savePinsToStorage();
      refreshPins();
    };

    // Right-click (context menu) deletes
    m.on('contextmenu', (e) => {
      // optional confirm; comment out if you want immediate delete
      if (confirm(`Delete pin "${p.label || p.type}"?`)) doDelete();
    });

    // Alt/Option-click also deletes (handy on touchpads)
    m.on('click', (e) => {
      const ev = e.originalEvent;
      if (ev && (ev.altKey || ev.metaKey)) doDelete();
    });
  });

  if (pinCount) pinCount.textContent = pins.length ? `${pins.length} pin(s)` : '';
}

// ----------------------------------------------------------------------------
// Pins List UI (in the Pins tab) — create container, render, and wire actions
// ----------------------------------------------------------------------------

// Keep references to marker instances by index so we can fly/open tooltip
let pinMarkers = []; // filled by refreshPins()

function ensurePinListContainer() {
  // Try to find an existing container
  let el = document.getElementById('pinList');
  if (el) return el;

  // Create and insert below the last row inside the Pins tab
  const pinsTab = document.getElementById('tab-pins');
  const parentSection = pinsTab?.querySelector('.panel-section');
  el = document.createElement('div');
  el.id = 'pinList';
  el.className = 'pin-list';
  el.style.marginTop = '8px';
  el.innerHTML = ''; // will be filled by renderPinList()
  parentSection?.appendChild(el);
  return el;
}

function formatCoords(lat, lng) {
  const f = (n) => (Math.abs(n).toFixed(5)) + (n >= 0 ? (n === lat ? '°N' : '°E') : (n === lat ? '°S' : '°W'));
  return `${f(lat)}, ${f(lng)}`;
}

function renderPinList() {
  const list = ensurePinListContainer();
  if (!pins || !pins.length) {
    list.innerHTML = `<div class="empty" style="opacity:.8">No pins yet.</div>`;
    return;
  }

  const rows = pins.map((p, idx) => {
    const label  = (p.label || p.type || 'Pin').toString().trim();
    const coords = formatCoords(p.lat, p.lng);
    const emoji  = PIN_ICONS[p.type] || PIN_ICONS['Other'];

    return `
      <div class="pin-item" data-idx="${idx}" data-action="zoom"
           style="display:flex;align-items:center;gap:.6rem;padding:.45rem 0;border-bottom:1px solid #eef2f7;cursor:pointer;">
        <div class="pin-emoji" aria-hidden="true" data-action="zoom" data-idx="${idx}"
             style="font-size:1.1rem;line-height:1">${emoji}</div>

        <div class="pin-main" data-action="zoom" data-idx="${idx}" style="flex:1 1 auto;">
          <div style="font-weight:600;line-height:1.2">${esc(label)}</div>
          <div class="muted" style="font-size:.85rem;opacity:.75">${coords}</div>
        </div>

        <button class="pin-del" data-action="del" data-idx="${idx}" title="Delete pin"
                style="border:1px solid #e11d48;border-radius:6px;padding:.25rem .5rem;background:#fff;color:#e11d48;cursor:pointer">🗑️</button>
      </div>`;
  }).join('');

  list.innerHTML = `<div class="pin-list-wrap" role="list">${rows}</div>`;
}



// Event delegation for list actions
ensurePinListContainer().addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const idx = Number(btn.getAttribute('data-idx'));
  if (Number.isNaN(idx) || idx < 0 || idx >= pins.length) return;

  if (action === 'zoom') {
    // Ensure the pins layer is visible
    if (typeof showPinsCk !== 'undefined' && showPinsCk && !map.hasLayer(pinsLayer)) {
      showPinsCk.checked = true;
      pinsLayer.addTo(map);
    }

    const p = pins[idx];
    const target = [p.lat, p.lng];
    map.setView(target, Math.max(map.getZoom(), 14));

    // Try to open the marker tooltip
    const m = pinMarkers[idx];
    try { m?.openTooltip?.(); } catch {}
  }

  if (action === 'del') {
    // Delete pin, persist, and refresh
    pins.splice(idx, 1);
    savePinsToStorage?.();
    refreshPins();      // this will also re-render the list via our patched refreshPins
    renderPinList();    // make sure UI reflects deletion
  }
});

// --- Patch refreshPins() to fill pinMarkers and keep list in sync -----------
const _refreshPins_orig = refreshPins; // keep original name if needed elsewhere

refreshPins = function patchedRefreshPins() {
  pinsLayer.clearLayers();
  pinMarkers = [];

pins.forEach((p, idx) => {
    const m = L.marker([p.lat, p.lng], {
      title: p.label || p.type,
      icon: iconForType(p.type) // ✅ use your custom icon
    });
    m.bindTooltip(p.label || p.type);
    m.addTo(pinsLayer);
    pinMarkers[idx] = m;

    // Optional: single-tap delete from marker popup (phone-friendly)
    // Left-click opens popup with a delete button; remove if you don't want this.
    m.on('click', () => {
      const label = (p.label || p.type || 'Pin').toString();
      m.bindPopup(
        `<div style="min-width:180px">
           <div style="font-weight:600;margin-bottom:6px">${esc(label)}</div>
           <div style="font-size:.85rem;opacity:.7;margin-bottom:.5rem">${formatCoords(p.lat, p.lng)}</div>
           <button class="pin-del-inline" style="padding:6px 10px;border:1px solid #c33;border-radius:6px;background:#fff;cursor:pointer">🗑️ Delete pin</button>
         </div>`,
        { closeButton: true }
      ).openPopup();
    });
    m.on('popupopen', (ev) => {
      ev?.popup?._contentNode?.querySelector?.('.pin-del-inline')?.addEventListener('click', () => {
        const i = pinMarkers.indexOf(m);
        if (i >= 0) {
          pins.splice(i, 1);
          savePinsToStorage?.();
          refreshPins();
          renderPinList();
          try { map.closePopup(); } catch {}
        }
      });
    });
  });

   if (pinCount) pinCount.textContent = pins.length ? `${pins.length} pin(s)` : '';
  renderPinList();
};

// First render (if pins already loaded at boot)
refreshPins();

  // -
  // --------------------------------------------------------------------------
  // Locate / Follow / Reset View
  // ---------------------------------------------------------------------------
  const locateBtn    = document.getElementById('locateBtn');
  const followBtn    = document.getElementById('followBtn');
  const resetViewBtn = document.getElementById('resetViewBtn');

  const LOCATE_ZOOM = 15; // how far to zoom on locate


  let watching = false, watchId = null, follow = false, you = null;
let lastGeoFix = null;

  function ensureMarker() {
    if (!you) you = L.circleMarker([0,0], { radius: 6, color: '#ff00a8' }).addTo(map);
    return you;
  }

 function startLocate(centerOnFix = false) {
  if (watching) return;
  if (!('geolocation' in navigator)) { alert('Geolocation not supported'); return; }
  watching = true;

  let centerOnce = centerOnFix;  // <-- capture the intent for the first fix

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      ensureMarker().setLatLng([latitude, longitude]);
lastGeoFix = {
  lat: latitude,
  lng: longitude,
  accuracy: pos.coords.accuracy,
  heading: pos.coords.heading,
  speed: pos.coords.speed,
  timestamp: pos.timestamp || Date.now()
};

updateEmergencyInfo?.();
      // Recenter if Follow is on OR this locate-click requested a one-time center
      if (follow || centerOnce) {
        map.setView([latitude, longitude], Math.max(map.getZoom(), LOCATE_ZOOM));
        centerOnce = false; // only once per locate click
      }

      // Track recorder hook stays as-is
      onGeoPosition(pos);
    },
    (err) => console.warn('Geolocation error:', err),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  if (locateBtn) locateBtn.disabled = true;
}


locateBtn?.addEventListener('click', () => {
  if (!watching) {
    // Start GNSS and recenter on the first fix
    startLocate(true);
  } else {
    // Already watching: if we have a current position marker, recenter now
    if (you) {
      map.setView(you.getLatLng(), Math.max(map.getZoom(), LOCATE_ZOOM));
    } else {
      // No marker yet? request a one-time center on next fix
      startLocate(true);
    }
  }
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


  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
// Emergency: Copy Google Maps link and show clickable popup
// ---------------------------------------------------------------------------
const copyGoogleMapsLinkBtn  = document.getElementById('copyGoogleMapsLinkBtn');

function getBestShareLocation() {
  // Prefer current GPS marker if available
  if (you && typeof you.getLatLng === 'function') {
    return {
      latlng: you.getLatLng(),
      source: 'GPS location'
    };
  }

  // Fallback to current map center
  return {
    latlng: map.getCenter(),
    source: 'map center'
  };
}

async function copyTextWithFallback(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / restricted clipboard contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    document.body.removeChild(ta);
    return copied;
  }
}

async function showShareLocationPopup() {
  const { latlng, source } = getBestShareLocation();

  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) {
    alert('No valid location is available yet.');
    return;
  }

  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  // Copy immediately when the Emergency button is clicked
  const copied = await copyTextWithFallback(googleMapsUrl);

  const html = `
    <div class="popup emergency-location-popup">
      <h4>Emergency Location</h4>

      <div><strong>Using:</strong> ${source}</div>
      <div><strong>Coordinates:</strong> ${lat}, ${lng}</div>

      <div style="margin-top: 8px;">
        <strong>Status:</strong> ${copied ? 'Google Maps link copied.' : 'Could not auto-copy. Use the link below.'}
      </div>

      <div style="margin-top: 10px;">
        <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer">
          Open this location in Google Maps
        </a>
      </div>

      <div style="margin-top: 8px; word-break: break-all; font-size: 12px;">
        ${googleMapsUrl}
      </div>
    </div>
  `;

  // Close the Controls Panel //
  closePanel?.();

  L.popup()
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map);
}

copyGoogleMapsLinkBtn?.addEventListener('click', showShareLocationPopup);
  // ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Track Recorder (Start/Stop + Save), matches IDs: trackStartBtn, trackSaveBtn
// ---------------------------------------------------------------------------
const trackLayer = L.layerGroup().addTo(map);
let trackLine = L.polyline([], { color: '#ff00a8', weight: 3, opacity: 0.9 }).addTo(trackLayer);
let trackStartMarker = null;
let trackEndMarker = null;

let trackPoints = [];        // [{lat,lng,t,acc}]
let recording = false;
let recStartedAt = null;
let totalDistanceM = 0;

const btnStart = document.getElementById('trackStartBtn');
const btnSave  = document.getElementById('trackSaveBtn');

function distLL(a,b){ // meters (haversine)
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat = toRad(b.lat-a.lat), dLng = toRad(b.lng-a.lng);
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const q=s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function ensureStartMarker(latlng){
  if (!trackStartMarker) {
    trackStartMarker = L.circleMarker(latlng, { radius: 6, color: '#15b374', fillColor:'#15b374', fillOpacity: 0.9 })
      .bindTooltip('Start').addTo(trackLayer);
  }
}
function updateEndMarker(latlng){
  if (!trackEndMarker) {
    trackEndMarker = L.circleMarker(latlng, { radius: 6, color: '#c23b22', fillColor:'#c23b22', fillOpacity: 0.9 })
      .bindTooltip('End').addTo(trackLayer);
  } else {
    trackEndMarker.setLatLng(latlng);
  }
}
function enableSaveIfReady(){
  // enable when there’s something to save (>=2 points)
  if (btnSave) btnSave.disabled = trackPoints.length < 2;
}
function addTrackPoint(pt){
  const last = trackPoints[trackPoints.length-1];
  trackPoints.push(pt);
  trackLine.addLatLng([pt.lat, pt.lng]);
  if (last) totalDistanceM += distLL(last, pt);
  else ensureStartMarker([pt.lat, pt.lng]);
  updateEndMarker([pt.lat, pt.lng]);
  enableSaveIfReady();
}


// Called by geolocation watcher (see step #1)
function onGeoPosition(pos){
  if (!recording) return;
  const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  // Optional: ignore wild jumps (>200 m)
  const last = trackPoints[trackPoints.length-1];
  if (last && distLL(last, {lat,lng}) > 200) return;

  addTrackPoint({ lat, lng, t: Date.now(), acc });
}

function startRecording(){
  if (recording) return;
  recording = true;
  if (!recStartedAt) recStartedAt = new Date();
  if (!watching) startLocate();             // start GNSS if not already
  if (btnStart) btnStart.textContent = '■ Stop';
}
function stopRecording(){
  if (!recording) return;
  recording = false;
  if (btnStart) btnStart.textContent = '● Start';
  enableSaveIfReady(); // in case you stop before 2 pts, this will keep Save disabled
}
function saveTrackGPX(){
  if (trackPoints.length < 2) return;
  const name = `track_${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const trkpts = trackPoints.map(p =>
    `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
  ).join('');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OntarioTrails" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${name}</name><trkseg>${trkpts}</trkseg></trk>
</gpx>`;
  downloadText(`${name}.gpx`, gpx, 'application/gpx+xml');
}

btnStart?.addEventListener('click', () => {
  if (!recording) startRecording(); else stopRecording();
});
btnSave?.addEventListener('click', saveTrackGPX);

// Init button state (Save disabled until we have >=2 points)
enableSaveIfReady();

// ---------------------------------------------------------------------------
// Distance Measurement (temporary, click-to-add, low risk)
// Added April 4, 2026 
// ---------------------------------------------------------------------------
const measureLayer = L.layerGroup().addTo(map);        // current editable route
const plottedRoutesLayer = L.layerGroup().addTo(map);  // saved plotted routes
const serverRoutesLayer = L.layerGroup();              // auto-loaded routes
const importedRoutesLayer = L.layerGroup().addTo(map); // optional uploaded routes

let measureLine = L.polyline([], {
  color: '#1472ff',
  weight: 3,
  opacity: 0.9,
  dashArray: '8,6'
}).addTo(measureLayer);

let serverRoutes = [];
let importedRoutes = [];

const SERVER_ROUTE_STYLES = [
  { color: '#8b5cf6', dashArray: null },        // purple solid
  { color: '#10b981', dashArray: '10 6' },      // green dashed
  { color: '#ec4899', dashArray: '2 8' },       // pink dotted
  { color: '#14b8a6', dashArray: '14 6 2 6' },  // teal mixed
  { color: '#ef4444', dashArray: '6 6' },       // red dashed
  { color: '#6b7280', dashArray: '1 8' }        // slate dotted
];

function getServerRouteStyle(idx) {
  return SERVER_ROUTE_STYLES[idx % SERVER_ROUTE_STYLES.length];
}

const MEASURE_KEY = 'ontarioTrails.measure.v2';

const PLOTTED_ROUTES_KEY = 'ontarioTrails.plottedRoutes.v1';

function loadPlottedRoutesFromStorage() {
  try {
    const raw = localStorage.getItem(PLOTTED_ROUTES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr
          .map((route, idx) => ({
            id: route.id || `route-${Date.now()}-${idx}`,
            name: route.name || `Route ${idx + 1}`,
            createdAt: route.createdAt || new Date().toISOString(),
            lengthKm: Number(route.lengthKm),
            points: Array.isArray(route.points)
              ? route.points
                  .filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng))
                  .map(p => ({ lat: +p.lat, lng: +p.lng }))
              : []
          }))
          .filter(route => route.points.length >= 2)
      : [];
  } catch {
    return [];
  }
}

function savePlottedRoutesToStorage() {
  try {
    localStorage.setItem(PLOTTED_ROUTES_KEY, JSON.stringify(plottedRoutes));
  } catch {}
}

let plottedRoutes = loadPlottedRoutesFromStorage();

function loadMeasurementFromStorage() {
  try {
    const raw = localStorage.getItem(MEASURE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng))
      : [];
  } catch {
    return [];
  }
}

function saveMeasurementToStorage() {
  try {
    localStorage.setItem(MEASURE_KEY, JSON.stringify(measurePoints));
  } catch {}
}

function segmentDistanceMeters(a, b) {
  if (!a || !b) return 0;
  return map.distance([a.lat, a.lng], [b.lat, b.lng]);
}

function routeDistanceMeters(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += segmentDistanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function routeDistanceKm(points = []) {
  return routeDistanceMeters(points) / 1000;
}

function formatRouteLengthKm(lengthKm) {
  if (!Number.isFinite(lengthKm)) return '—';
  return `${lengthKm.toFixed(1)} km`;
}


function exportPlotRoute() {
  if (!plottedRoutes.length) {
    alert('No saved plotted routes to export. Save a route first.');
    return;
  }

  const payload = {
    version: 1,
    type: 'plotted-routes',
    exportedAt: new Date().toISOString(),
    routes: plottedRoutes.map(route => ({
      id: route.id,
      name: route.name,
      createdAt: route.createdAt,
      lengthKm: Number.isFinite(+route.lengthKm)
        ? +(+route.lengthKm).toFixed(2)
        : +routeDistanceKm(route.points).toFixed(2),
      points: route.points.map(p => ({
        lat: +p.lat,
        lng: +p.lng
      }))
    }))
  };

  const name = `plotted-routes_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  downloadText(name, JSON.stringify(payload, null, 2), 'application/json');
}

function defaultRouteName() {
  return `Route ${plottedRoutes.length + 1}`;
}

function saveCurrentPlottedRoute() {
  if (measurePoints.length < 2) return;

  const cleanName = String(routeNameInput?.value || '').trim();

  const route = {
    id: `plotted-route-${Date.now()}`,
    name: cleanName || defaultRouteName(),
    createdAt: new Date().toISOString(),
    type: 'plot-route',
    lengthKm: +routeDistanceKm(measurePoints).toFixed(2),
    points: measurePoints.map(p => ({
      lat: +p.lat,
      lng: +p.lng
    }))
  };

  plottedRoutes.push(route);
  savePlottedRoutesToStorage();

  // Clear the active editable route so the next route can be plotted.
  measurePoints = [];
  saveMeasurementToStorage();
  refreshMeasurement();

  if (routeNameInput) routeNameInput.value = '';

  renderPlottedRoutes();
  renderRouteList();
}

function deletePlottedRoute(id) {
  plottedRoutes = plottedRoutes.filter(route => route.id !== id);
  savePlottedRoutesToStorage();
  renderPlottedRoutes();
  renderRouteList();
}

function renderPlottedRoutes() {
  plottedRoutesLayer.clearLayers();

  plottedRoutes.forEach((route, idx) => {
    const pts = Array.isArray(route.points) ? route.points : [];
    if (pts.length < 2) return;

    const latlngs = pts.map(p => [p.lat, p.lng]);
    const lengthKm = Number.isFinite(+route.lengthKm)
      ? +route.lengthKm
      : routeDistanceKm(pts);

    const line = L.polyline(latlngs, {
      color: getServerRouteColor(idx),
      weight: 4,
      opacity: 0.9
    }).addTo(plottedRoutesLayer);

    line.bindPopup(
      `<b>${esc(route.name || `Route ${idx + 1}`)}</b><br>` +
      `${pts.length} point(s)<br>` +
      `Length: ${formatRouteLengthKm(lengthKm)}`
    );
  });
}

function renderRouteList() {
  if (!routeList) return;

  if (!plottedRoutes.length) {
    routeList.innerHTML = `<div class="empty" style="opacity:.8">No saved routes yet.</div>`;
    return;
  }

  const rows = plottedRoutes.map((route, idx) => {
    const pts = Array.isArray(route.points) ? route.points : [];
    const lengthKm = Number.isFinite(+route.lengthKm)
      ? +route.lengthKm
      : routeDistanceKm(pts);

    return `
      <div class="route-item" data-route-id="${esc(route.id)}">
        <div class="route-main" data-action="zoom-route" data-route-id="${esc(route.id)}">
          <div class="route-title">${esc(route.name || `Route ${idx + 1}`)}</div>
          <div class="route-meta">${pts.length} point(s) · ${formatRouteLengthKm(lengthKm)}</div>
        </div>

        <button class="route-del" data-action="delete-route" data-route-id="${esc(route.id)}" title="Delete route">
          🗑️
        </button>
      </div>
    `;
  }).join('');

  routeList.innerHTML = `<div class="route-list-wrap">${rows}</div>`;
}

function zoomToPlottedRoute(id) {
  const route = plottedRoutes.find(r => r.id === id);
  if (!route || !Array.isArray(route.points) || route.points.length < 2) return;

  const bounds = routeBoundsFromPoints(route.points);

  try {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
  } catch {}
}

async function importPlotRouteFromFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);

const incomingRoutes = Array.isArray(json?.routes)
  ? json.routes
  : [json];

let added = 0;

incomingRoutes.forEach((incoming, idx) => {
  const pts = Array.isArray(incoming?.points)
    ? incoming.points
        .filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng))
        .map(p => ({ lat: +p.lat, lng: +p.lng }))
    : [];

  if (pts.length < 2) return;

  const storedLengthKm = Number(incoming?.lengthKm);

  plottedRoutes.push({
    id: `imported-route-${Date.now()}-${idx}`,
    name:
      incoming.name ||
      file.name.replace(/\.[^.]+$/, '') ||
      `Imported Route ${plottedRoutes.length + 1}`,
    createdAt: incoming.createdAt || new Date().toISOString(),
    version: Number.isFinite(+incoming?.version) ? +incoming.version : 1,
    type: incoming?.type || 'plot-route',
    lengthKm: Number.isFinite(storedLengthKm) ? storedLengthKm : routeDistanceKm(pts),
    points: pts
  });

  added++;
});

if (!added) {
  alert('No valid route points found in file.');
  return;
}

savePlottedRoutesToStorage();
renderPlottedRoutes();
renderRouteList();
   

   } catch (err) {
    console.warn('Route import failed:', err);
    alert('Could not import route file.');
  }
}

let measureOn = false;
let measurePoints = loadMeasurementFromStorage();
let measureMarkers = [];

const measureToggleBtn = document.getElementById('measureToggleBtn');
const measureUndoBtn   = document.getElementById('measureUndoBtn');
const measureClearBtn  = document.getElementById('measureClearBtn');
const exportRouteBtn   = document.getElementById('exportRouteBtn');
const importRouteInput = document.getElementById('importRouteInput');
const measureStatus    = document.getElementById('measureStatus');

const routeNameInput   = document.getElementById('routeNameInput');
const saveRouteBtn     = document.getElementById('saveRouteBtn');
const routeList        = document.getElementById('routeList');

function formatMeasureDistance(m) {
  if (!Number.isFinite(m) || m <= 0) return '0.00 km';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

function updateMeasureStatus() {
  let totalM = 0;
  for (let i = 1; i < measurePoints.length; i++) {
    totalM += distLL(measurePoints[i - 1], measurePoints[i]);
  }

  if (measureStatus) {
    measureStatus.textContent = `${measurePoints.length} point${measurePoints.length === 1 ? '' : 's'} · ${formatMeasureDistance(totalM)}`;
  }

  if (saveRouteBtn) {
    saveRouteBtn.disabled = measurePoints.length < 2;
  }
}

// Redraw the route line and point markers based on measurePoints
function routeBoundsFromPoints(points) {
  return L.latLngBounds(points.map(p => [p.lat, p.lng]));
}

const SERVER_ROUTE_COLORS = [
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#10b981', // green
  '#ef4444', // red
  '#14b8a6', // teal
  '#a16207', // mustard/brown
  '#6b7280', // slate
  '#d946ef'  // magenta
];

function getServerRouteColor(idx) {
  return SERVER_ROUTE_COLORS[idx % SERVER_ROUTE_COLORS.length];
}

function renderServerRoutes() {
  serverRoutesLayer.clearLayers();

  serverRoutes.forEach((route, idx) => {
    const pts = Array.isArray(route?.points) ? route.points : [];
    if (!pts.length) return;

    const latlngs = pts.map(p => [p.lat, p.lng]);
    const style = getServerRouteStyle(idx);

    // White casing underneath to make overlaps stand out more clearly
    L.polyline(latlngs, {
      color: '#ffffff',
      weight: 5,
      opacity: 0.85
    }).addTo(serverRoutesLayer);

    // Main colored route on top
    const line = L.polyline(latlngs, {
      color: style.color,
      weight: 4,
      opacity: 0.95,
      dashArray: style.dashArray || null
    }).addTo(serverRoutesLayer);

    line.bindPopup(
      `<b>${esc(route.name || `Saved Route ${idx + 1}`)}</b><br>` +
      `${pts.length} point(s)` +
      (Number.isFinite(route?.lengthKm) ? `<br>Length: ${route.lengthKm.toFixed(1)} km` : '')
    );

    pts.forEach((p, pIdx) => {
      L.circleMarker([p.lat, p.lng], {
        radius: pIdx === 0 ? 5 : 4,
        color: style.color,
        fillColor: pIdx === 0 ? '#ffffff' : style.color,
        fillOpacity: 1,
        weight: 2
      })
      .bindTooltip(pIdx === 0 ? 'Start' : `Point ${pIdx + 1}`, {
        direction: 'top',
        offset: [0, -6]
      })
      .addTo(serverRoutesLayer);
    });
  });
}

function renderImportedRoutes() {
  importedRoutesLayer.clearLayers();

  importedRoutes.forEach((route, idx) => {
    const pts = Array.isArray(route?.points) ? route.points : [];
    if (!pts.length) return;

    const line = L.polyline(
      pts.map(p => [p.lat, p.lng]),
      {
        color: '#8b5cf6',
        weight: 4,
        opacity: 0.85
      }
    ).addTo(importedRoutesLayer);

if (route.name) {
  line.bindPopup(
    `<b>${esc(route.name)}</b><br>` +
    `${pts.length} point(s)<br>` +
    `Length: ${formatRouteLengthKm(route.lengthKm)}`
  );
} else {
  line.bindPopup(
    `<b>Imported Route ${idx + 1}</b><br>` +
    `${pts.length} point(s)<br>` +
    `Length: ${formatRouteLengthKm(route.lengthKm)}`
  );
}

    pts.forEach((p, pIdx) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 4,
        color: '#6d28d9',
        fillColor: '#8b5cf6',
        fillOpacity: 0.9
      })
      .bindTooltip(pIdx === 0 ? 'Start' : `Point ${pIdx + 1}`, {
        direction: 'top',
        offset: [0, -6]
      })
      .addTo(importedRoutesLayer);
    });
  });
}

function refreshMeasurement() {
  measureLayer.clearLayers();

  measureLine = L.polyline(
    measurePoints.map(p => [p.lat, p.lng]),
    {
      color: '#ff7a00',
      weight: 3,
      opacity: 0.9,
      dashArray: '8,6'
    }
  ).addTo(measureLayer);

  measureMarkers = measurePoints.map((p, idx) => {
    const marker = L.circleMarker([p.lat, p.lng], {
      radius: 5,
      color: '#CC5500',
      fillColor: '#ff7a00',
      fillOpacity: 0.95
    }).addTo(measureLayer);

    marker.bindTooltip(
      idx === 0 ? 'Start' : `Point ${idx + 1}`,
      { direction: 'top', offset: [0, -6] }
    );

    return marker;
  });

  updateMeasureStatus();
}

function clearMeasurement() {
  measurePoints = [];
  measureMarkers = [];
  saveMeasurementToStorage();
  refreshMeasurement();
}

function clearImportedRoutes() {
  importedRoutes = [];
  importedRoutesLayer.clearLayers();
}

function undoLastMeasurementPoint() {
  if (!measurePoints.length) return;
  measurePoints.pop();
  saveMeasurementToStorage();
  refreshMeasurement();
}

function toggleMeasurement() {
  measureOn = !measureOn;

  if (measureToggleBtn) {
    measureToggleBtn.textContent = measureOn ? '🧭 Route: On' : '🧭 Route: Off';
  }

  map.getContainer().style.cursor = measureOn ? 'crosshair' : '';

  // Force crosshair visible while routing, but restore normal checkbox behavior when off
  if (crosshairEl) {
    if (measureOn) {
      crosshairEl.style.display = 'block';
    } else if (showCrosshair) {
      crosshairEl.style.display = showCrosshair.checked ? 'block' : 'none';
    }
  }

  if (measureOn) {
    if (measureStatus && measurePoints.length === 0) {
      measureStatus.textContent = 'Route mode on · tap the map to add points';
    } else {
      updateMeasureStatus();
    }
  } else {
    updateMeasureStatus();
  }
}
// measurement listeners 
measureToggleBtn?.addEventListener('click', toggleMeasurement);
measureUndoBtn?.addEventListener('click', undoLastMeasurementPoint);

measureClearBtn?.addEventListener('click', () => {
  clearMeasurement();
});

saveRouteBtn?.addEventListener('click', saveCurrentPlottedRoute);
exportRouteBtn?.addEventListener('click', exportPlotRoute);

importRouteInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  await importPlotRouteFromFile(file);
  e.target.value = '';
});

routeList?.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.getAttribute('data-action');
  const id = actionEl.getAttribute('data-route-id');

  if (!id) return;

  if (action === 'delete-route') {
    deletePlottedRoute(id);
  }

  if (action === 'zoom-route') {
    zoomToPlottedRoute(id);
  }
});

// Add measurement points only when measurement mode is enabled
map.on('click', (e) => {
  if (!measureOn) return;

  measurePoints.push({
    lat: e.latlng.lat,
    lng: e.latlng.lng
  });

  saveMeasurementToStorage();
  refreshMeasurement();
});

// Initial status
// Initial status
refreshMeasurement();
renderPlottedRoutes();
renderRouteList();



  // ---------------------------------------------------------------------------
  // Contours (Esri Feature Layer) + Labels + Snap/Identify + Legend sync
  // ---------------------------------------------------------------------------
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

  // Haversine — meters between two lat/lngs (avoid name clash)
  function metersBetweenHaversine(a, b) {
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

  // Color ramp helpers for contours
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

  // Contour layers & labels
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
        layer.options.interactive = false; // let snap handler own clicks
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

  // Zoom hint + visibility gate
  function updateContourHint() {
    if (!contourHintEl) return;
    const z = map.getZoom();
    if (!showContours?.checked) {
      contourHintEl.innerHTML = `Enable <b>Elevation Contours</b> to view elevation lines`;
      return;
    }
    contourHintEl.innerHTML = (z >= CONTOUR_ZOOM_THRESHOLD)
      ? `Contours loaded (Current zoom ${z}).`
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

  // DEM identify (hover/click) fallback for elevations
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


  // ---------------------------------------------------------------------------
  // Persistent settings (localStorage)
  // ---------------------------------------------------------------------------
  const SETTINGS_KEY = 'ontarioTrails.settings.v1';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }
  const _settings = loadSettings();
  let _saveTimer = null;
  function setSetting(k, v) {
    _settings[k] = v;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveSettings(_settings), 150);
  }

  // Restore helpers
  function restoreCheckbox(idOrEl, onChange) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    const key = `ck:${el.id}`;
    if (_settings[key] !== undefined) el.checked = !!_settings[key];
    onChange?.(el.checked);
    el.addEventListener('change', () => setSetting(key, el.checked));
  }
  function restoreRange(idOrEl, applyFn /* number -> void */) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    const key = `rng:${el.id}`;
    if (_settings[key] !== undefined) el.value = String(_settings[key]);
    const apply = () => { applyFn(Number(el.value)); setSetting(key, Number(el.value)); };
    apply();
    el.addEventListener('input', apply);
  }

  // Persist map view (center/zoom)
  (function persistMapView(){
    const k = 'map:view';
    const mv = _settings[k];
    if (mv && Array.isArray(mv.center) && Number.isFinite(mv.zoom)) {
      try { map.setView(mv.center, mv.zoom); } catch {}
    }
    const saveView = () => setSetting(k, { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom() });
    map.on('moveend', saveView);
  })();

  // Apply to existing controls
  restoreCheckbox(showTrails, (on) => { on ? trailsLayer.addTo(map) : map.removeLayer(trailsLayer); });

    restoreCheckbox(showTrailsOSM, async (on) => {
    await ensureTrailsOSMLoaded();

    if (on) {
      trailsOSMLayer.addTo(map);
    } else {
      map.removeLayer(trailsOSMLayer);
    }
  });

  restoreCheckbox(showStocked, async (on) => { 
    if (on) { await ensureStockedLoaded(); if (stockedLoaded) stockedLayer.addTo(map); else showStocked.checked = false; }
    else map.removeLayer(stockedLayer);
  });

  restoreCheckbox(showAccess, async (on) => {
    if (on) { await ensureAccessLoaded(); if (accessLoaded) accessLayer.addTo(map); else showAccess.checked = false; }
    else map.removeLayer(accessLayer);
  });

  restoreCheckbox(showContours, (on) => { /* visibility managed below */ 
    if (on) { /* ensure it reacts immediately */ }
    updateContourVisibility();
  });

  //restoreCheckbox(showBaseCk, (on) => { on ? base.addTo(map) : map.removeLayer(base); });

  restoreCheckbox(showServerRoutesCk, (on) => {
  on ? serverRoutesLayer.addTo(map) : map.removeLayer(serverRoutesLayer);
});

  restoreCheckbox(showCrosshair, () => updateCrosshair());

  restoreCheckbox(showOfflineAreasCk, () => renderOfflineAreas());
  restoreCheckbox(settingAutoLoadOsmAfterSearch);

  restoreCheckbox(showImagery, (on) => { on ? imagery.addTo(map) : map.removeLayer(imagery); });

  // CLUPA family (if present in HTML)

  // Grab the new master checkbox (keep the old two if they still exist)
const showCLUPA = document.getElementById('showCLUPA');

showCLUPA?.addEventListener('change', () => setClupaAll(showCLUPA.checked));
if (showCLUPA) restoreCheckbox(showCLUPA, (on) => setClupaAll(on));


  //restoreCheckbox('showCLUPAProv',   (on) => setClupaProv(on));
  //restoreCheckbox('showCLUPAOverlay', (on) => setClupaOverlay(on));


  // Optional (commented): Parks/Reserves/Canada Lands
  // restoreCheckbox('showProvParks',   (on) => { if (typeof provParks    !== 'undefined') on ? provParks.addTo(map)    : map.removeLayer(provParks); });
  // restoreCheckbox('showConsRes',     (on) => { if (typeof consRes      !== 'undefined') on ? consRes.addTo(map)      : map.removeLayer(consRes); });
  // restoreCheckbox('showCanadaLands', (on) => { if (typeof canadaLands  !== 'undefined') on ? canadaLands.addTo(map)  : map.removeLayer(canadaLands); });

  // Imagery blend slider
  restoreRange('imageryOpacity', (v) => setImageryOpacity(Number.isFinite(v) ? v : 100));


  // ---------------------------------------------------------------------------
  // Contour snap-to-nearest + DEM identify on click/hover
  // ---------------------------------------------------------------------------
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

  // Initial state
  updateContourVisibility(); // initial
  toggleAccess();           // initial
  toggleStocked();          // initial
  initServerRoutes();       // initial (also sets pins visibility based on checkbox)
  showPinsCk?.addEventListener('change', () => {
    showPinsCk.checked ? pinsLayer.addTo(map) : map.removeLayer(pinsLayer);
    
  });

showServerRoutesCk?.addEventListener('change', () => {
  showServerRoutesCk.checked
    ? serverRoutesLayer.addTo(map)
    : map.removeLayer(serverRoutesLayer);
});

// ---------------------------------------------------------------------------
// Utility Tabs: Settings, Emergency, Compass, Layer Health
// ---------------------------------------------------------------------------

const settingOfflinePreview = document.getElementById('settingOfflinePreview');
const settingFieldMode = document.getElementById('settingFieldMode');
const settingKeepAwake = document.getElementById('settingKeepAwake');
const settingsOfflineStatus = document.getElementById('settingsOfflineStatus');

const emergencyCoords = document.getElementById('emergencyCoords');
const emergencyAccuracy = document.getElementById('emergencyAccuracy');
const emergencyUpdated = document.getElementById('emergencyUpdated');
const emergencyMapCenter = document.getElementById('emergencyMapCenter');
const copyEmergencyBtn = document.getElementById('copyEmergencyBtn');
const refreshEmergencyBtn = document.getElementById('refreshEmergencyBtn');

const enableCompassBtn = document.getElementById('enableCompassBtn');
const compassNeedle = document.getElementById('compassNeedle');
const compassHeading = document.getElementById('compassHeading');
const compassDirection = document.getElementById('compassDirection');

const layerHealthStatus = document.getElementById('layerHealthStatus');
const refreshLayerHealthBtn = document.getElementById('refreshLayerHealthBtn');
const loadAllLayersBtn = document.getElementById('loadAllLayersBtn');
const UTILITY_SETTINGS_KEY = 'ontarioTrails.utilitySettings.v1';

let wakeLock = null;
let compassEnabled = false;

function loadUtilitySettings() {
  try {
    return JSON.parse(localStorage.getItem(UTILITY_SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveUtilitySettings() {
  const s = {
    offlinePreview: !!settingOfflinePreview?.checked,
    fieldMode: !!settingFieldMode?.checked,
    keepAwake: !!settingKeepAwake?.checked
  };

  try {
    localStorage.setItem(UTILITY_SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

function restoreUtilitySettings() {
  const s = loadUtilitySettings();

  if (settingOfflinePreview) settingOfflinePreview.checked = !!s.offlinePreview;
  if (settingFieldMode) settingFieldMode.checked = !!s.fieldMode;
  if (settingKeepAwake) settingKeepAwake.checked = !!s.keepAwake;

  applyFieldMode();
  applyWakeLock();
  updateOfflineStatus();
}

function applyFieldMode() {
  const on = !!settingFieldMode?.checked;

  document.body.classList.toggle('field-mode', on);

  // Optional conservative defaults for field mode.
  // Keep these mild so the user does not feel like the app changed unexpectedly.
  if (on) {
    if (showCrosshair && !showCrosshair.checked) {
      showCrosshair.checked = true;
      updateCrosshair?.();
    }
  }
}

async function applyWakeLock() {
  const wantsWake = !!settingKeepAwake?.checked;

  if (!wantsWake) {
    try {
      await wakeLock?.release?.();
    } catch {}
    wakeLock = null;
    return;
  }

  if (!('wakeLock' in navigator)) {
    if (settingsOfflineStatus) {
      settingsOfflineStatus.innerHTML = `<div class="status-item"><strong>Keep screen awake</strong><span class="status-warn">Not supported</span></div>`;
    }
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake Lock failed:', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && settingKeepAwake?.checked) {
    applyWakeLock();
  }
});

settingOfflinePreview?.addEventListener('change', () => {
  saveUtilitySettings();
  updateOfflineStatus();
});

settingFieldMode?.addEventListener('change', () => {
  saveUtilitySettings();
  applyFieldMode();
});

settingKeepAwake?.addEventListener('change', () => {
  saveUtilitySettings();
  applyWakeLock();
});

function formatLatLng(lat, lng) {
  if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return '—';
  return `${(+lat).toFixed(6)}, ${(+lng).toFixed(6)}`;
}

function formatTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function updateEmergencyInfo() {
  const c = map.getCenter();

  if (emergencyMapCenter) {
    emergencyMapCenter.textContent = formatLatLng(c.lat, c.lng);
  }

  if (lastGeoFix) {
    if (emergencyCoords) {
      emergencyCoords.textContent = formatLatLng(lastGeoFix.lat, lastGeoFix.lng);
    }

    if (emergencyAccuracy) {
      emergencyAccuracy.textContent = Number.isFinite(+lastGeoFix.accuracy)
        ? `±${Math.round(+lastGeoFix.accuracy)} m`
        : '—';
    }

    if (emergencyUpdated) {
      emergencyUpdated.textContent = formatTime(lastGeoFix.timestamp);
    }
  } else {
    if (emergencyCoords) emergencyCoords.textContent = 'No GPS fix yet';
    if (emergencyAccuracy) emergencyAccuracy.textContent = '—';
    if (emergencyUpdated) emergencyUpdated.textContent = '—';
  }
}

map.on('moveend', updateEmergencyInfo);

refreshEmergencyBtn?.addEventListener('click', updateEmergencyInfo);

copyEmergencyBtn?.addEventListener('click', async () => {
  updateEmergencyInfo();

  const c = map.getCenter();

  const lines = [
    'Emergency location information',
    '',
    lastGeoFix
      ? `Last GPS location: ${formatLatLng(lastGeoFix.lat, lastGeoFix.lng)}`
      : 'Last GPS location: unavailable',
    lastGeoFix && Number.isFinite(+lastGeoFix.accuracy)
      ? `GPS accuracy: ±${Math.round(+lastGeoFix.accuracy)} m`
      : 'GPS accuracy: unavailable',
    lastGeoFix
      ? `Last GPS update: ${formatTime(lastGeoFix.timestamp)}`
      : 'Last GPS update: unavailable',
    `Map centre: ${formatLatLng(c.lat, c.lng)}`
  ];

  const text = lines.join('\n');

  try {
    await navigator.clipboard.writeText(text);
    if (copyEmergencyBtn) copyEmergencyBtn.textContent = 'Copied';
    setTimeout(() => {
      if (copyEmergencyBtn) copyEmergencyBtn.textContent = 'Copy emergency info';
    }, 1200);
  } catch {
    alert(text);
  }
});

function headingToCardinal(deg) {
  if (!Number.isFinite(+deg)) return '—';

  const dirs = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW'
  ];

  const idx = Math.round(((+deg % 360) / 22.5)) % 16;
  return dirs[idx];
}

function updateCompass(heading) {
  if (!Number.isFinite(+heading)) return;

  const h = ((+heading % 360) + 360) % 360;

  if (compassNeedle) {
    compassNeedle.style.transform = `translate(-50%, -100%) rotate(${h}deg)`;
  }

  if (compassHeading) {
    compassHeading.textContent = `${Math.round(h)}°`;
  }

  if (compassDirection) {
    compassDirection.textContent = headingToCardinal(h);
  }
}

function handleDeviceOrientation(event) {
  // iOS Safari may expose webkitCompassHeading. Other browsers often use alpha.
  const heading = Number.isFinite(event.webkitCompassHeading)
    ? event.webkitCompassHeading
    : Number.isFinite(event.alpha)
      ? 360 - event.alpha
      : null;

  if (heading == null) return;
  updateCompass(heading);
}

async function enableCompass() {
  if (compassEnabled) return;

  try {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        if (compassHeading) compassHeading.textContent = 'Compass permission denied';
        return;
      }
    }

    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
    compassEnabled = true;

    if (enableCompassBtn) enableCompassBtn.textContent = 'Compass enabled';
    if (compassHeading) compassHeading.textContent = 'Move device to calibrate';
  } catch (err) {
    console.warn('Compass failed:', err);
    if (compassHeading) compassHeading.textContent = 'Compass unavailable';
  }
}

enableCompassBtn?.addEventListener('click', enableCompass);

async function hasCache(name) {
  if (!('caches' in window)) return false;
  const names = await caches.keys();
  return names.includes(name);
}

async function checkOfflineDataFiles() {
  if (!('caches' in window)) return null;

  // OSM trails are intentionally excluded here.
  // They are tracked separately through localStorage / Overpass cache health.
  const expected = [
    {
      key: 'otn',
      label: 'OTN trails static data',
      urls: ['./data/OTN.geojson', '/data/OTN.geojson']
    },
    {
      key: 'stocked',
      label: 'Stocked lakes static data',
      urls: ['./data/Fish_Stocking_Data.geojson', '/data/Fish_Stocking_Data.geojson']
    },
    {
      key: 'access',
      label: 'Water access static data',
      urls: ['./data/Fishing_Access_Point.geojson', '/data/Fishing_Access_Point.geojson']
    }
  ];

  try {
    const cache = await caches.open(OFFLINE_DATA_CACHE);

    const files = [];

    for (const item of expected) {
      let cached = false;

      for (const url of item.urls) {
        const match = await cache.match(url, { ignoreVary: true });
        if (match) {
          cached = true;
          break;
        }
      }

      files.push({
        key: item.key,
        label: item.label,
        cached
      });
    }

    const found = files.filter(f => f.cached).length;

    return {
      found,
      total: expected.length,
      files
    };
  } catch {
    return null;
  }
}

async function countCacheItems(name) {
  if (!('caches' in window)) return null;

  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    return keys.length;
  } catch {
    return null;
  }
}

function layerIsOn(layer) {
  try {
    return !!layer && map.hasLayer(layer);
  } catch {
    return false;
  }
}

function featureCount(layer) {
  try {
    if (!layer?.getLayers) return null;
    return layer.getLayers().length;
  } catch {
    return null;
  }
}

function statusRow(label, value, cls = 'status-ok') {
  return `<div class="status-item"><strong>${label}</strong><span class="${cls}">${value}</span></div>`;
}
function getOsmTrailCacheHealth() {
  const summary =
    typeof osmTrailCacheSummary === 'function'
      ? osmTrailCacheSummary()
      : { total: 0, named: 0, unnamed: 0 };

  const areas =
    typeof loadOsmTrailAreas === 'function'
      ? loadOsmTrailAreas()
      : [];

  let lastLoaded = null;

  areas.forEach(area => {
    const t = area?.createdAt ? new Date(area.createdAt).getTime() : NaN;
    if (Number.isFinite(t) && (!lastLoaded || t > lastLoaded)) {
      lastLoaded = t;
    }
  });

  return {
    ...summary,
    areaCount: areas.length,
    lastLoaded
  };
}

function formatOsmTrailCacheDate(ts) {
  if (!ts) return 'Never';

  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'Unknown';
  }
}

function clearOsmTrailCache() {
  const ok = confirm(
    'Clear all cached OSM trails? This will remove locally stored Overpass trail data, but will not affect pins, routes, basemap tiles, or satellite imagery.'
  );

  if (!ok) return;

  try {
    localStorage.removeItem(OSM_TRAILS_CACHE_KEY);
    localStorage.removeItem(OSM_TRAILS_AREAS_KEY);
  } catch {}

  if (Array.isArray(osmTrailFeatures)) {
    osmTrailFeatures = [];
  }

   try {
    trailsOSMVisualLayer?.clearLayers?.();
    trailsOSMHitLayer?.clearLayers?.();
  } catch {}

  try {
    updateOsmTrailStatusIdle?.();
  } catch {}

  try {
    updateLayerHealth?.();
  } catch {}
}

function ensureOsmTrailHealthActions() {
  if (!layerHealthStatus) return;

  let wrap = document.getElementById('osmTrailHealthActions');

  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'osmTrailHealthActions';
    wrap.className = 'row';
    wrap.style.marginTop = '8px';

    const btn = document.createElement('button');
    btn.id = 'clearOsmTrailCacheBtn';
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Clear OSM trail cache';

    btn.addEventListener('click', clearOsmTrailCache);

    wrap.appendChild(btn);
    layerHealthStatus.insertAdjacentElement('afterend', wrap);
  }
}

async function updateOfflineStatus() {
  if (!settingsOfflineStatus) return;

  const offlinePreview = !!settingOfflinePreview?.checked;

  const appVersion = window.ONTARIO_TRAILS_VERSION || window.APP_VERSION || 'dev';
  const appCached = await hasCache(`ontario-trails-static-${appVersion}`);

  const dataCached = await hasCache(OFFLINE_DATA_CACHE);
  const offlineDataFiles = await checkOfflineDataFiles();
  const imageryCount = getStoredOfflineTileCount();

  const rows = [];

  rows.push(statusRow(
    'Offline Preview',
    offlinePreview ? 'On' : 'Off',
    offlinePreview ? 'status-warn' : 'status-ok'
  ));

  rows.push(statusRow(
    'App shell cache',
    appCached ? 'Available' : 'Not detected',
    appCached ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'Data cache',
    dataCached ? 'Available' : 'Not detected',
    dataCached ? 'status-ok' : 'status-warn'
  ));

rows.push(statusRow(
  'Offline imagery tiles',
  imageryCount > 0 ? `${imageryCount} in saved area metadata` : 'No saved areas',
  imageryCount > 0 ? 'status-ok' : 'status-warn'
));

  rows.push(statusRow(
    'Search / geocoding',
    offlinePreview ? 'Internet required' : 'Available when online',
    offlinePreview ? 'status-warn' : 'status-ok'
  ));

  settingsOfflineStatus.innerHTML = rows.join('');
}

async function updateLayerHealth() {
  if (!layerHealthStatus) return;

  const rows = [];

  const trailsCount =
    featureCount(typeof trailsVisualLayer !== 'undefined' ? trailsVisualLayer : null) ??
    featureCount(typeof trailsLayer !== 'undefined' ? trailsLayer : null);

  const osmTrailsCount =
    featureCount(typeof trailsOSMVisualLayer !== 'undefined' ? trailsOSMVisualLayer : null);

  const osmHealth = getOsmTrailCacheHealth();

  const stockedCount =
    featureCount(typeof stockedLayer !== 'undefined' ? stockedLayer : null);

  const accessCount =
    featureCount(typeof accessLayer !== 'undefined' ? accessLayer : null);


    const imageryCached = getStoredOfflineTileCount();

const dataCached = await countCacheItems(OFFLINE_DATA_CACHE);
const offlineDataFiles = await checkOfflineDataFiles();

  rows.push(statusRow(
    'Satellite imagery layer',
    layerIsOn(imagery) ? 'On' : 'Off',
    layerIsOn(imagery) ? 'status-ok' : 'status-warn'
  ));

rows.push(statusRow(
  'Offline imagery cache',
  imageryCached > 0 ? `${imageryCached} tile(s) in saved area metadata` : 'No saved areas',
  imageryCached > 0 ? 'status-ok' : 'status-warn'
));

  rows.push(statusRow(
    'OTN trails layer',
    trailsCount && trailsCount > 0 ? `${trailsCount} feature layer(s)` : 'Not loaded yet',
    trailsCount && trailsCount > 0 ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'OSM trails layer',
    layerIsOn(trailsOSMLayer) ? 'On' : 'Off',
    layerIsOn(trailsOSMLayer) ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'OSM trail cache',
    osmHealth.total > 0 ? `${osmHealth.total} segment(s)` : 'Empty',
    osmHealth.total > 0 ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'OSM named trails',
    `${osmHealth.named} named / ${osmHealth.unnamed} unnamed`,
    osmHealth.total > 0 ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'OSM loaded areas',
    osmHealth.areaCount > 0 ? `${osmHealth.areaCount} area(s)` : 'None',
    osmHealth.areaCount > 0 ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'OSM last loaded',
    formatOsmTrailCacheDate(osmHealth.lastLoaded),
    osmHealth.lastLoaded ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'Stocked lakes',
    stockedCount && stockedCount > 0 ? `${stockedCount} feature(s)` : 'Not loaded yet',
    stockedCount && stockedCount > 0 ? 'status-ok' : 'status-warn'
  ));

  rows.push(statusRow(
    'Water access points',
    accessCount && accessCount > 0 ? `${accessCount} feature(s)` : 'Not loaded yet',
    accessCount && accessCount > 0 ? 'status-ok' : 'status-warn'
  ));

if (offlineDataFiles?.files?.length) {
  offlineDataFiles.files.forEach(file => {
    rows.push(statusRow(
      file.label,
      file.cached ? 'Cached' : 'Not cached',
      file.cached ? 'status-ok' : 'status-warn'
    ));
  });
} else {
  rows.push(statusRow(
    'Offline data files',
    'Unknown',
    'status-warn'
  ));
}

  rows.push(statusRow(
    'Current map zoom',
    `Z${map.getZoom()}`,
    'status-ok'
  ));

  rows.push(statusRow(
    'Last checked',
    new Date().toLocaleTimeString(),
    'status-ok'
  ));

  layerHealthStatus.innerHTML = rows.join('');
  ensureOsmTrailHealthActions();

}

async function loadAllLayersForHealth() {
  if (loadAllLayersBtn) {
    loadAllLayersBtn.disabled = true;
    loadAllLayersBtn.textContent = 'Loading…';
  }

  try {
    // OTN trails are already loaded at startup.
    // Do not force showTrails checked and do not add/remove the layer.

    // OSM trails are lazy-loaded.
    try {
      await ensureTrailsOSMLoaded();
    } catch (err) {
      console.warn('Could not load OSM trails:', err);
    }

    // Stocked lakes are lazy-loaded.
    try {
      await ensureStockedLoaded();
    } catch (err) {
      console.warn('Could not load stocked lakes:', err);
    }

    // Water access points are lazy-loaded.
    try {
      await ensureAccessLoaded();
    } catch (err) {
      console.warn('Could not load water access points:', err);
    }

    // Stored routes are loaded from ./data/routes/routes.json.
    // initServerRoutes currently also applies visibility based on showServerRoutesCk,
    // so only call it if routes have not already been loaded.
    try {
      if (!serverRoutes.length) await initServerRoutes();
    } catch (err) {
      console.warn('Could not load stored routes:', err);
    }

    await updateLayerHealth();
    await updateOfflineStatus?.();

  } finally {
    if (loadAllLayersBtn) {
      loadAllLayersBtn.disabled = false;
      loadAllLayersBtn.textContent = 'Load all';
    }
  }
}

// wiring 
refreshLayerHealthBtn?.addEventListener('click', updateLayerHealth);
loadAllLayersBtn?.addEventListener('click', loadAllLayersForHealth);

map.on('layeradd layerremove', () => {
  if (panel?.classList.contains('utility-tabs-mode')) {
    updateLayerHealth();
    updateOfflineStatus();
  }
});

map.on('zoomend', () => {
  if (panel?.classList.contains('utility-tabs-mode') && document.getElementById('tab-health')?.classList.contains('active')) {
    updateLayerHealth();
  }
});

restoreUtilitySettings();
updateEmergencyInfo();
