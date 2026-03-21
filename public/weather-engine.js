// ============================================================
// WEATHER ENGINE — Client-side utilities for weather routing
// ============================================================
// Haversine, Beaufort scale, wind/wave colors, bearing calc,
// wind barb SVGs, comfort scoring. No dependencies.
// ============================================================

(function() {
  'use strict';

  var R_NM = 3440.065; // Earth radius in nautical miles
  var DEG = Math.PI / 180;

  // ── Haversine distance (nautical miles) ──
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * DEG;
    var dLon = (lon2 - lon1) * DEG;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_NM * Math.asin(Math.sqrt(a));
  }

  // ── Initial bearing (degrees, 0-360) ──
  function bearing(lat1, lon1, lat2, lon2) {
    var dLon = (lon2 - lon1) * DEG;
    var y = Math.sin(dLon) * Math.cos(lat2 * DEG);
    var x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
            Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
    var brng = Math.atan2(y, x) / DEG;
    return (brng + 360) % 360;
  }

  // ── Total route distance ──
  function totalDistance(waypoints) {
    var d = 0;
    for (var i = 1; i < waypoints.length; i++) {
      d += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                     waypoints[i].lat, waypoints[i].lon);
    }
    return d;
  }

  // ── Interpolate point along rhumb line ──
  function interpolatePoint(lat1, lon1, lat2, lon2, fraction) {
    return {
      lat: lat1 + (lat2 - lat1) * fraction,
      lon: lon1 + (lon2 - lon1) * fraction
    };
  }

  // ── Beaufort scale ──
  var BEAUFORT = [
    { force: 0,  max: 1,   desc: 'Calm' },
    { force: 1,  max: 3,   desc: 'Light air' },
    { force: 2,  max: 6,   desc: 'Light breeze' },
    { force: 3,  max: 10,  desc: 'Gentle breeze' },
    { force: 4,  max: 16,  desc: 'Moderate breeze' },
    { force: 5,  max: 21,  desc: 'Fresh breeze' },
    { force: 6,  max: 27,  desc: 'Strong breeze' },
    { force: 7,  max: 33,  desc: 'Near gale' },
    { force: 8,  max: 40,  desc: 'Gale' },
    { force: 9,  max: 47,  desc: 'Strong gale' },
    { force: 10, max: 55,  desc: 'Storm' },
    { force: 11, max: 63,  desc: 'Violent storm' },
    { force: 12, max: 999, desc: 'Hurricane' }
  ];

  function beaufort(speedKts) {
    for (var i = 0; i < BEAUFORT.length; i++) {
      if (speedKts <= BEAUFORT[i].max) return { force: BEAUFORT[i].force, description: BEAUFORT[i].desc };
    }
    return { force: 12, description: 'Hurricane' };
  }

  // ── Wind color (green → yellow → orange → red) ──
  function windColor(speedKts) {
    if (speedKts < 10) return '#10B981';  // green - calm
    if (speedKts < 15) return '#34D399';  // light green
    if (speedKts < 20) return '#FBBF24';  // yellow
    if (speedKts < 25) return '#F59E0B';  // amber
    if (speedKts < 30) return '#F97316';  // orange
    if (speedKts < 35) return '#EF4444';  // red
    return '#DC2626';                     // dark red
  }

  // ── Wave color (blue → green → yellow → red) ──
  function waveColor(heightM) {
    if (heightM < 0.5) return '#3B82F6';  // blue - flat
    if (heightM < 1)   return '#06B6D4';  // cyan
    if (heightM < 1.5) return '#10B981';  // green
    if (heightM < 2)   return '#FBBF24';  // yellow
    if (heightM < 3)   return '#F97316';  // orange
    return '#EF4444';                     // red
  }

  // ── Route severity color (for polyline segments) ──
  function severityColor(windKts, waveM) {
    var windScore = Math.min(windKts / 35, 1);
    var waveScore = Math.min((waveM || 0) / 3, 1);
    var score = Math.max(windScore, waveScore);
    if (score < 0.3) return '#10B981';
    if (score < 0.5) return '#FBBF24';
    if (score < 0.7) return '#F97316';
    return '#EF4444';
  }

  // ── Format bearing to compass direction ──
  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function formatBearing(deg) {
    var idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
    return COMPASS[idx];
  }

  // ── Wind barb SVG (simplified — barbs represent 10kt, half-barbs 5kt) ──
  function windBarbSVG(speedKts, directionDeg, size) {
    size = size || 30;
    var half = size / 2;
    var rad = (directionDeg + 180) * DEG; // wind FROM direction
    var barbLen = size * 0.35;

    // Shaft
    var sx = half, sy = half;
    var ex = half + (half * 0.9) * Math.sin(rad);
    var ey = half - (half * 0.9) * Math.cos(rad);

    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<line x1="' + sx.toFixed(1) + '" y1="' + sy.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" stroke="' + windColor(speedKts) + '" stroke-width="2" stroke-linecap="round"/>';

    // Add barbs
    var remaining = Math.round(speedKts);
    var perpRad = rad + Math.PI / 2;
    var barbCount = 0;
    var pos = 0.9;

    while (remaining >= 10 && barbCount < 5) {
      var bx = half + (half * pos) * Math.sin(rad);
      var by = half - (half * pos) * Math.cos(rad);
      var btx = bx + barbLen * Math.sin(perpRad);
      var bty = by - barbLen * Math.cos(perpRad);
      svg += '<line x1="' + bx.toFixed(1) + '" y1="' + by.toFixed(1) + '" x2="' + btx.toFixed(1) + '" y2="' + bty.toFixed(1) + '" stroke="' + windColor(speedKts) + '" stroke-width="1.5" stroke-linecap="round"/>';
      remaining -= 10;
      pos -= 0.15;
      barbCount++;
    }
    if (remaining >= 5) {
      var bx2 = half + (half * pos) * Math.sin(rad);
      var by2 = half - (half * pos) * Math.cos(rad);
      var btx2 = bx2 + barbLen * 0.6 * Math.sin(perpRad);
      var bty2 = by2 - barbLen * 0.6 * Math.cos(perpRad);
      svg += '<line x1="' + bx2.toFixed(1) + '" y1="' + by2.toFixed(1) + '" x2="' + btx2.toFixed(1) + '" y2="' + bty2.toFixed(1) + '" stroke="' + windColor(speedKts) + '" stroke-width="1.5" stroke-linecap="round"/>';
    }

    // Center dot
    svg += '<circle cx="' + half + '" cy="' + half + '" r="2" fill="' + windColor(speedKts) + '"/>';
    svg += '</svg>';
    return svg;
  }

  // ── Swell color (indigo → purple, distinct from wave blue-green) ──
  function swellColor(heightM) {
    if (heightM < 0.5) return '#818CF8';
    if (heightM < 1)   return '#6366F1';
    if (heightM < 1.5) return '#4F46E5';
    if (heightM < 2)   return '#A855F7';
    if (heightM < 3)   return '#9333EA';
    return '#7C3AED';
  }

  // ── Wave arrow SVG (simple directional arrow, colored by height) ──
  function waveArrowSVG(heightM, directionDeg, size, type) {
    size = size || 22;
    var half = size / 2;
    var color = (type === 'swell') ? swellColor(heightM) : waveColor(heightM);
    // Arrow points in wave travel direction (direction + 180 since data is FROM)
    var angle = ((directionDeg || 0) + 180) % 360;

    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg">' +
      '<g transform="rotate(' + angle + ' ' + half + ' ' + half + ')">' +
      '<path d="M' + half + ' 3 L' + (half + 4) + ' ' + (size - 5) + ' L' + half + ' ' + (size - 8) + ' L' + (half - 4) + ' ' + (size - 5) + ' Z" fill="' + color + '" opacity="0.85"/>' +
      '</g></svg>';
  }

  // ── Comfort score (0-1, higher = more comfortable) ──
  function comfortScore(weather) {
    var w = weather || {};
    var windScore = 1 - Math.min((w.wind_speed || 0) / 40, 1);
    var waveScore = 1 - Math.min((w.wave_height || 0) / 4, 1);
    var gustScore = 1 - Math.min((w.wind_gusts || 0) / 50, 1);
    var visScore = Math.min((w.visibility || 10000) / 10000, 1);
    var precipScore = 1 - Math.min((w.precipitation || 0) / 10, 1);

    return windScore * 0.30 + waveScore * 0.30 + gustScore * 0.15 + visScore * 0.15 + precipScore * 0.10;
  }

  // ── Combined wind+wave marker SVG ──
  function combinedMarkerSVG(windSpeedKts, windDirDeg, waveHeightM) {
    var w = 40, h = 48;
    var wc = windColor(windSpeedKts);
    var angle = ((windDirDeg || 0) + 180) % 360;

    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="2" y="2" width="36" height="44" rx="6" fill="rgba(255,255,255,0.88)" stroke="' + wc + '" stroke-width="1"/>' +
      '<g transform="translate(20,13) rotate(' + angle + ' 0 0)">' +
      '<path d="M0,-8 L4,4 L0,1 L-4,4 Z" fill="' + wc + '"/></g>' +
      '<text x="20" y="32" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="' + wc + '">' + Math.round(windSpeedKts) + '</text>';

    if (waveHeightM != null) {
      var vc = waveColor(waveHeightM);
      svg += '<text x="20" y="43" text-anchor="middle" font-family="sans-serif" font-size="8" fill="' + vc + '">~' + waveHeightM.toFixed(1) + 'm</text>';
    }
    svg += '</svg>';
    return svg;
  }

  // ── Format duration (hours → "Xd Yh Zm") ──
  function formatDuration(hours) {
    if (hours < 1) return Math.round(hours * 60) + 'm';
    var d = Math.floor(hours / 24);
    var h = Math.floor(hours % 24);
    var m = Math.round((hours % 1) * 60);
    var parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0 && d === 0) parts.push(m + 'm');
    return parts.join(' ') || '0m';
  }

  // ── Format distance ──
  function formatDistance(nm) {
    return nm < 1 ? nm.toFixed(2) + ' nm' : nm.toFixed(1) + ' nm';
  }

  // ── Interpolate weather sample at a given time ──
  // samples: array of {lat, lon, eta, weather:{...}}
  // Returns {lat, lon, eta, weather, fraction} or null
  function interpolateSample(samples, isoTime) {
    if (!samples || samples.length === 0) return null;
    var t = new Date(isoTime).getTime();
    var first = new Date(samples[0].eta).getTime();
    var last = new Date(samples[samples.length - 1].eta).getTime();
    if (t <= first) return Object.assign({fraction: 0}, samples[0]);
    if (t >= last) return Object.assign({fraction: 1}, samples[samples.length - 1]);

    for (var i = 1; i < samples.length; i++) {
      var t0 = new Date(samples[i - 1].eta).getTime();
      var t1 = new Date(samples[i].eta).getTime();
      if (t >= t0 && t <= t1) {
        var f = (t1 === t0) ? 0 : (t - t0) / (t1 - t0);
        var a = samples[i - 1], b = samples[i];
        var w = {};
        var keys = ['wind_speed','wind_gusts','wind_direction','wave_height','wave_period','wave_direction','swell_height','swell_direction','pressure','visibility','precipitation'];
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var va = (a.weather && a.weather[key] != null) ? a.weather[key] : null;
          var vb = (b.weather && b.weather[key] != null) ? b.weather[key] : null;
          if (va != null && vb != null) {
            if (key.indexOf('direction') !== -1) {
              // Circular interpolation for direction
              var diff = ((vb - va + 540) % 360) - 180;
              w[key] = ((va + diff * f) + 360) % 360;
            } else {
              w[key] = va + (vb - va) * f;
            }
          } else if (va != null) { w[key] = va; }
          else if (vb != null) { w[key] = vb; }
        }
        var totalFrac = (i - 1 + f) / (samples.length - 1);
        return {
          lat: a.lat + (b.lat - a.lat) * f,
          lon: a.lon + (b.lon - a.lon) * f,
          eta: isoTime,
          weather: w,
          fraction: totalFrac,
          sampleIndex: i - 1
        };
      }
    }
    return Object.assign({fraction: 1}, samples[samples.length - 1]);
  }

  // ── Public API ──
  window.MCWeather = {
    haversine: haversine,
    bearing: bearing,
    totalDistance: totalDistance,
    interpolatePoint: interpolatePoint,
    beaufort: beaufort,
    windColor: windColor,
    waveColor: waveColor,
    severityColor: severityColor,
    formatBearing: formatBearing,
    windBarbSVG: windBarbSVG,
    waveArrowSVG: waveArrowSVG,
    swellColor: swellColor,
    combinedMarkerSVG: combinedMarkerSVG,
    comfortScore: comfortScore,
    formatDuration: formatDuration,
    formatDistance: formatDistance,
    interpolateSample: interpolateSample
  };

})();
