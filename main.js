import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SunCalc from 'suncalc';

// ============================================
// CONFIGURATION
// ============================================
const LONDON_CENTER = [-0.1279, 51.5076];
const LONDON_LAT = 51.5076;
const LONDON_LON = -0.1279;

// ============================================
// GLOBAL STATE
let activePopup = null;
let activeLoaders = new Set();

const LOADER_LABELS = {
  'crime': '🚨 Crime',
  'air': '🌫️ Air Quality',
  'transport': '🚇 Transport'
};

function updateToastText() {
  const toast = document.getElementById('loading-toast');
  if (!toast) return;

  if (activeLoaders.size === 0) {
    toast.classList.add('hidden');
  } else {
    const labels = Array.from(activeLoaders).map(id => LOADER_LABELS[id] || id);
    toast.textContent = `Loading ${labels.join(', ')}...`;
    toast.classList.remove('hidden');
  }
}

function showToast(id) {
  activeLoaders.add(id);
  updateToastText();
}

function hideToast(id) {
  activeLoaders.delete(id);
  updateToastText();
}

// ============================================
// 1. MAP INITIALIZATION
// ============================================
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: LONDON_CENTER,
  zoom: 15.5,
  pitch: 60,
  bearing: -17.6,
  antialias: true,
  maxPitch: 70,
  minZoom: 10,
  maxZoom: 19
});

// Controls
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

// ============================================
// MAP LOAD EVENT
// ============================================
map.on('load', () => {
  console.log('🗺️ Map loaded successfully!');
  
  add3DBuildings();
  initSunlightAnalyzer();
  initPropertyViewer();
  initCrimeHeatmap();
  initAirQuality();
  initTransport();
  
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 500);
});

// ============================================
// 3D BUILDINGS LAYER
// ============================================
function add3DBuildings() {
  const layers = map.getStyle().layers;
  let labelLayerId;
  for (const layer of layers) {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      labelLayerId = layer.id;
      break;
    }
  }

  if (map.getSource('openmaptiles') || map.getSource('composite')) {
    const source = map.getSource('openmaptiles') ? 'openmaptiles' : 'composite';
    
    map.addLayer({
      id: '3d-buildings',
      source: source,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
          0, '#e8e4df',
          20, '#f0ece7',
          50, '#f5f3f0',
          100, '#faf9f7',
          150, '#ffffff'
        ],
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'render_height'],
          ['get', 'height'],
          ['*', ['coalesce', ['get', 'levels'], 3], 3.5],
          12
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 16, 0.85]
      }
    }, labelLayerId);
    
    console.log('🏢 3D buildings layer added');
  }
}

// ============================================
// 3. SUNLIGHT ANALYZER (SunCalc)
// ============================================
function initSunlightAnalyzer() {
  const slider = document.getElementById('time-slider');
  const timeDisplay = document.getElementById('time-display');
  const realtimeToggle = document.getElementById('toggle-realtime');

  if (!slider || !timeDisplay || !realtimeToggle) return;

  let updateInterval = null;

  // Helper: Sync to Real Time
  const syncToNow = () => {
    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);
    // Clamp between slider bounds (5 and 21)
    const clampedHour = Math.max(5, Math.min(21, currentHour));

    slider.value = clampedHour;
    updateSunPosition(clampedHour);

    const hours = Math.floor(clampedHour);
    const mins = Math.floor((clampedHour % 1) * 60);
    timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // 1. Toggle "Now" Mode
  realtimeToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      syncToNow();
      updateInterval = setInterval(syncToNow, 60000); // Update every minute
    } else {
      if (updateInterval) clearInterval(updateInterval);
      updateInterval = null;
    }
  });

  // 2. Slider Interaction
  slider.addEventListener('input', (e) => {
    // If user moves slider, disable standard "Now" mode
    if (realtimeToggle.checked) {
      realtimeToggle.checked = false;
      if (updateInterval) clearInterval(updateInterval);
      updateInterval = null;
    }

    const hour = parseFloat(e.target.value);
    updateSunPosition(hour);

    const hours = Math.floor(hour);
    const mins = Math.floor((hour % 1) * 60);
    timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  });

  // Initial Load: Default to "Now"
  syncToNow();
  realtimeToggle.checked = true;
  updateInterval = setInterval(syncToNow, 60000);

  console.log(`☀️ Sunlight analyzer initialized (Realtime Mode: ON)`);
}

