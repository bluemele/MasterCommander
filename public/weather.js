// ============================================================
// WEATHER ROUTING UI — Leaflet map + route builder
// ============================================================
// Click map to add waypoints, configure departure, calculate
// time-interpolated weather along your route.
// ============================================================

(function() {
  'use strict';

  var map, routeLine, waypointMarkers = [], sampleMarkers = [];
  var waypoints = [];
  var lastResult = null;
  var calculating = false;
  var comparing = false;
  var findingWindow = false;
  var healthInterval = null;
  var gpsInterval = null;
  var gpsMarker = null;
  var gpsData = null;
  var gpsTrack = [];
  var gpsTrackLine = null;
  var GPS_TRACK_MAX = 1000;
  var GPS_TRACK_MIN_MOVE = 0.001; // ~110m

  var STORAGE_ROUTE = 'mc_weather_route';
  var STORAGE_GPS_TRACK = 'mc_weather_gps_track';
  var STORAGE_RESULT = 'mc_weather_last_result';

  // ── Helpers ──
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function $(id) { return document.getElementById(id); }

  // ── Initialize ──
  function init() {
    var app = $('app');
    app.innerHTML = buildLayout();

    // Init Leaflet map
    map = L.map('weather-map', {
      center: [25.76, -80.19], // Miami default
      zoom: 7,
      zoomControl: true
    });

    // CartoDB Voyager tiles (warm neutral)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    // Click to add waypoint
    map.on('click', function(e) {
      addWaypoint(e.latlng.lat, e.latlng.lng);
    });

    // Right-click context menu
    map.on('contextmenu', function(e) {
      e.originalEvent.preventDefault();
      showContextMenu(e);
    });

    // Load saved route
    loadRoute();

    // Set default departure to tomorrow 8am UTC
    var depInput = $('wx-departure');
    if (depInput && !depInput.value) {
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      depInput.value = tomorrow.toISOString().slice(0, 16);
    }

    // Bind buttons
    $('wx-calculate').addEventListener('click', calculateRoute);
    $('wx-compare').addEventListener('click', compareModels);
    $('wx-clear').addEventListener('click', clearRoute);
    $('wx-find-window').addEventListener('click', findBestWindow);

    // Default departure window: tomorrow → +4 days
    var wStart = new Date(); wStart.setDate(wStart.getDate() + 1);
    var wEnd = new Date(); wEnd.setDate(wEnd.getDate() + 4);
    $('wx-window-start').value = wStart.toISOString().slice(0, 10);
    $('wx-window-end').value = wEnd.toISOString().slice(0, 10);

    // Health indicator
    fetchHealth();
    healthInterval = setInterval(fetchHealth, 60000);

    // GPS boat position + track
    loadGPSTrack();
    fetchGPS();
    gpsInterval = setInterval(fetchGPS, 30000);

    // Force map resize after layout settles (needs time for :has() CSS to apply)
    setTimeout(function() { map.invalidateSize(); }, 50);
    setTimeout(function() { map.invalidateSize(); }, 300);
  }

  // ── Build HTML layout ──
  function buildLayout() {
    return '<div class="weather-container">' +
      '<div class="weather-sidebar" id="wx-sidebar">' +
        // Route builder
        '<div class="wx-section">' +
          '<div class="wx-section-title">Route Builder</div>' +
          '<ul class="wx-waypoints" id="wx-waypoint-list"></ul>' +
          '<div id="wx-empty-msg" class="wx-empty">Click the map to add waypoints</div>' +
        '</div>' +
        // Settings
        '<div class="wx-section">' +
          '<div class="wx-section-title">Settings</div>' +
          '<div class="wx-form-row">' +
            '<div class="wx-form-group">' +
              '<label for="wx-speed">Boat Speed (kts)</label>' +
              '<input type="number" id="wx-speed" value="7.5" min="1" max="50" step="0.5">' +
            '</div>' +
            '<div class="wx-form-group">' +
              '<label for="wx-model"><span id="wx-health-dot" class="wx-health-dot" title="Checking..."></span> Weather Model</label>' +
              '<select id="wx-model">' +
                '<option value="best">Best Available</option>' +
                '<option value="gfs">GFS (NOAA)</option>' +
                '<option value="ecmwf">ECMWF IFS</option>' +
                '<option value="icon">ICON (DWD)</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="wx-form-row">' +
            '<div class="wx-form-group">' +
              '<label for="wx-departure">Departure (UTC)</label>' +
              '<input type="datetime-local" id="wx-departure">' +
            '</div>' +
          '</div>' +
          '<button class="wx-btn wx-btn-primary" id="wx-calculate" disabled>Calculate Route</button>' +
          '<div class="wx-btn-row">' +
            '<button class="wx-btn wx-btn-secondary" id="wx-compare" disabled>Compare Models</button>' +
            '<button class="wx-btn wx-btn-danger" id="wx-clear">Clear Route</button>' +
          '</div>' +
        '</div>' +
        // Best departure window
        '<div class="wx-section" id="wx-departure-window" style="display:none">' +
          '<div class="wx-section-title">Best Departure Window</div>' +
          '<div class="wx-form-row">' +
            '<div class="wx-form-group">' +
              '<label for="wx-window-start">From</label>' +
              '<input type="date" id="wx-window-start">' +
            '</div>' +
            '<div class="wx-form-group">' +
              '<label for="wx-window-end">To</label>' +
              '<input type="date" id="wx-window-end">' +
            '</div>' +
          '</div>' +
          '<div class="wx-form-row">' +
            '<div class="wx-form-group">' +
              '<label for="wx-window-period">Interval</label>' +
              '<select id="wx-window-period">' +
                '<option value="3">Every 3 hours</option>' +
                '<option value="6">Every 6 hours</option>' +
                '<option value="12">Every 12 hours</option>' +
                '<option value="24">Every 24 hours</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<button class="wx-btn wx-btn-primary" id="wx-find-window" style="background:#0E7490" disabled>Find Best Window</button>' +
          '<div id="wx-departure-results"></div>' +
        '</div>' +
        // Results (hidden until calculated)
        '<div class="wx-section" id="wx-results" style="display:none">' +
          '<div class="wx-section-title">Route Summary</div>' +
          '<div class="wx-summary" id="wx-summary"></div>' +
        '</div>' +
        // Warnings
        '<div class="wx-section" id="wx-warnings-section" style="display:none">' +
          '<div class="wx-section-title">Warnings</div>' +
          '<div class="wx-warnings" id="wx-warnings"></div>' +
        '</div>' +
        // Legs
        '<div class="wx-section" id="wx-legs-section" style="display:none">' +
          '<div class="wx-section-title">Legs</div>' +
          '<div class="wx-legs" id="wx-legs"></div>' +
        '</div>' +
      '</div>' +
      '<div class="weather-map-wrap">' +
        '<div id="weather-map"></div>' +
        '<div class="wx-map-hint" id="wx-hint">Click map to add waypoints</div>' +
      '</div>' +
    '</div>';
  }

  // ── Waypoint management ──
  function addWaypoint(lat, lon, name) {
    var idx = waypoints.length + 1;
    var wp = {
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      name: name || 'WP ' + idx
    };
    waypoints.push(wp);
    addMarker(wp, waypoints.length - 1);
    updateRouteLine();
    renderWaypointList();
    saveRoute();
    updateUI();
  }

  function removeWaypoint(idx) {
    waypoints.splice(idx, 1);
    rebuildMarkers();
    updateRouteLine();
    renderWaypointList();
    saveRoute();
    updateUI();
    clearResults();
  }

  function moveWaypoint(idx, lat, lon) {
    waypoints[idx].lat = Math.round(lat * 10000) / 10000;
    waypoints[idx].lon = Math.round(lon * 10000) / 10000;
    renderWaypointList();
    updateRouteLine();
    saveRoute();
    clearResults();
  }

  // ── Markers ──
  function addMarker(wp, idx) {
    var icon = L.divIcon({
      className: 'wx-marker-container',
      html: '<div class="wx-marker">' + (idx + 1) + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    var marker = L.marker([wp.lat, wp.lon], {
      icon: icon,
      draggable: true,
      zIndexOffset: 1000
    }).addTo(map);

    marker._wpIdx = idx;

    marker.on('dragend', function(e) {
      var pos = e.target.getLatLng();
      moveWaypoint(marker._wpIdx, pos.lat, pos.lng);
    });

    marker.bindPopup(function() {
      return '<div class="wx-popup">' +
        '<div class="wx-popup-title">' + esc(wp.name) + '</div>' +
        '<div class="wx-popup-row"><span class="wx-popup-label">Lat</span><span class="wx-popup-value">' + wp.lat.toFixed(4) + '</span></div>' +
        '<div class="wx-popup-row"><span class="wx-popup-label">Lon</span><span class="wx-popup-value">' + wp.lon.toFixed(4) + '</span></div>' +
        '</div>';
    });

    waypointMarkers.push(marker);
  }

  function rebuildMarkers() {
    for (var i = 0; i < waypointMarkers.length; i++) {
      if (waypointMarkers[i] && map) map.removeLayer(waypointMarkers[i]);
    }
    waypointMarkers = [];
    for (var j = 0; j < waypoints.length; j++) {
      addMarker(waypoints[j], j);
    }
  }

  // ── Route line ──
  function updateRouteLine() {
    if (routeLine) map.removeLayer(routeLine);
    if (waypoints.length < 2) return;

    var latlngs = waypoints.map(function(wp) { return [wp.lat, wp.lon]; });
    routeLine = L.polyline(latlngs, {
      color: '#0C4A6E',
      weight: 3,
      opacity: 0.7,
      dashArray: '8 6'
    }).addTo(map);
  }

  // ── Render colored route segments after weather calc ──
  function renderWeatherRoute(result) {
    // Remove plain route line
    if (routeLine) map.removeLayer(routeLine);
    routeLine = null;

    // Clear old sample markers
    clearSampleMarkers();

    if (!result || !result.samples) return;

    var samples = result.samples.filter(function(s) { return s.weather; });
    if (samples.length < 2) return;

    // Draw sea route base line (if available)
    if (result.sea_route_coords && result.sea_route_coords.length > 1) {
      var baseLine = L.polyline(result.sea_route_coords, {
        color: '#0C4A6E', weight: 2, opacity: 0.25, dashArray: '6 4'
      }).addTo(map);
      sampleMarkers.push(baseLine);
    }

    // Draw colored segments
    for (var i = 1; i < samples.length; i++) {
      var s = samples[i];
      var prev = samples[i - 1];
      var wind = s.weather.wind_speed || 0;
      var wave = s.weather.wave_height || 0;
      var color = MCWeather.severityColor(wind, wave);

      var seg = L.polyline([
        [prev.lat, prev.lon],
        [s.lat, s.lon]
      ], {
        color: color,
        weight: 5,
        opacity: 0.85
      }).addTo(map);
      sampleMarkers.push(seg);
    }

    // Combined weather markers (wind+wave info) at every 3rd sample
    for (var k = 0; k < samples.length; k += 3) {
      var sp = samples[k];
      if (!sp.weather || sp.weather.wind_speed == null) continue;

      var mHtml = MCWeather.combinedMarkerSVG(sp.weather.wind_speed, sp.weather.wind_direction || 0, sp.weather.wave_height);
      var mIcon = L.divIcon({
        className: 'wx-combined-marker',
        html: mHtml,
        iconSize: [40, 48],
        iconAnchor: [20, 24]
      });

      var m = L.marker([sp.lat, sp.lon], { icon: mIcon, interactive: true, zIndexOffset: 500 }).addTo(map);

      (function(point) {
        m.bindPopup(function() {
          var w = point.weather;
          var bf = MCWeather.beaufort(w.wind_speed || 0);
          var html = '<div class="wx-popup">' +
            '<div class="wx-popup-title">ETA: ' + (point.eta ? point.eta.substring(0, 16).replace('T', ' ') + ' UTC' : '--') + '</div>';
          if (w.wind_speed != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Wind</span><span class="wx-popup-value">' + Math.round(w.wind_speed) + ' kts ' + MCWeather.formatBearing(w.wind_direction || 0) + '</span></div>';
          if (w.wind_gusts != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Gusts</span><span class="wx-popup-value">' + Math.round(w.wind_gusts) + ' kts</span></div>';
          html += '<div class="wx-popup-row"><span class="wx-popup-label">Beaufort</span><span class="wx-popup-value">F' + bf.force + ' ' + bf.description + '</span></div>';
          if (w.wave_height != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Waves</span><span class="wx-popup-value">' + w.wave_height.toFixed(1) + 'm @ ' + (w.wave_period ? w.wave_period.toFixed(0) + 's' : '--') + ' ' + MCWeather.formatBearing(w.wave_direction || 0) + '</span></div>';
          if (w.swell_height != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Swell</span><span class="wx-popup-value">' + w.swell_height.toFixed(1) + 'm ' + MCWeather.formatBearing(w.swell_direction || 0) + '</span></div>';
          if (w.pressure != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Pressure</span><span class="wx-popup-value">' + Math.round(w.pressure) + ' hPa</span></div>';
          if (w.visibility != null) html += '<div class="wx-popup-row"><span class="wx-popup-label">Visibility</span><span class="wx-popup-value">' + (w.visibility / 1000).toFixed(1) + ' km</span></div>';
          html += '</div>';
          return html;
        });
      })(sp);

      sampleMarkers.push(m);
    }

    // Fit map to route
    if (waypoints.length >= 2) {
      var bounds = L.latLngBounds(waypoints.map(function(wp) { return [wp.lat, wp.lon]; }));
      map.fitBounds(bounds.pad(0.15));
    }
  }

  function clearSampleMarkers() {
    for (var i = 0; i < sampleMarkers.length; i++) {
      if (sampleMarkers[i] && map) map.removeLayer(sampleMarkers[i]);
    }
    sampleMarkers = [];
  }

  // ── Render sidebar waypoint list ──
  function renderWaypointList() {
    var list = $('wx-waypoint-list');
    var empty = $('wx-empty-msg');
    if (!list) return;

    if (waypoints.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }

    if (empty) empty.style.display = 'none';
    var html = '';
    for (var i = 0; i < waypoints.length; i++) {
      var wp = waypoints[i];
      html += '<li class="wx-waypoint" data-idx="' + i + '">' +
        '<span class="wx-wp-num">' + (i + 1) + '</span>' +
        '<div class="wx-wp-info">' +
          '<div class="wx-wp-name">' + esc(wp.name) + '</div>' +
          '<div class="wx-wp-coords">' + wp.lat.toFixed(4) + ', ' + wp.lon.toFixed(4) + '</div>' +
        '</div>' +
        '<button class="wx-wp-delete" data-idx="' + i + '" title="Remove">&times;</button>' +
      '</li>';
    }
    list.innerHTML = html;

    // Attach delete handlers
    list.querySelectorAll('.wx-wp-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        removeWaypoint(parseInt(this.getAttribute('data-idx')));
      });
    });
  }

  // ── UI state ──
  function updateUI() {
    var calcBtn = $('wx-calculate');
    var cmpBtn = $('wx-compare');
    var hint = $('wx-hint');
    if (calcBtn) calcBtn.disabled = waypoints.length < 2 || calculating;
    if (cmpBtn) cmpBtn.disabled = waypoints.length < 2 || comparing || calculating;
    var depWindow = $('wx-departure-window');
    if (depWindow) depWindow.style.display = waypoints.length >= 2 ? '' : 'none';
    var findBtn = $('wx-find-window');
    if (findBtn) findBtn.disabled = waypoints.length < 2 || findingWindow;
    if (hint) {
      if (waypoints.length === 0) {
        hint.textContent = 'Click map to add waypoints';
        hint.classList.remove('hidden');
      } else if (waypoints.length === 1) {
        hint.textContent = 'Click map to add destination';
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  }

  // ── Calculate route ──
  async function calculateRoute() {
    if (waypoints.length < 2 || calculating) return;
    calculating = true;
    updateUI();

    var resultsDiv = $('wx-results');
    var summaryDiv = $('wx-summary');
    if (resultsDiv) resultsDiv.style.display = '';
    if (summaryDiv) summaryDiv.innerHTML = '<div class="wx-loading"><div class="wx-spinner"></div> Fetching weather data...</div>';

    // Hide old warnings/legs
    var warningsSection = $('wx-warnings-section');
    var legsSection = $('wx-legs-section');
    if (warningsSection) warningsSection.style.display = 'none';
    if (legsSection) legsSection.style.display = 'none';

    try {
      var depVal = $('wx-departure') ? $('wx-departure').value : '';
      if (!depVal) {
        throw new Error('Set a departure date/time first');
      }
      var body = {
        waypoints: waypoints,
        departure_time: depVal + ':00Z',
        boat_speed_kts: parseFloat($('wx-speed') ? $('wx-speed').value : '7.5'),
        model: $('wx-model') ? $('wx-model').value : 'best'
      };

      var resp = await fetch('/api/weather/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        var err = await resp.json();
        throw new Error(err.error || 'Request failed');
      }

      lastResult = await resp.json();
      saveResult();
      renderResults(lastResult);
      renderWeatherRoute(lastResult);
    } catch (e) {
      if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#EF4444;padding:8px;font-size:0.82rem">Error: ' + esc(e.message) + '</div>';
    } finally {
      calculating = false;
      updateUI();
    }
  }

  // ── Render results ──
  function renderResults(result) {
    var summaryDiv = $('wx-summary');
    var warningsSection = $('wx-warnings-section');
    var warningsDiv = $('wx-warnings');
    var legsSection = $('wx-legs-section');
    var legsDiv = $('wx-legs');

    if (!result || !result.summary) return;
    var s = result.summary;

    // Summary stats
    var comfortPct = s.avg_comfort != null ? Math.round(s.avg_comfort * 100) : '--';
    var comfortColor = s.avg_comfort > 0.7 ? '#10B981' : s.avg_comfort > 0.4 ? '#F59E0B' : '#EF4444';

    summaryDiv.innerHTML =
      '<div class="wx-stat"><div class="wx-stat-label">Distance</div><div class="wx-stat-value">' + s.total_distance_nm + ' <span class="unit">nm</span></div></div>' +
      '<div class="wx-stat"><div class="wx-stat-label">ETA</div><div class="wx-stat-value">' + MCWeather.formatDuration(s.total_hours) + '</div></div>' +
      '<div class="wx-stat"><div class="wx-stat-label">Max Wind</div><div class="wx-stat-value" style="color:' + MCWeather.windColor(s.max_wind_kts || 0) + '">' + (s.max_wind_kts || '--') + ' <span class="unit">kts</span></div></div>' +
      '<div class="wx-stat"><div class="wx-stat-label">Max Gusts</div><div class="wx-stat-value" style="color:' + MCWeather.windColor(s.max_gust_kts || 0) + '">' + (s.max_gust_kts || '--') + ' <span class="unit">kts</span></div></div>' +
      '<div class="wx-stat"><div class="wx-stat-label">Max Waves</div><div class="wx-stat-value" style="color:' + MCWeather.waveColor(s.max_wave_m || 0) + '">' + (s.max_wave_m || '--') + ' <span class="unit">m</span></div></div>' +
      '<div class="wx-stat"><div class="wx-stat-label">Pressure</div><div class="wx-stat-value">' + (s.pressure_trend || '--') + '</div></div>' +
      '<div class="wx-stat full"><div class="wx-stat-label">Comfort Score</div><div class="wx-stat-value">' + comfortPct + '<span class="unit">%</span></div>' +
        '<div class="wx-comfort-bar"><div class="wx-comfort-fill" style="width:' + comfortPct + '%;background:' + comfortColor + '"></div></div>' +
      '</div>';

    // Warnings
    if (result.warnings && result.warnings.length > 0) {
      warningsSection.style.display = '';
      var warnHtml = '';
      // Deduplicate similar warnings
      var seen = {};
      for (var w = 0; w < result.warnings.length; w++) {
        var warn = result.warnings[w];
        var key = warn.type + ':' + warn.severity;
        if (seen[key]) continue;
        seen[key] = true;
        var icon = warn.type === 'wind' ? '&#127788;' : warn.type === 'waves' ? '&#127754;' : warn.type === 'visibility' ? '&#127787;' : '&#127783;';
        warnHtml += '<div class="wx-warning ' + warn.severity + '">' +
          '<span class="wx-warning-icon">' + icon + '</span>' +
          '<span>' + esc(warn.message) + '</span></div>';
      }
      warningsDiv.innerHTML = warnHtml;
    }

    // Legs
    if (result.legs && result.legs.length > 0) {
      legsSection.style.display = '';
      var legHtml = '';
      for (var l = 0; l < result.legs.length; l++) {
        var leg = result.legs[l];
        var legSamples = leg.samples || [];
        var maxW = 0, maxWv = 0;
        for (var ls = 0; ls < legSamples.length; ls++) {
          if (legSamples[ls].weather) {
            if (legSamples[ls].weather.wind_speed > maxW) maxW = legSamples[ls].weather.wind_speed;
            if (legSamples[ls].weather.wave_height > maxWv) maxWv = legSamples[ls].weather.wave_height;
          }
        }

        legHtml += '<div class="wx-leg" data-leg="' + l + '">' +
          '<div class="wx-leg-header">' +
            '<span class="wx-leg-name">' + esc(leg.from.name || 'WP ' + (l + 1)) + ' → ' + esc(leg.to.name || 'WP ' + (l + 2)) + '</span>' +
            '<span class="wx-leg-dist">' + leg.distance_nm + ' nm · ' + MCWeather.formatDuration(leg.hours) + '</span>' +
          '</div>' +
          '<div class="wx-leg-weather">' +
            '<span style="color:' + MCWeather.windColor(maxW) + '">&#127788; ' + Math.round(maxW) + ' kts</span>' +
            '<span style="color:' + MCWeather.waveColor(maxWv) + '">&#127754; ' + maxWv.toFixed(1) + 'm</span>' +
          '</div>' +
        '</div>';
      }
      legsDiv.innerHTML = legHtml;

      // Click leg to zoom
      legsDiv.querySelectorAll('.wx-leg').forEach(function(el) {
        el.addEventListener('click', function() {
          var legIdx = parseInt(this.getAttribute('data-leg'));
          if (waypoints[legIdx] && waypoints[legIdx + 1]) {
            var bounds = L.latLngBounds([
              [waypoints[legIdx].lat, waypoints[legIdx].lon],
              [waypoints[legIdx + 1].lat, waypoints[legIdx + 1].lon]
            ]);
            map.fitBounds(bounds.pad(0.2));
          }
        });
      });
    }
  }

  // ── Clear ──
  function clearRoute() {
    waypoints = [];
    lastResult = null;
    rebuildMarkers();
    clearSampleMarkers();
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    renderWaypointList();
    clearResults();
    saveRoute();
    saveResult();
    updateUI();
  }

  function clearResults() {
    var resultsDiv = $('wx-results');
    var warningsSection = $('wx-warnings-section');
    var legsSection = $('wx-legs-section');
    if (resultsDiv) resultsDiv.style.display = 'none';
    if (warningsSection) warningsSection.style.display = 'none';
    if (legsSection) legsSection.style.display = 'none';
  }

  // ── Context menu ──
  function showContextMenu(e) {
    // Remove existing
    var old = document.querySelector('.wx-context-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.className = 'wx-context-menu';
    menu.style.cssText = 'position:fixed;z-index:2000;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:0.82rem;min-width:160px;';
    menu.style.left = e.originalEvent.clientX + 'px';
    menu.style.top = e.originalEvent.clientY + 'px';

    function item(text, fn) {
      var el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'padding:8px 14px;cursor:pointer;transition:background 0.1s;';
      el.onmouseenter = function() { el.style.background = '#f1f5f9'; };
      el.onmouseleave = function() { el.style.background = ''; };
      el.onclick = function() { fn(); menu.remove(); };
      menu.appendChild(el);
    }

    item('Add waypoint here', function() {
      addWaypoint(e.latlng.lat, e.latlng.lng);
    });
    if (waypoints.length > 0) {
      item('Clear all waypoints', clearRoute);
    }
    if (gpsTrack.length > 0) {
      item('Clear GPS track', clearGPSTrack);
    }

    document.body.appendChild(menu);
    setTimeout(function() {
      document.addEventListener('click', function handler() {
        menu.remove();
        document.removeEventListener('click', handler);
      }, { once: true });
    }, 10);
  }

  // ── Persistence ──
  function saveRoute() {
    try {
      localStorage.setItem(STORAGE_ROUTE, JSON.stringify({
        waypoints: waypoints,
        speed: $('wx-speed') ? $('wx-speed').value : '7.5',
        departure: $('wx-departure') ? $('wx-departure').value : '',
        model: $('wx-model') ? $('wx-model').value : 'best'
      }));
    } catch (e) {}
  }

  function loadRoute() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_ROUTE));
      if (saved && saved.waypoints && saved.waypoints.length > 0) {
        waypoints = saved.waypoints;
        rebuildMarkers();
        updateRouteLine();
        renderWaypointList();
        if (saved.speed && $('wx-speed')) $('wx-speed').value = saved.speed;
        if (saved.departure && $('wx-departure')) $('wx-departure').value = saved.departure;
        if (saved.model && $('wx-model')) $('wx-model').value = saved.model;

        // Fit map to waypoints
        if (waypoints.length >= 2) {
          var bounds = L.latLngBounds(waypoints.map(function(wp) { return [wp.lat, wp.lon]; }));
          map.fitBounds(bounds.pad(0.15));
        } else if (waypoints.length === 1) {
          map.setView([waypoints[0].lat, waypoints[0].lon], 10);
        }
      }
    } catch (e) {}
    updateUI();
  }

  function saveResult() {
    try {
      if (lastResult) {
        localStorage.setItem(STORAGE_RESULT, JSON.stringify(lastResult));
      } else {
        localStorage.removeItem(STORAGE_RESULT);
      }
    } catch (e) {}
  }

  // ── Compare Models ──
  async function compareModels() {
    if (waypoints.length < 2 || comparing) return;
    comparing = true;
    updateUI();

    try {
      var depVal = $('wx-departure') ? $('wx-departure').value : '';
      if (!depVal) throw new Error('Set a departure date/time first');

      var body = {
        waypoints: waypoints,
        departure_time: depVal + ':00Z',
        boat_speed_kts: parseFloat($('wx-speed') ? $('wx-speed').value : '7.5'),
        models: ['ecmwf', 'gfs']
      };

      var resp = await fetch('/api/weather/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        var err = await resp.json();
        throw new Error(err.error || 'Comparison failed');
      }

      var result = await resp.json();
      renderComparison(result);
    } catch (e) {
      alert('Comparison error: ' + e.message);
    } finally {
      comparing = false;
      updateUI();
    }
  }

  function renderComparison(result) {
    // Remove existing modal
    var old = document.querySelector('.wx-compare-modal');
    if (old) old.remove();

    var modal = document.createElement('div');
    modal.className = 'wx-compare-modal';

    var modelKeys = Object.keys(result.models || {});
    var cmp = result.comparison || {};

    // Agreement badge
    var agreeClass = cmp.agreement === 'high' ? 'agree-high' : cmp.agreement === 'moderate' ? 'agree-moderate' : 'agree-low';
    var agreeLabel = cmp.agreement === 'high' ? 'High Agreement' : cmp.agreement === 'moderate' ? 'Moderate Agreement' : 'Low Agreement';

    var html = '<div class="wx-compare-content">' +
      '<div class="wx-compare-header">' +
        '<div class="wx-compare-title">Model Comparison</div>' +
        '<span class="wx-agree-badge ' + agreeClass + '">' + esc(agreeLabel) + '</span>' +
        '<button class="wx-compare-close" id="wx-compare-close">&times;</button>' +
      '</div>' +
      '<div class="wx-compare-spread">' +
        'Wind spread: <strong>' + (cmp.max_wind_spread_kts || 0) + ' kts</strong> &middot; ' +
        'Wave spread: <strong>' + (cmp.max_wave_spread_m || 0) + ' m</strong>' +
      '</div>' +
      '<table class="wx-compare-table"><thead><tr><th>Metric</th>';

    for (var m = 0; m < modelKeys.length; m++) {
      html += '<th>' + esc(modelKeys[m].toUpperCase()) + '</th>';
    }
    html += '</tr></thead><tbody>';

    var metrics = [
      { key: 'max_wind_kts', label: 'Max Wind', unit: ' kts', fmt: function(v) { return v != null ? v : '--'; } },
      { key: 'max_gust_kts', label: 'Max Gusts', unit: ' kts', fmt: function(v) { return v != null ? v : '--'; } },
      { key: 'max_wave_m', label: 'Max Waves', unit: ' m', fmt: function(v) { return v != null ? v : '--'; } },
      { key: 'avg_comfort', label: 'Comfort', unit: '%', fmt: function(v) { return v != null ? Math.round(v * 100) : '--'; } },
      { key: 'total_distance_nm', label: 'Distance', unit: ' nm', fmt: function(v) { return v != null ? v : '--'; } }
    ];

    for (var mi = 0; mi < metrics.length; mi++) {
      var metric = metrics[mi];
      html += '<tr><td>' + esc(metric.label) + '</td>';
      var vals = [];
      for (var mk = 0; mk < modelKeys.length; mk++) {
        var s = result.models[modelKeys[mk]]?.summary;
        vals.push(s ? s[metric.key] : null);
      }
      for (var vi = 0; vi < vals.length; vi++) {
        html += '<td>' + metric.fmt(vals[vi]) + (vals[vi] != null ? metric.unit : '') + '</td>';
      }
      html += '</tr>';
    }

    // Warnings row
    html += '<tr><td>Warnings</td>';
    for (var wk = 0; wk < modelKeys.length; wk++) {
      var warns = result.models[modelKeys[wk]]?.warnings || [];
      html += '<td>' + warns.length + '</td>';
    }
    html += '</tr>';

    html += '</tbody></table>';

    // "Use this model" buttons
    html += '<div class="wx-compare-actions">';
    for (var bk = 0; bk < modelKeys.length; bk++) {
      html += '<button class="wx-btn wx-btn-secondary wx-use-model" data-model="' + esc(modelKeys[bk]) + '">Use ' + esc(modelKeys[bk].toUpperCase()) + '</button>';
    }
    html += '</div></div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);

    // Close handler
    document.getElementById('wx-compare-close').addEventListener('click', function() {
      modal.remove();
    });
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.remove();
    });

    // Use model handlers
    modal.querySelectorAll('.wx-use-model').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var modelId = this.getAttribute('data-model');
        var modelSelect = $('wx-model');
        if (modelSelect) modelSelect.value = modelId;
        modal.remove();
        calculateRoute();
      });
    });
  }

  // ── Best Departure Window ──
  async function findBestWindow() {
    if (waypoints.length < 2 || findingWindow) return;
    findingWindow = true;
    updateUI();

    var resultsDiv = $('wx-departure-results');
    resultsDiv.innerHTML = '<div class="wx-loading"><div class="wx-spinner"></div> Analyzing departure windows...</div>';

    try {
      var startVal = $('wx-window-start').value;
      var endVal = $('wx-window-end').value;
      if (!startVal || !endVal) throw new Error('Set start and end dates');
      var intervalHrs = parseInt($('wx-window-period').value) || 3;

      var resp = await fetch('/api/weather/optimal-departure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waypoints: waypoints,
          boat_speed_kts: parseFloat($('wx-speed') ? $('wx-speed').value : '7.5'),
          model: $('wx-model') ? $('wx-model').value : 'best',
          window_start: startVal + 'T00:00:00Z',
          window_end: endVal + 'T23:59:00Z',
          interval_hours: intervalHrs
        })
      });

      if (!resp.ok) {
        var err = await resp.json();
        throw new Error(err.error || 'Request failed');
      }
      renderDepartures(await resp.json());
    } catch (e) {
      resultsDiv.innerHTML = '<div style="color:#EF4444;padding:8px;font-size:0.82rem">' + esc(e.message) + '</div>';
    } finally {
      findingWindow = false;
      updateUI();
    }
  }

  function renderDepartures(result) {
    var container = $('wx-departure-results');
    if (!result || !result.departures || result.departures.length === 0) {
      container.innerHTML = '<div style="color:#64748B;padding:12px;font-size:0.82rem;text-align:center">No departure windows found</div>';
      return;
    }

    var html = '<div style="margin-top:10px">' +
      '<div style="font-size:0.72rem;color:#64748B;margin-bottom:8px">' +
      Math.round(result.total_distance_nm) + ' nm &middot; ~' + MCWeather.formatDuration(result.total_hours) +
      '</div></div><div class="wx-dep-cards">';

    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    for (var i = 0; i < result.departures.length; i++) {
      var dep = result.departures[i];
      var pct = Math.round(dep.comfort_score * 100);
      var colorClass = pct >= 80 ? 'dep-green' : pct >= 60 ? 'dep-yellow' : pct >= 40 ? 'dep-orange' : 'dep-red';
      var barColor = pct >= 80 ? '#10B981' : pct >= 60 ? '#FBBF24' : pct >= 40 ? '#F97316' : '#EF4444';

      var dt = new Date(dep.departure);
      var timeStr = days[dt.getUTCDay()] + ' ' + months[dt.getUTCMonth()] + ' ' +
        dt.getUTCDate() + ', ' + String(dt.getUTCHours()).padStart(2, '0') + ':00 UTC';

      html += '<div class="wx-dep-card ' + colorClass + '" data-departure="' + esc(dep.departure) + '">' +
        (i === 0 ? '<span class="wx-dep-badge">Recommended</span>' : '') +
        '<div class="wx-dep-time">' + (i === 0 ? '&#9733; ' : '') + esc(timeStr) + '</div>' +
        '<div class="wx-dep-bar-wrap"><div class="wx-dep-bar-track"><div class="wx-dep-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
        '<span class="wx-dep-pct">' + pct + '%</span></div>' +
        '<div class="wx-dep-stats">Wind ' + Math.round(dep.max_wind_kts) + ' kts &middot; Waves ' + dep.max_wave_m.toFixed(1) + 'm</div>';

      if (dep.has_warnings && dep.warning_types.length > 0) {
        html += '<div class="wx-dep-warns">';
        for (var w = 0; w < dep.warning_types.length; w++) {
          html += '<span class="wx-dep-warn-tag">' + esc(dep.warning_types[w]) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Click → set departure and calculate
    container.querySelectorAll('.wx-dep-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var depISO = this.getAttribute('data-departure');
        var depInput = $('wx-departure');
        if (depInput && depISO) depInput.value = depISO.slice(0, 16);
        calculateRoute();
      });
    });
  }

  // ── GPS Position ──
  async function fetchGPS() {
    try {
      var resp = await fetch('/api/telemetry/latest');
      if (!resp.ok) return;
      var data = await resp.json();
      var nav = data.navigation;
      if (!nav || !nav.position) return;

      // Parse "lat, lon" string
      var parts = nav.position.split(',').map(function(s) { return parseFloat(s.trim()); });
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return;

      gpsData = {
        lat: parts[0],
        lon: parts[1],
        sog: nav.sog || 0,
        cog: nav.cog || 0,
        heading: nav.heading || 0
      };

      updateGPSMarker();
      extendGPSTrack(gpsData.lat, gpsData.lon);
    } catch (e) {
      // silent
    }
  }

  function updateGPSMarker() {
    if (!gpsData || !map) return;

    var heading = gpsData.heading || 0;
    var boatSvg = '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
      '<g transform="rotate(' + heading + ' 16 16)">' +
      '<path d="M16 4 L22 26 L16 22 L10 26 Z" fill="#0C4A6E" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>' +
      '</g></svg>';

    var icon = L.divIcon({
      className: 'wx-gps-marker',
      html: boatSvg,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (gpsMarker) {
      gpsMarker.setLatLng([gpsData.lat, gpsData.lon]);
      gpsMarker.setIcon(icon);
    } else {
      gpsMarker = L.marker([gpsData.lat, gpsData.lon], {
        icon: icon,
        zIndexOffset: 2000,
        interactive: true
      }).addTo(map);

      gpsMarker.bindPopup(function() {
        if (!gpsData) return '';
        return '<div class="wx-popup">' +
          '<div class="wx-popup-title">Boat Position</div>' +
          '<div class="wx-popup-row"><span class="wx-popup-label">Lat</span><span class="wx-popup-value">' + gpsData.lat.toFixed(4) + '</span></div>' +
          '<div class="wx-popup-row"><span class="wx-popup-label">Lon</span><span class="wx-popup-value">' + gpsData.lon.toFixed(4) + '</span></div>' +
          '<div class="wx-popup-row"><span class="wx-popup-label">SOG</span><span class="wx-popup-value">' + gpsData.sog.toFixed(1) + ' kts</span></div>' +
          '<div class="wx-popup-row"><span class="wx-popup-label">COG</span><span class="wx-popup-value">' + Math.round(gpsData.cog) + '&deg;</span></div>' +
          '<div class="wx-popup-row"><span class="wx-popup-label">HDG</span><span class="wx-popup-value">' + Math.round(gpsData.heading) + '&deg;</span></div>' +
          '<div style="margin-top:8px"><button class="wx-btn wx-btn-primary" style="padding:6px 12px;font-size:0.75rem" onclick="window.MCWeatherUI.useGPSAsStart()">Use as Start</button></div>' +
          '</div>';
      });
    }
  }

  function useGPSAsStart() {
    if (!gpsData) return;
    // If first waypoint exists, replace it; otherwise add
    if (waypoints.length > 0) {
      waypoints[0] = { lat: gpsData.lat, lon: gpsData.lon, name: 'Boat GPS' };
      rebuildMarkers();
      updateRouteLine();
      renderWaypointList();
      saveRoute();
      clearResults();
    } else {
      addWaypoint(gpsData.lat, gpsData.lon, 'Boat GPS');
    }
    if (gpsMarker) gpsMarker.closePopup();
    updateUI();
  }

  // ── GPS Track ──
  function extendGPSTrack(lat, lon) {
    if (gpsTrack.length > 0) {
      var last = gpsTrack[gpsTrack.length - 1];
      if (Math.abs(lat - last[0]) < GPS_TRACK_MIN_MOVE && Math.abs(lon - last[1]) < GPS_TRACK_MIN_MOVE) return;
    }
    gpsTrack.push([lat, lon]);
    if (gpsTrack.length > GPS_TRACK_MAX) gpsTrack.shift();
    renderGPSTrack();
    try { localStorage.setItem(STORAGE_GPS_TRACK, JSON.stringify(gpsTrack)); } catch (e) {}
  }

  function renderGPSTrack() {
    if (gpsTrackLine && map) map.removeLayer(gpsTrackLine);
    gpsTrackLine = null;
    if (!map || gpsTrack.length < 2) return;
    gpsTrackLine = L.polyline(gpsTrack, { color: '#60A5FA', weight: 2, opacity: 0.6, dashArray: '4 4' }).addTo(map);
  }

  function loadGPSTrack() {
    try {
      var saved = localStorage.getItem(STORAGE_GPS_TRACK);
      if (saved) {
        gpsTrack = JSON.parse(saved);
        if (!Array.isArray(gpsTrack)) gpsTrack = [];
        renderGPSTrack();
      }
    } catch (e) { gpsTrack = []; }
  }

  function clearGPSTrack() {
    gpsTrack = [];
    if (gpsTrackLine && map) map.removeLayer(gpsTrackLine);
    gpsTrackLine = null;
    try { localStorage.removeItem(STORAGE_GPS_TRACK); } catch (e) {}
  }

  // ── Health Indicator ──
  async function fetchHealth() {
    try {
      var resp = await fetch('/api/weather/health');
      if (!resp.ok) return;
      var data = await resp.json();
      var dot = $('wx-health-dot');
      if (!dot) return;

      // Determine worst status across providers
      var worst = 'healthy';
      var tips = [];
      for (var name in data.providers) {
        var p = data.providers[name];
        tips.push(name + ': ' + p.status + ' (' + p.rate_limit_remaining + '% capacity)');
        if (p.status === 'unhealthy') worst = 'unhealthy';
        else if (p.status === 'degraded' && worst !== 'unhealthy') worst = 'degraded';
      }
      dot.className = 'wx-health-dot wx-health-' + worst;
      dot.title = tips.join('\n');
    } catch (e) {
      // silent fail
    }
  }

  // ── Cleanup (called when navigating away) ──
  function cleanup() {
    if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
    if (gpsInterval) { clearInterval(gpsInterval); gpsInterval = null; }
    if (gpsMarker && map) { map.removeLayer(gpsMarker); gpsMarker = null; }
    if (gpsTrackLine && map) { map.removeLayer(gpsTrackLine); gpsTrackLine = null; }
    gpsData = null;
    gpsTrack = [];
    if (map) {
      map.remove();
      map = null;
    }
    waypointMarkers = [];
    sampleMarkers = [];
    routeLine = null;
  }

  // ── Public API ──
  window.MCWeatherUI = {
    init: init,
    cleanup: cleanup,
    useGPSAsStart: useGPSAsStart
  };

})();
