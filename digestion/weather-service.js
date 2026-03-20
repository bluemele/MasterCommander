// ============================================================
// WEATHER SERVICE — Express Router for weather routing
// ============================================================
// Proxies Open-Meteo (free, no auth), caches responses,
// calculates time-interpolated route weather.
//
// Endpoints:
//   GET  /forecast              Single-point forecast
//   POST /route                 Route weather calculation
//   POST /optimal-departure     Best departure time finder
//   GET  /models                Available forecast models
// ============================================================

import { Router } from 'express';
import { fetchWithFailover, getHealthStatus, getRateLimitStatus, hasComparisonBudget } from './weather-providers.js';

const router = Router();

// ── Constants ──
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE = 500;
const SAMPLE_INTERVAL_NM = 20;
const R_NM = 3440.065;
const DEG = Math.PI / 180;

// ── In-memory LRU cache ──
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  // LRU: move to end
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

function cacheSet(key, data) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

// ── Geo helpers ──
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

function interpolatePoint(lat1, lon1, lat2, lon2, fraction) {
  return {
    lat: lat1 + (lat2 - lat1) * fraction,
    lon: lon1 + (lon2 - lon1) * fraction
  };
}

function roundToGrid(val) {
  return Math.round(val * 4) / 4; // 0.25 degree grid
}

// ── Open-Meteo fetchers ──
const WEATHER_PARAMS = [
  'temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
  'precipitation', 'cloud_cover', 'visibility', 'pressure_msl',
  'weather_code'
].join(',');

const MARINE_PARAMS = [
  'wave_height', 'wave_direction', 'wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period'
].join(',');

const MODEL_MAP = {
  gfs: { weather: 'gfs_seamless', marine: 'ncep_gfswave025' },
  ecmwf: { weather: 'ecmwf_ifs025', marine: 'ecmwf_wam025' },
  icon: { weather: 'icon_seamless', marine: null },  // no marine model
  best: { weather: null, marine: null }
};

async function fetchWeather(lat, lon, hours, model) {
  const gridLat = roundToGrid(lat);
  const gridLon = roundToGrid(lon);
  const modelKey = model || 'best';
  const cacheKey = `w:${modelKey}:${gridLat}:${gridLon}:${hours || 168}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const modelCfg = MODEL_MAP[modelKey] || MODEL_MAP.best;
  let url = `https://api.open-meteo.com/v1/forecast?latitude=${gridLat}&longitude=${gridLon}` +
    `&hourly=${WEATHER_PARAMS}&wind_speed_unit=kn&forecast_hours=${hours || 168}&timezone=UTC`;
  if (modelCfg.weather) url += `&models=${modelCfg.weather}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Open-Meteo weather API: ${resp.status}`);
  const data = await resp.json();
  cacheSet(cacheKey, data);
  return data;
}