function updateSunPosition(hour) {
  const date = new Date();
  date.setHours(Math.floor(hour), Math.floor((hour % 1) * 60), 0);
  
  const sunPos = SunCalc.getPosition(date, LONDON_LAT, LONDON_LON);
  
  // Convert sun position to light position
  // MapLibre light position: [radial, azimuthal, polar] in degrees
  const azimuth = (sunPos.azimuth * 180 / Math.PI) + 180; // Convert to degrees, flip
  const altitude = Math.max(0, sunPos.altitude * 180 / Math.PI); // Convert to degrees
  
  // Calculate intensity based on sun altitude
  // Boost minimum intensity at night (0.25) so buildings remain visible
  const intensity = Math.max(0.25, Math.min(0.6, altitude / 90));
  
  // Update light
  map.setLight({
    anchor: 'map',
    color: getSunColor(hour),
    intensity: intensity,
    position: [1.5, azimuth, 90 - altitude]
  });

  // Update Water Color (Dynamic)
  if (map.getLayer('water')) {
    const isNight = hour < 6 || hour > 20;
    const isDawnDusk = (hour >= 6 && hour < 8) || (hour >= 18 && hour <= 20);
    
    let waterColor = '#234b6e'; // Default Day (Steel Blue)
    if (isNight) waterColor = '#050a15'; // Deep Night
    if (isDawnDusk) waterColor = '#1a3350'; // Transition
    
    map.setPaintProperty('water', 'fill-color', waterColor);
  }
  
  // Update sky color
  document.body.style.setProperty('--sky-color', getSkyColor(hour));
}

function getSunColor(hour) {
  if (hour < 6 || hour > 20) return '#a5b4fc'; // Night - moonlight blue
  if (hour < 8) return '#d4dfff'; // Dawn - cool white
  if (hour < 18) return '#ffffff'; // Day - white
  return '#d4dfff'; // Dusk - cool white
}

function getSkyColor(hour) {
  if (hour < 6 || hour > 20) return '#0a0a1a';
  if (hour < 8) return '#2c3e50'; // Dawn - dark steel
  if (hour < 18) return '#87ceeb';
  return '#2c3e50'; // Dusk - dark steel
}

