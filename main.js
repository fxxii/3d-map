import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// London center point (Nelson's Column)
const LONDON_CENTER = [-0.1279, 51.5076];

// Initialize the map
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty', // FREE - no API key!
  center: LONDON_CENTER,
  zoom: 15.5,
  pitch: 60,
  bearing: -17.6,
  antialias: true,
  maxPitch: 70,
  minZoom: 10,
  maxZoom: 19
});

// Add navigation controls
map.addControl(new maplibregl.NavigationControl({
  visualizePitch: true
}), 'top-right');

// Add fullscreen control
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// Add scale
map.addControl(new maplibregl.ScaleControl({
  maxWidth: 100,
  unit: 'metric'
}), 'bottom-left');

// Hide loading screen when map is ready
map.on('load', () => {
  console.log('🗺️ Map loaded successfully!');
  
  // Add 3D building layer
  add3DBuildings();
  
  // Enhance water styling
  enhanceWaterLayer();
  
  // Add atmospheric lighting
  addLighting();
  
  // Hide loading overlay
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 500);
});

// 3D Buildings Layer
function add3DBuildings() {
  // Check if the building source exists
  const layers = map.getStyle().layers;
  
  // Find the first symbol layer to insert buildings below labels
  let labelLayerId;
  for (const layer of layers) {
    if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
      labelLayerId = layer.id;
      break;
    }
  }

  // Add 3D building extrusion if building layer exists
  if (map.getSource('openmaptiles') || map.getSource('composite')) {
    const source = map.getSource('openmaptiles') ? 'openmaptiles' : 'composite';
    
    map.addLayer({
      id: '3d-buildings',
      source: source,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        // Building color - light cream/white gradient
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
          0, '#e8e4df',    // Warm cream
          20, '#f0ece7',   // Light beige
          50, '#f5f3f0',   // Off-white
          100, '#faf9f7',  // Near white
          150, '#ffffff'   // Pure white for tallest
        ],
        // Height with fallback
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'render_height'],
          ['get', 'height'],
          ['*', ['coalesce', ['get', 'levels'], 3], 3.5],
          12
        ],
        // Base height
        'fill-extrusion-base': [
          'coalesce',
          ['get', 'render_min_height'],
          ['get', 'min_height'],
          0
        ],
        // Opacity - fade in at higher zoom
        'fill-extrusion-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 0.5,
          16, 0.85
        ]
      }
    }, labelLayerId);
    
    console.log('🏢 3D buildings layer added');
  }
}

// Enhanced water styling for the Thames
function enhanceWaterLayer() {
  // Update water color if layer exists
  if (map.getLayer('water')) {
    map.setPaintProperty('water', 'fill-color', '#1a3a5c');
  }
  console.log('🌊 Water styling enhanced');
}

// Atmospheric lighting
function addLighting() {
  map.setLight({
    anchor: 'viewport',
    color: '#ffffff',
    intensity: 0.4,
    position: [1.5, 180, 60]
  });
  console.log('💡 Lighting configured');
}

// Error handling
map.on('error', (e) => {
  console.error('Map error:', e.error);
});

// Debug: Log available sources and layers
map.on('load', () => {
  console.log('Available sources:', Object.keys(map.getStyle().sources));
  console.log('Total layers:', map.getStyle().layers.length);
});