async function fetchMarine(lat, lon, hours, model) {
  const gridLat = roundToGrid(lat);
  const gridLon = roundToGrid(lon);
  const modelKey = model || 'best';
  const modelCfg = MODEL_MAP[modelKey] || MODEL_MAP.best;
  const cacheKey = `m:${modelKey}:${gridLat}:${gridLon}:${hours || 168}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${gridLat}&longitude=${gridLon}` +
    `&hourly=${MARINE_PARAMS}&forecast_hours=${hours || 168}&timezone=UTC` +
    (modelCfg.marine ? `&models=${modelCfg.marine}` : '');

  const resp = await fetch(url);
  if (!resp.ok) {
    // Marine data not available everywhere — return null gracefully
    console.warn(`Marine API unavailable for ${gridLat},${gridLon}: ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  cacheSet(cacheKey, data);
  return data;
}

// ── Merge weather + marine data for a point ──
function mergeData(weather, marine) {
  if (!weather || !weather.hourly) return null;
  const hourly = weather.hourly;
  const times = hourly.time || [];

  const merged = times.map((t, i) => {
    const point = {
      time: t,
      temperature: hourly.temperature_2m?.[i],
      wind_speed: hourly.wind_speed_10m?.[i],
      wind_direction: hourly.wind_direction_10m?.[i],
      wind_gusts: hourly.wind_gusts_10m?.[i],
      precipitation: hourly.precipitation?.[i],
      cloud_cover: hourly.cloud_cover?.[i],
      visibility: hourly.visibility?.[i],
      pressure: hourly.pressure_msl?.[i],
      weather_code: hourly.weather_code?.[i]
    };

    if (marine && marine.hourly) {
      const mh = marine.hourly;
      point.wave_height = mh.wave_height?.[i];
      point.wave_direction = mh.wave_direction?.[i];
      point.wave_period = mh.wave_period?.[i];
      point.swell_height = mh.swell_wave_height?.[i];
      point.swell_direction = mh.swell_wave_direction?.[i];
      point.swell_period = mh.swell_wave_period?.[i];
      point.wind_wave_height = mh.wind_wave_height?.[i];
    }
    return point;
  });

  return merged;
}

// ── Interpolate weather data to a specific timestamp ──
function interpolateWeatherAtTime(mergedData, targetTime) {
  if (!mergedData || mergedData.length === 0) return null;

  const targetMs = new Date(targetTime).getTime();

  // Find bounding hours
  let before = null, after = null;
  for (let i = 0; i < mergedData.length; i++) {
    const t = new Date(mergedData[i].time).getTime();
    if (t <= targetMs) before = i;
    if (t >= targetMs && after === null) after = i;
  }

  if (before === null && after === null) return null;
  if (before === null) return mergedData[after];
  if (after === null || before === after) return mergedData[before];

  const t0 = new Date(mergedData[before].time).getTime();
  const t1 = new Date(mergedData[after].time).getTime();
  const frac = (targetMs - t0) / (t1 - t0);

  const b = mergedData[before];
  const a = mergedData[after];
  const result = { time: targetTime };

  // Linear interpolation for scalar values
  const scalars = ['temperature', 'wind_speed', 'wind_gusts', 'precipitation',
    'cloud_cover', 'visibility', 'pressure', 'wave_height', 'wave_period',
    'swell_height', 'swell_period', 'wind_wave_height'];
  for (const key of scalars) {
    if (b[key] != null && a[key] != null) {
      result[key] = b[key] + (a[key] - b[key]) * frac;
    } else {
      result[key] = b[key] ?? a[key] ?? null;
    }
  }

  // Angular interpolation for directions
  const angles = ['wind_direction', 'wave_direction', 'swell_direction'];
  for (const key of angles) {
    if (b[key] != null && a[key] != null) {
      result[key] = interpolateAngle(b[key], a[key], frac);
    } else {
      result[key] = b[key] ?? a[key] ?? null;
    }
  }

  result.weather_code = frac < 0.5 ? b.weather_code : a.weather_code;
  return result;
}

function interpolateAngle(a1, a2, frac) {
  let diff = a2 - a1;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((a1 + diff * frac) + 360) % 360;
}

// ── Generate sample points along a route ──
function generateSamplePoints(waypoints, boatSpeedKts, departureTime) {
  const samples = [];
  let cumulativeHours = 0;
  const depMs = new Date(departureTime).getTime();

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wp1 = waypoints[i];
    const wp2 = waypoints[i + 1];
    const legDist = haversine(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
    const legHours = legDist / boatSpeedKts;
    const numSamples = Math.max(2, Math.ceil(legDist / SAMPLE_INTERVAL_NM) + 1);

    for (let j = 0; j < numSamples; j++) {
      const frac = j / (numSamples - 1);
      const pt = interpolatePoint(wp1.lat, wp1.lon, wp2.lat, wp2.lon, frac);
      const hoursAtPoint = cumulativeHours + legHours * frac;
      const etaMs = depMs + hoursAtPoint * 3600000;

      samples.push({
        lat: pt.lat,
        lon: pt.lon,
        leg: i,
        fraction: frac,
        distance_nm: (i > 0 ? samples.filter(s => s.leg < i).reduce((sum, s, idx, arr) =>
          idx === arr.length - 1 ? sum + haversine(waypoints[i - 1].lat, waypoints[i - 1].lon, wp1.lat, wp1.lon) : sum, 0) : 0) + legDist * frac,
        hours_from_departure: hoursAtPoint,
        eta: new Date(etaMs).toISOString()
      });
    }
    cumulativeHours += legHours;
  }

  return samples;
}

// ── Generate warnings ──
function generateWarnings(samplePoints) {
  const warnings = [];
  for (const pt of samplePoints) {
    if (!pt.weather) continue;
    const w = pt.weather;
    if (w.wind_gusts > 25) {
      warnings.push({
        type: 'wind', severity: w.wind_gusts > 35 ? 'danger' : 'warning',
        message: `Gusts ${Math.round(w.wind_gusts)} kts at ${pt.eta.substring(11, 16)} UTC`,
        lat: pt.lat, lon: pt.lon, eta: pt.eta
      });
    }
    if (w.wave_height > 2) {
      warnings.push({
        type: 'waves', severity: w.wave_height > 3 ? 'danger' : 'warning',
        message: `Waves ${w.wave_height.toFixed(1)}m at ${pt.eta.substring(11, 16)} UTC`,
        lat: pt.lat, lon: pt.lon, eta: pt.eta
      });
    }
    if (w.visibility != null && w.visibility < 2000) {
      warnings.push({
        type: 'visibility', severity: 'warning',
        message: `Low visibility ${Math.round(w.visibility)}m at ${pt.eta.substring(11, 16)} UTC`,
        lat: pt.lat, lon: pt.lon, eta: pt.eta
      });
    }
    if (w.precipitation > 5) {
      warnings.push({
        type: 'precipitation', severity: 'warning',
        message: `Heavy rain ${w.precipitation.toFixed(1)}mm/h at ${pt.eta.substring(11, 16)} UTC`,
        lat: pt.lat, lon: pt.lon, eta: pt.eta
      });
    }
  }
  return warnings;
}

// ── Calculate summary stats ──
function calculateSummary(waypoints, samplePoints, boatSpeedKts) {
  let totalDist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                           waypoints[i].lat, waypoints[i].lon);
  }

  const withWeather = samplePoints.filter(s => s.weather);
  const winds = withWeather.map(s => s.weather.wind_speed).filter(v => v != null);
  const gusts = withWeather.map(s => s.weather.wind_gusts).filter(v => v != null);
  const waves = withWeather.map(s => s.weather.wave_height).filter(v => v != null);
  const pressures = withWeather.map(s => s.weather.pressure).filter(v => v != null);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const max = arr => arr.length ? Math.max(...arr) : null;
  const min = arr => arr.length ? Math.min(...arr) : null;

  const pressureTrend = pressures.length >= 2
    ? pressures[pressures.length - 1] - pressures[0] > 2 ? 'rising'
    : pressures[pressures.length - 1] - pressures[0] < -2 ? 'falling' : 'steady'
    : 'unknown';

  const comfortScores = withWeather.map(s => {
    const w = s.weather;
    const windScore = 1 - Math.min((w.wind_speed || 0) / 40, 1);
    const waveScore = 1 - Math.min((w.wave_height || 0) / 4, 1);
    return windScore * 0.5 + waveScore * 0.5;
  });

  return {
    total_distance_nm: Math.round(totalDist * 10) / 10,
    total_hours: Math.round((totalDist / boatSpeedKts) * 10) / 10,
    avg_wind_kts: avg(winds) != null ? Math.round(avg(winds) * 10) / 10 : null,
    max_wind_kts: max(winds) != null ? Math.round(max(winds) * 10) / 10 : null,
    max_gust_kts: max(gusts) != null ? Math.round(max(gusts) * 10) / 10 : null,
    avg_wave_m: avg(waves) != null ? Math.round(avg(waves) * 10) / 10 : null,
    max_wave_m: max(waves) != null ? Math.round(max(waves) * 10) / 10 : null,
    pressure_trend: pressureTrend,
    avg_comfort: avg(comfortScores) != null ? Math.round(avg(comfortScores) * 100) / 100 : null,
    num_legs: waypoints.length - 1
  };
}

// ── Calculate route weather from pre-fetched data (reused by /route and /compare) ──
function calculateRouteWeather(waypoints, samples, weatherMap, speed) {
  // Interpolate weather at each sample point's ETA
  for (const s of samples) {
    const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
    const data = weatherMap.get(key);
    if (data) {
      s.weather = interpolateWeatherAtTime(data, s.eta);
    }
  }

  // Generate warnings and summary
  const warnings = generateWarnings(samples);
  const summary = calculateSummary(waypoints, samples, speed);

  // Build per-leg detail
  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const legSamples = samples.filter(s => s.leg === i);
    const legDist = haversine(waypoints[i].lat, waypoints[i].lon,
                              waypoints[i + 1].lat, waypoints[i + 1].lon);
    legs.push({
      from: waypoints[i],
      to: waypoints[i + 1],
      distance_nm: Math.round(legDist * 10) / 10,
      hours: Math.round((legDist / speed) * 10) / 10,
      samples: legSamples
    });
  }

  return { summary, legs, samples, warnings };
}

// ── Fetch weather data for grid cells (shared by /route and /compare) ──
async function fetchGridWeather(waypoints, speed, departureTime, modelKey) {
  const samples = generateSamplePoints(waypoints, speed, departureTime);

  let totalDist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                           waypoints[i].lat, waypoints[i].lon);
  }
  const totalHours = Math.ceil(totalDist / speed) + 24;
  const forecastHours = Math.min(totalHours, 384);

  const gridCells = new Map();
  for (const s of samples) {
    const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
    if (!gridCells.has(key)) {
      gridCells.set(key, { lat: roundToGrid(s.lat), lon: roundToGrid(s.lon) });
    }
  }

  const cellArray = Array.from(gridCells.values());
  const weatherMap = new Map();
  const BATCH_SIZE = 6;

  for (let i = 0; i < cellArray.length; i += BATCH_SIZE) {
    const batch = cellArray.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async cell => {
      const key = `${cell.lat}:${cell.lon}`;
      try {
        const [weather, marine] = await Promise.all([
          fetchWeather(cell.lat, cell.lon, forecastHours, modelKey),
          fetchMarine(cell.lat, cell.lon, forecastHours, modelKey)
        ]);
        return { key, data: mergeData(weather, marine) };
      } catch (err) {
        console.warn(`Failed to fetch ${key} (${modelKey}):`, err.message);
        return { key, data: null };
      }
    }));
    for (const r of results) {
      if (r.data) weatherMap.set(r.key, r.data);
    }
  }

  return { samples, weatherMap };
}

// ============================================================
// ENDPOINTS
// ============================================================

// ── GET /forecast — single point forecast ──
router.get('/forecast', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const hours = parseInt(req.query.hours) || 168;
    const model = req.query.model || 'best';

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid lat/lon' });
    }

    const [weather, marine] = await Promise.all([
      fetchWeather(lat, lon, hours, model),
      fetchMarine(lat, lon, hours, model)
    ]);

    const merged = mergeData(weather, marine);
    res.json({
      lat: roundToGrid(lat),
      lon: roundToGrid(lon),
      model,
      hours: merged ? merged.length : 0,
      forecast: merged
    });
  } catch (err) {
    console.error('Forecast error:', err.message);
    res.status(502).json({ error: 'Failed to fetch forecast', detail: err.message });
  }
});

// ── POST /route — route weather calculation ──
router.post('/route', async (req, res) => {
  try {
    const { waypoints, departure_time, boat_speed_kts, model } = req.body;

    if (!waypoints || waypoints.length < 2) {
      return res.status(400).json({ error: 'At least 2 waypoints required' });
    }
    const depParsed = Date.parse(departure_time);
    if (!departure_time || isNaN(depParsed) || depParsed < Date.parse('2020-01-01')) {
      return res.status(400).json({ error: 'Valid departure_time required (ISO 8601)' });
    }
    const speed = parseFloat(boat_speed_kts) || 7;
    if (speed <= 0 || speed > 50) {
      return res.status(400).json({ error: 'boat_speed_kts must be 0-50' });
    }

    // Validate waypoints
    for (const wp of waypoints) {
      if (wp.lat == null || wp.lon == null || wp.lat < -90 || wp.lat > 90 || wp.lon < -180 || wp.lon > 180) {
        return res.status(400).json({ error: `Invalid waypoint: ${JSON.stringify(wp)}` });
      }
    }

    // Generate sample points
    const samples = generateSamplePoints(waypoints, speed, departure_time);

    // Calculate total hours to determine forecast range needed
    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                             waypoints[i].lat, waypoints[i].lon);
    }
    const totalHours = Math.ceil(totalDist / speed) + 24; // +24h buffer
    const forecastHours = Math.min(totalHours, 384); // Max 16 days

    // Collect unique grid cells to fetch
    const gridCells = new Map();
    for (const s of samples) {
      const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
      if (!gridCells.has(key)) {
        gridCells.set(key, { lat: roundToGrid(s.lat), lon: roundToGrid(s.lon) });
      }
    }

    // Batch fetch weather + marine for each unique cell (parallel, max 6 concurrent)
    const cellArray = Array.from(gridCells.values());
    const weatherMap = new Map();
    const BATCH_SIZE = 6;

    for (let i = 0; i < cellArray.length; i += BATCH_SIZE) {
      const batch = cellArray.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async cell => {
        const key = `${cell.lat}:${cell.lon}`;
        try {
          const [weather, marine] = await Promise.all([
            fetchWeather(cell.lat, cell.lon, forecastHours, model || 'best'),
            fetchMarine(cell.lat, cell.lon, forecastHours, model || 'best')
          ]);
          return { key, data: mergeData(weather, marine) };
        } catch (err) {
          console.warn(`Failed to fetch ${key}:`, err.message);
          return { key, data: null };
        }
      }));
      for (const r of results) {
        if (r.data) weatherMap.set(r.key, r.data);
      }
    }

    // Calculate route weather from fetched data
    const routeResult = calculateRouteWeather(waypoints, samples, weatherMap, speed);

    res.json({
      ...routeResult,
      departure_time,
      boat_speed_kts: speed,
      model: model || 'best'
    });
  } catch (err) {
    console.error('Route error:', err.message);
    res.status(502).json({ error: 'Route calculation failed', detail: err.message });
  }
});

// ── POST /optimal-departure — find best departure time ──
router.post('/optimal-departure', async (req, res) => {
  try {
    const { waypoints, boat_speed_kts, model, window_start, window_end } = req.body;

    if (!waypoints || waypoints.length < 2) {
      return res.status(400).json({ error: 'At least 2 waypoints required' });
    }

    const speed = parseFloat(boat_speed_kts) || 7;
    const start = new Date(window_start || Date.now());
    const end = new Date(window_end || (start.getTime() + 72 * 3600000)); // Default 72h window

    // Test departures every 3 hours
    const departures = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 3 * 3600000) {
      departures.push(new Date(t).toISOString());
    }

    // For each departure, calculate a lightweight route
    // Pre-fetch weather data once (shared across departures)
    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                             waypoints[i].lat, waypoints[i].lon);
    }
    const maxHours = Math.ceil(totalDist / speed) + Math.ceil((end - start) / 3600000) + 24;
    const forecastHours = Math.min(maxHours, 384);

    // Fetch weather for all grid cells
    const testSamples = generateSamplePoints(waypoints, speed, start.toISOString());
    const gridCells = new Map();
    for (const s of testSamples) {
      const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
      if (!gridCells.has(key)) gridCells.set(key, { lat: roundToGrid(s.lat), lon: roundToGrid(s.lon) });
    }

    const cellArray = Array.from(gridCells.values());
    const weatherMap = new Map();
    for (let i = 0; i < cellArray.length; i += 6) {
      const batch = cellArray.slice(i, i + 6);
      const results = await Promise.all(batch.map(async cell => {
        const key = `${cell.lat}:${cell.lon}`;
        try {
          const [weather, marine] = await Promise.all([
            fetchWeather(cell.lat, cell.lon, forecastHours, model || 'best'),
            fetchMarine(cell.lat, cell.lon, forecastHours, model || 'best')
          ]);
          return { key, data: mergeData(weather, marine) };
        } catch {
          return { key, data: null };
        }
      }));
      for (const r of results) {
        if (r.data) weatherMap.set(r.key, r.data);
      }
    }

    // Score each departure
    const scored = departures.map(dep => {
      const samples = generateSamplePoints(waypoints, speed, dep);
      let totalComfort = 0, count = 0;
      let maxWind = 0, maxWave = 0;
      const warnings = [];

      for (const s of samples) {
        const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
        const data = weatherMap.get(key);
        if (data) {
          const w = interpolateWeatherAtTime(data, s.eta);
          if (w) {
            const windScore = 1 - Math.min((w.wind_speed || 0) / 40, 1);
            const waveScore = 1 - Math.min((w.wave_height || 0) / 4, 1);
            const gustScore = 1 - Math.min((w.wind_gusts || 0) / 50, 1);
            const visScore = Math.min((w.visibility || 10000) / 10000, 1);
            const precipScore = 1 - Math.min((w.precipitation || 0) / 10, 1);
            totalComfort += windScore * 0.30 + waveScore * 0.30 + gustScore * 0.15 + visScore * 0.15 + precipScore * 0.10;
            count++;
            if (w.wind_speed > maxWind) maxWind = w.wind_speed;
            if (w.wave_height > maxWave) maxWave = w.wave_height;
            if (w.wind_gusts > 25) warnings.push('wind');
            if (w.wave_height > 2) warnings.push('waves');
          }
        }
      }

      return {
        departure: dep,
        comfort_score: count > 0 ? Math.round((totalComfort / count) * 100) / 100 : 0,
        max_wind_kts: Math.round(maxWind * 10) / 10,
        max_wave_m: Math.round(maxWave * 10) / 10,
        has_warnings: warnings.length > 0,
        warning_types: [...new Set(warnings)]
      };
    });

    // Sort by comfort (descending) and return top 5
    scored.sort((a, b) => b.comfort_score - a.comfort_score);
    res.json({
      total_distance_nm: Math.round(totalDist * 10) / 10,
      total_hours: Math.round((totalDist / speed) * 10) / 10,
      window: { start: start.toISOString(), end: end.toISOString() },
      departures: scored.slice(0, 5)
    });
  } catch (err) {
    console.error('Optimal departure error:', err.message);
    res.status(502).json({ error: 'Optimal departure calc failed', detail: err.message });
  }
});

// ── POST /compare — model comparison ──
router.post('/compare', async (req, res) => {
  try {
    const { waypoints, departure_time, boat_speed_kts, models } = req.body;

    if (!waypoints || waypoints.length < 2) {
      return res.status(400).json({ error: 'At least 2 waypoints required' });
    }
    const depParsed = Date.parse(departure_time);
    if (!departure_time || isNaN(depParsed)) {
      return res.status(400).json({ error: 'Valid departure_time required (ISO 8601)' });
    }
    const speed = parseFloat(boat_speed_kts) || 7;
    const modelList = (models || ['ecmwf', 'gfs']).slice(0, 3);

    for (const wp of waypoints) {
      if (wp.lat == null || wp.lon == null || wp.lat < -90 || wp.lat > 90 || wp.lon < -180 || wp.lon > 180) {
        return res.status(400).json({ error: `Invalid waypoint: ${JSON.stringify(wp)}` });
      }
    }

    // Check rate limit budget
    if (!hasComparisonBudget(modelList.length)) {
      return res.status(429).json({ error: 'Insufficient rate limit budget for comparison' });
    }

    // Run models in parallel
    const modelResults = await Promise.allSettled(
      modelList.map(async modelKey => {
        const { samples, weatherMap } = await fetchGridWeather(waypoints, speed, departure_time, modelKey);
        const result = calculateRouteWeather(waypoints, samples, weatherMap, speed);
        // Trim samples (every 2nd point) to reduce payload
        result.samples = result.samples.filter((_, i) => i % 2 === 0);
        return { model: modelKey, ...result };
      })
    );

    // Build response
    const modelsOut = {};
    for (const r of modelResults) {
      if (r.status === 'fulfilled') {
        const { model, summary, warnings, legs } = r.value;
        modelsOut[model] = { summary, warnings, legs: legs.map(l => ({ from: l.from, to: l.to, distance_nm: l.distance_nm, hours: l.hours })) };
      }
    }

    // Compute comparison metrics
    const summaries = Object.values(modelsOut).map(m => m.summary).filter(Boolean);
    const maxWinds = summaries.map(s => s.max_wind_kts).filter(v => v != null);
    const maxWaves = summaries.map(s => s.max_wave_m).filter(v => v != null);
    const comforts = {};
    for (const [k, v] of Object.entries(modelsOut)) {
      if (v.summary?.avg_comfort != null) comforts[k] = v.summary.avg_comfort;
    }

    const maxWindSpread = maxWinds.length >= 2 ? Math.max(...maxWinds) - Math.min(...maxWinds) : 0;
    const maxWaveSpread = maxWaves.length >= 2 ? Math.max(...maxWaves) - Math.min(...maxWaves) : 0;

    // Agreement: based on relative spread
    const avgWind = maxWinds.length ? maxWinds.reduce((a, b) => a + b, 0) / maxWinds.length : 0;
    const windSpreadPct = avgWind > 0 ? maxWindSpread / avgWind : 0;
    const agreement = windSpreadPct < 0.15 ? 'high' : windSpreadPct < 0.30 ? 'moderate' : 'low';

    res.json({
      models: modelsOut,
      comparison: {
        max_wind_spread_kts: Math.round(maxWindSpread * 10) / 10,
        max_wave_spread_m: Math.round(maxWaveSpread * 10) / 10,
        comfort_scores: comforts,
        agreement
      }
    });
  } catch (err) {
    console.error('Compare error:', err.message);
    res.status(502).json({ error: 'Comparison failed', detail: err.message });
  }
});

// ── GET /health — provider health + rate limits ──
router.get('/health', (req, res) => {
  res.json({
    providers: getHealthStatus(),
    rate_limits: getRateLimitStatus(),
    timestamp: new Date().toISOString()
  });
});

// ── GET /models — available forecast models ──
router.get('/models', (req, res) => {
  const health = getHealthStatus();
  res.json({
    models: [
      { id: 'best', name: 'Best Available', description: 'Open-Meteo auto-selects best model for location', marine: null },
      { id: 'gfs', name: 'GFS', description: 'NOAA Global Forecast System — 16-day, 0.25° global', marine: 'GFS-Wave (ncep_gfswave025)' },
      { id: 'ecmwf', name: 'ECMWF IFS', description: 'European model — generally most accurate, 10-day', marine: 'ECMWF WAM (ecmwf_wam025)' },
      { id: 'icon', name: 'ICON', description: 'DWD German model — good for Atlantic/European waters', marine: null }
    ],
    providers: Object.entries(health).map(([name, h]) => ({ name, status: h.status }))
  });
});

export default router;