// ============================================
// 2. PROPERTY VIEWER (HM Land Registry)
// ============================================
function initPropertyViewer() {
  map.on('click', async (e) => {
    // Check if property viewer is enabled
    if (!document.getElementById('toggle-property')?.checked) return;
    
    const { lng, lat } = e.lngLat;
    
    // Close any existing popup
    if (activePopup) activePopup.remove();

    // Show loading popup
    activePopup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px'
    })
      .setLngLat([lng, lat])
      .setHTML('<div class="popup-loading">🔍 Searching sales data...</div>')
      .addTo(map);
    
    // Add event listener to nullify on close
    activePopup.on('close', () => { activePopup = null; });

    try {
      // Step 1: Get postcode from coordinates
      const postcodeRes = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`);
      const postcodeData = await postcodeRes.json();
      
      if (!postcodeData.result || postcodeData.result.length === 0) {
        activePopup.setHTML('<div class="popup-error">❌ No postcode found for this location</div>');
        return;
      }
      
      const postcode = postcodeData.result[0].postcode;
      const lsoa = postcodeData.result[0].lsoa || postcodeData.result[0].codes?.lsoa;
      const adminDistrict = postcodeData.result[0].admin_district;
      
      // Step 2: Query Land Registry
      const sales = await fetchLandRegistryData(postcode);
      
      if (sales.length === 0) {
        activePopup.setHTML(`<div class="popup-content">
          <h3>📍 ${postcode}</h3>
          <p>No recent sales found in this area.</p>
          <div class="popup-section">
            <h4>📊 Demographics (Census 2021)</h4>
            <p><strong>District:</strong> ${adminDistrict}</p>
            <p><strong>Census Area:</strong> ${lsoa || 'N/A'}</p>
            ${lsoa ? `<a href="https://www.nomisweb.co.uk/reports/localarea?compare=${lsoa}" target="_blank" class="census-link">📊 View 2021 Census Profile</a>` : ''}
          </div>
        </div>`);
        return;
      }
      
      // Step 3: Display results
      const salesHtml = sales.slice(0, 5).map(sale => `
        <div class="sale-item">
          <span class="sale-address">${sale.address}</span>
          <span class="sale-price">£${Number(sale.price).toLocaleString()}</span>
          <span class="sale-date">${new Date(sale.date).toLocaleDateString('en-GB')}</span>
        </div>
      `).join('');
      
      activePopup.setHTML(`
        <div class="popup-content">
          <h3>📍 ${postcode}</h3>
          <p class="popup-subtitle">Recent Property Sales</p>
          ${salesHtml}
          <div class="popup-section">
            <h4>📊 Demographics (Census 2021)</h4>
            <p><strong>District:</strong> ${adminDistrict}</p>
            <p><strong>Census Area:</strong> ${lsoa || 'N/A'}</p>
            ${lsoa ? `<a href="https://www.nomisweb.co.uk/reports/localarea?compare=${lsoa}" target="_blank" class="census-link">📊 View 2021 Census Profile</a>` : ''}
          </div>
          <p class="popup-source">Source: HM Land Registry & ONS</p>
        </div>
      `);
      
    } catch (err) {
      console.error('Property lookup error:', err);
      activePopup.setHTML('<div class="popup-error">❌ Error fetching data</div>');
    }
  });
  
  console.log('🏠 Property viewer initialized');
}

async function fetchLandRegistryData(postcode) {
  const sparqlQuery = `
    PREFIX ppi: <http://landregistry.data.gov.uk/def/ppi/>
    PREFIX common: <http://landregistry.data.gov.uk/def/common/>
    
    SELECT ?amount ?date ?paon ?saon ?street WHERE {
      ?tx ppi:pricePaid ?amount ;
          ppi:transactionDate ?date ;
          ppi:propertyAddress ?addr .
      ?addr common:postcode "${postcode}" ;
            common:street ?street .
      OPTIONAL { ?addr common:paon ?paon }
      OPTIONAL { ?addr common:saon ?saon }
    }
    ORDER BY DESC(?date)
    LIMIT 10
  `;
  
  const url = `https://landregistry.data.gov.uk/landregistry/query?query=${encodeURIComponent(sparqlQuery)}&output=json`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    return data.results.bindings.map(b => ({
      price: b.amount?.value || 0,
      date: b.date?.value || '',
      address: [b.saon?.value, b.paon?.value, b.street?.value].filter(Boolean).join(', ')
    }));
  } catch (err) {
    console.error('SPARQL query failed:', err);
    return [];
  }
}

// ============================================
// 3. CRIME HEATMAP (data.police.uk)
// ============================================
let crimeData = null;

function initCrimeHeatmap() {
  const toggle = document.getElementById('toggle-crime');
  if (!toggle) return;
  
  toggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      await loadCrimeData();
      map.on('moveend', loadCrimeData);
    } else {
      map.off('moveend', loadCrimeData);
      if (map.getLayer('crime-heat')) {
        map.setLayoutProperty('crime-heat', 'visibility', 'none');
      }
    }
  });
  
  console.log('🚨 Crime heatmap initialized');
}

async function loadCrimeData() {
  const center = map.getCenter();
  showToast('crime');
  
  try {
    const res = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${center.lat}&lng=${center.lng}`);
    const crimes = await res.json();
    hideToast('crime');
    
    // Convert to GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: crimes.map(c => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(c.location.longitude), parseFloat(c.location.latitude)]
        },
        properties: { category: c.category }
      }))
    };
    
    // Add or update source
    if (map.getSource('crime-data')) {
      map.getSource('crime-data').setData(geojson);
    } else {
      map.addSource('crime-data', { type: 'geojson', data: geojson });
      
      map.addLayer({
        id: 'crime-heat',
        type: 'heatmap',
        source: 'crime-data',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0, 0, 255, 0)',
            0.2, 'rgb(0, 255, 255)',
            0.4, 'rgb(0, 255, 0)',
            0.6, 'rgb(255, 255, 0)',
            0.8, 'rgb(255, 165, 0)',
            1, 'rgb(255, 0, 0)'
          ],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 15, 15, 30],
          'heatmap-opacity': 0.7
        }
      }, '3d-buildings');
    }
    
    map.setLayoutProperty('crime-heat', 'visibility', 'visible');
    console.log(`� Loaded ${crimes.length} crime records`);
    
  } catch (err) {
    console.error('Crime data fetch failed:', err);
    hideToast('crime');
  }
}

// ============================================
// 4. AIR QUALITY (TfL API)
// ============================================
function initAirQuality() {
  const toggle = document.getElementById('toggle-airquality');
  if (!toggle) return;
  
  toggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      await loadAirQualityData();
    } else {
      if (map.getLayer('air-quality-heat')) {
        map.setLayoutProperty('air-quality-heat', 'visibility', 'none');
      }
    }
  });
  
  console.log('🌫️ Air quality layer initialized');
}

async function loadAirQualityData() {
  showToast('air');
  try {
    // Use London Air API to get sensor data
    const res = await fetch('https://api.erg.ic.ac.uk/AirQuality/Hourly/MonitoringIndex/GroupName=London/Json');
    const data = await res.json();
    
    hideToast('air');
    
    // Parse sensor locations and values
    const features = [];
    
    if (data.HourlyAirQualityIndex?.LocalAuthority) {
      const authorities = Array.isArray(data.HourlyAirQualityIndex.LocalAuthority) 
        ? data.HourlyAirQualityIndex.LocalAuthority 
        : [data.HourlyAirQualityIndex.LocalAuthority];
      
      authorities.forEach(auth => {
        const sites = Array.isArray(auth.Site) ? auth.Site : (auth.Site ? [auth.Site] : []);
        sites.forEach(site => {
          if (site['@Latitude'] && site['@Longitude']) {
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [parseFloat(site['@Longitude']), parseFloat(site['@Latitude'])]
              },
              properties: {
                name: site['@SiteName'],
                index: parseInt(site['@AirQualityIndex']) || 1
              }
            });
          }
        });
      });
    }
    
    const geojson = { type: 'FeatureCollection', features };
    
    if (map.getSource('air-quality-data')) {
      map.getSource('air-quality-data').setData(geojson);
    } else {
      map.addSource('air-quality-data', { type: 'geojson', data: geojson });
      
      map.addLayer({
        id: 'air-quality-heat',
        type: 'heatmap',
        source: 'air-quality-data',
        paint: {
          'heatmap-weight': ['get', 'index'],
          'heatmap-intensity': 0.5,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0, 255, 0, 0)',
            0.2, 'rgb(144, 238, 144)',
            0.4, 'rgb(255, 255, 0)',
            0.6, 'rgb(255, 165, 0)',
            0.8, 'rgb(255, 69, 0)',
            1, 'rgb(255, 0, 0)'
          ],
          'heatmap-radius': 50,
          'heatmap-opacity': 0.6
        }
      }, '3d-buildings');
    }
    
    map.setLayoutProperty('air-quality-heat', 'visibility', 'visible');
    console.log(`🌫️ Loaded ${features.length} air quality sensors`);
    
  } catch (err) {
    console.error('Air quality fetch failed:', err);
    hideToast('air');
  }
}

// Error handling
// ============================================
// 5. FLOOD RISK (Environment Agency)
// ============================================
// ============================================
// 6. TRANSPORT LAYER (TfL StopPoints)
// ============================================
let transportMarkers = [];
let loadedStationIds = new Set(); // Track loaded stations

const TFL_COLORS = {
  'bakerloo': '#B36305',
  'central': '#E32017',
  'circle': '#FFD300',
  'district': '#00782A',
  'hammersmith-city': '#F3A9BB',
  'jubilee': '#A0A5A9',
  'metropolitan': '#9B0056',
  'northern': '#000000',
  'piccadilly': '#003688',
  'victoria': '#0098D4',
  'waterloo-city': '#95CDBA',
  'london-overground': '#EF7B10',
  'elizabeth': '#6950a1',
  'dlr': '#00AFAD',
  'tram': '#00BD19'
};

function initTransport() {
  const toggle = document.getElementById('toggle-transport');
  if (!toggle) return;

  toggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Load initial
      await updateTransportMarkers();
      // Add dynamic listener
      map.on('moveend', updateTransportMarkers);
    } else {
      // Cleanup
      map.off('moveend', updateTransportMarkers);
      transportMarkers.forEach(m => m.remove());
      transportMarkers = [];
      loadedStationIds.clear();
    }
  }); 
  console.log('🚇 Transport layer initialized (Interactive Markers)');
}

async function updateTransportMarkers() {
  // Only update if enabled
  if (!document.getElementById('toggle-transport').checked) return;

  const center = map.getCenter();
  showToast('transport');

  try {
    const res = await fetch(`https://api.tfl.gov.uk/StopPoint?lat=${center.lat}&lon=${center.lng}&stopTypes=NaptanMetroStation,NaptanRailStation&radius=3000`);
    const data = await res.json();
    
    hideToast('transport');

    if (!data.stopPoints) return;

    data.stopPoints.forEach(station => {
      // 1. Deduplication Check
      if (loadedStationIds.has(station.naptanId)) return;
      loadedStationIds.add(station.naptanId);

      // 2. Calculate Gradient/Color
      const stationLines = station.lines.map(l => l.id);
      const uniqueColors = [...new Set(stationLines.map(id => TFL_COLORS[id] || '#666'))];
      
      let backgroundStyle;
      if (uniqueColors.length === 0) {
        backgroundStyle = '#666';
      } else if (uniqueColors.length === 1) {
        backgroundStyle = uniqueColors[0];
      } else {
        const segmentSize = 100 / uniqueColors.length;
        const gradientParts = uniqueColors.map((color, i) => {
          return `${color} ${i * segmentSize}% ${(i + 1) * segmentSize}%`;
        });
        backgroundStyle = `conic-gradient(${gradientParts.join(', ')})`;
      }

      // 3. Create DOM Element
      const el = document.createElement('div');
      el.className = 'transport-marker';
      el.style.background = backgroundStyle;
      
      // 4. Click Event
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent Property Viewer
        
        const lineNames = station.lines.map(l => l.name).join(', ');
        const zones = station.additionalProperties.find(p => p.key === 'Zone')?.value || 'N/A';
        
        // Close others
        if (activePopup) activePopup.remove();
        
        activePopup = new maplibregl.Popup({ offset: 15 })
          .setLngLat([station.lon, station.lat])
          .setHTML(`
            <div class="popup-content">
              <h3>🚇 ${station.commonName}</h3>
              <p><strong>Lines:</strong> ${lineNames}</p>
              <p><strong>Zone:</strong> ${zones}</p>
            </div>
          `)
          .addTo(map);
          
        activePopup.on('close', () => { activePopup = null; });
      });

      // 5. Add Marker
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([station.lon, station.lat])
        .addTo(map);
        
      transportMarkers.push(marker);
    });
    
    console.log(`🚇 Updated stations: Total ${transportMarkers.length}`);

  } catch (err) {
    console.error('Transport data error:', err);
    hideToast('transport');
  }
}

map.on('error', (e) => console.error('Map error:', e.error));
