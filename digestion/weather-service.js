// ============================================================
// WEATHER SERVICE — Express Router for weather routing
// ============================================================
// Proxies Open-Meteo (free, no auth), caches responses,
// calculates time-interpolated route weather.
//
// Endpoints:
//   GET  /forecast              Single-point forecast (auto-detect boat position if no lat/lon)
//   POST /route                 Route weather calculation
//   POST /optimal-departure     Best departure time finder
//   POST /compare               Model comparison
//   GET  /grid                  Weather grid for map overlay
//   GET  /models                Available forecast models
//   GET  /health                Provider health + rate limits
//   GET  /analysis              AI-ready weather analysis text
//   GET  /passage               Simple passage planning
//   GET  /squall                Squall risk assessment
// ============================================================

import { Router } from 'express';
import { createRequire } from 'module';
import pg from 'pg';
import { fetchWithFailover, getHealthStatus, getRateLimitStatus, hasComparisonBudget } from './weather-providers.js';
import { forecastTelemetry, forecastMultiMetric, healthCheck as timesfmHealth } from './timesfm-client.js';

// searoute-js is CJS — load via createRequire
const _require = createRequire(import.meta.url);
let searoute;
try {
  searoute = _require('searoute-js');
  console.log('[weather-service] searoute-js loaded — sea routing enabled');
} catch (e) {
  console.warn('[weather-service] searoute-js not available, using straight-line routing');
  searoute = null;
}

const router = Router();

// ── Constants ──
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE = 500;
const SAMPLE_INTERVAL_NM = 20;
const R_NM = 3440.065;
const DEG = Math.PI / 180;

// Default position: St. Vincent
const DEFAULT_LAT = 13.2639;
const DEFAULT_LON = -61.2614;
const BOAT_ID = 58;

// ── Database connection (same pattern as boat-ingestion.js) ──
const { Pool } = pg;
let pool = null;
let dbReady = false;

function createDbPool() {
  const p = new Pool({
    host: process.env.MC_DB_HOST || 'mastercommander-db',
    user: process.env.MC_DB_USER || 'mastercommander',
    database: process.env.MC_DB_NAME || 'mastercommander',
    password: process.env.MC_DB_PASS,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  p.on('error', (err) => {
    console.warn('[weather-service] DB pool error:', err.message);
    dbReady = false;
  });
  return p;
}

async function ensureDb() {
  if (dbReady && pool) return pool;
  if (!pool) pool = createDbPool();
  try {
    const client = await pool.connect();
    client.release();
    dbReady = true;
    console.log('[weather-service] DB connected');
    return pool;
  } catch (err) {
    console.warn('[weather-service] DB not available:', err.message);
    dbReady = false;
    return null;
  }
}

// Try connecting on startup
setTimeout(() => ensureDb(), 2000);

// ── Get boat position from telemetry DB ──
async function getBoatPosition() {
  const db = await ensureDb();
  if (!db) return { lat: DEFAULT_LAT, lon: DEFAULT_LON, source: 'default' };
  try {
    const res = await db.query(
      `SELECT snapshot->'nmea'->'position' as pos FROM boat_telemetry WHERE boat_id=$1 ORDER BY ts DESC LIMIT 1`,
      [BOAT_ID]
    );
    if (res.rows.length && res.rows[0].pos) {
      const pos = res.rows[0].pos;
      return { lat: pos.lat, lon: pos.lon, source: 'telemetry' };
    }
  } catch (err) {
    console.warn('[weather-service] getBoatPosition error:', err.message);
  }
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON, source: 'default' };
}

// ── Get live telemetry snapshot (for squall detection) ──
async function getLatestTelemetry() {
  const db = await ensureDb();
  if (!db) return null;
  try {
    const res = await db.query(
      `SELECT ts, snapshot->'nmea' as nmea FROM boat_telemetry WHERE boat_id=$1 ORDER BY ts DESC LIMIT 1`,
      [BOAT_ID]
    );
    if (res.rows.length) {
      return { ts: res.rows[0].ts, nmea: res.rows[0].nmea };
    }
  } catch (err) {
    console.warn('[weather-service] getLatestTelemetry error:', err.message);
  }
  return null;
}

// ── Get barometer history for squall detection ──
async function getBaroHistory(minutes) {
  const db = await ensureDb();
  if (!db) return [];
  try {
    const res = await db.query(
      `SELECT ts, (snapshot->'nmea'->>'baro_mbar')::float as baro
       FROM boat_telemetry
       WHERE boat_id=$1 AND ts > NOW() - make_interval(mins => $2)
         AND snapshot->'nmea'->'baro_mbar' IS NOT NULL
       ORDER BY ts ASC`,
      [BOAT_ID, minutes]
    );
    if (!res.rows.length) return [];
    // Thin to ~1 reading per minute to avoid noise
    const thinned = [];
    let lastTs = 0;
    for (const row of res.rows) {
      const t = new Date(row.ts).getTime();
      if (t - lastTs >= 55000) { // ~1 per minute
        thinned.push({ ts: row.ts, baro: row.baro });
        lastTs = t;
      }
    }
    return thinned;
  } catch (err) {
    console.warn('[weather-service] getBaroHistory error:', err.message);
    return [];
  }
}

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

function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
            Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
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

// ── Compass direction from degrees ──
function compassDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Beaufort scale ──
function beaufort(kts) {
  if (kts < 1) return { force: 0, desc: 'Calm' };
  if (kts < 4) return { force: 1, desc: 'Light air' };
  if (kts < 7) return { force: 2, desc: 'Light breeze' };
  if (kts < 11) return { force: 3, desc: 'Gentle breeze' };
  if (kts < 17) return { force: 4, desc: 'Moderate breeze' };
  if (kts < 22) return { force: 5, desc: 'Fresh breeze' };
  if (kts < 28) return { force: 6, desc: 'Strong breeze' };
  if (kts < 34) return { force: 7, desc: 'Near gale' };
  if (kts < 41) return { force: 8, desc: 'Gale' };
  if (kts < 48) return { force: 9, desc: 'Strong gale' };
  if (kts < 56) return { force: 10, desc: 'Storm' };
  if (kts < 64) return { force: 11, desc: 'Violent storm' };
  return { force: 12, desc: 'Hurricane' };
}

// ── Sea routing (land avoidance) ──
function getSeaRoute(wp1, wp2) {
  if (!searoute) return null;
  try {
    const origin = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [wp1.lon, wp1.lat] } };
    const dest = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [wp2.lon, wp2.lat] } };
    const route = searoute(origin, dest);
    if (!route || !route.geometry || !route.geometry.coordinates || route.geometry.coordinates.length < 2) return null;

    const path = route.geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] }));
    const distNm = route.properties?.length || haversine(wp1.lat, wp1.lon, wp2.lat, wp2.lon);

    // Sanity check: if sea route is >3x straight line, network is probably wrong — fall back
    const straightDist = haversine(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
    if (distNm > straightDist * 3 && straightDist > 10) {
      console.warn(`[weather-service] searoute ${wp1.lat},${wp1.lon} -> ${wp2.lat},${wp2.lon}: ${Math.round(distNm)}nm vs ${Math.round(straightDist)}nm straight — using straight line`);
      return null;
    }
    return { path, distance_nm: distNm };
  } catch (e) {
    console.warn('[weather-service] searoute error:', e.message);
    return null;
  }
}

function generateSeaRoutePath(waypoints) {
  const legs = [];
  const fullPath = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const sr = getSeaRoute(waypoints[i], waypoints[i + 1]);
    if (sr) {
      legs.push(sr);
      if (fullPath.length > 0) fullPath.pop();
      fullPath.push(...sr.path);
    } else {
      const straightDist = haversine(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
      const path = [{ lat: waypoints[i].lat, lon: waypoints[i].lon }, { lat: waypoints[i + 1].lat, lon: waypoints[i + 1].lon }];
      legs.push({ path, distance_nm: straightDist });
      if (fullPath.length > 0) fullPath.pop();
      fullPath.push(...path);
    }
  }
  return { legs, fullPath };
}

// Walk along a multi-segment path and place sample points every SAMPLE_INTERVAL_NM
function generateSamplesAlongPath(legPath, legDist, legIndex, boatSpeedKts, cumulativeHours, depMs) {
  const samples = [];
  const legHours = legDist / boatSpeedKts;
  const numSamples = Math.max(2, Math.ceil(legDist / SAMPLE_INTERVAL_NM) + 1);

  const segDists = [];
  let totalPathDist = 0;
  for (let i = 1; i < legPath.length; i++) {
    const d = haversine(legPath[i - 1].lat, legPath[i - 1].lon, legPath[i].lat, legPath[i].lon);
    segDists.push(d);
    totalPathDist += d;
  }
  const actualDist = totalPathDist > 0 ? totalPathDist : legDist;

  for (let j = 0; j < numSamples; j++) {
    const frac = j / (numSamples - 1);
    const targetDist = frac * actualDist;

    let accumulated = 0;
    let pt = { lat: legPath[0].lat, lon: legPath[0].lon };
    for (let s = 0; s < segDists.length; s++) {
      if (accumulated + segDists[s] >= targetDist || s === segDists.length - 1) {
        const segFrac = segDists[s] > 0 ? (targetDist - accumulated) / segDists[s] : 0;
        const clampedFrac = Math.max(0, Math.min(1, segFrac));
        pt = interpolatePoint(legPath[s].lat, legPath[s].lon, legPath[s + 1].lat, legPath[s + 1].lon, clampedFrac);
        break;
      }
      accumulated += segDists[s];
    }

    const hoursAtPoint = cumulativeHours + legHours * frac;
    const etaMs = depMs + hoursAtPoint * 3600000;
    samples.push({
      lat: pt.lat,
      lon: pt.lon,
      leg: legIndex,
      fraction: frac,
      distance_nm: frac * actualDist,
      hours_from_departure: hoursAtPoint,
      eta: new Date(etaMs).toISOString()
    });
  }
  return { samples, legDist: actualDist, legHours };
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
  icon: { weather: 'icon_seamless', marine: null },
  best: { weather: null, marine: null }
};

async function fetchWeather(lat, lon, hours, model) {
  const gridLat = roundToGrid(lat);
  const gridLon = roundToGrid(lon);
  const modelKey = model || 'best';
  const modelCfg = MODEL_MAP[modelKey] || MODEL_MAP.best;
  const cacheKey = `w:${modelKey}:${gridLat}:${gridLon}:${hours || 168}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const result = await fetchWithFailover('weather', gridLat, gridLon, hours || 168, modelCfg.weather);
  if (result.data) cacheSet(cacheKey, result.data);
  return result.data;
}

async function fetchMarine(lat, lon, hours, model) {
  const gridLat = roundToGrid(lat);
  const gridLon = roundToGrid(lon);
  const modelKey = model || 'best';
  const modelCfg = MODEL_MAP[modelKey] || MODEL_MAP.best;
  const cacheKey = `m:${modelKey}:${gridLat}:${gridLon}:${hours || 168}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const result = await fetchWithFailover('marine', gridLat, gridLon, hours || 168, modelCfg.marine);
  if (result.data) cacheSet(cacheKey, result.data);
  return result.data;
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
function generateSamplePoints(waypoints, boatSpeedKts, departureTime, seaRouteLegs) {
  const depMs = new Date(departureTime).getTime();

  if (seaRouteLegs && seaRouteLegs.length === waypoints.length - 1) {
    const allSamples = [];
    let cumulativeHours = 0;
    let cumulativeDist = 0;
    for (let i = 0; i < seaRouteLegs.length; i++) {
      const leg = seaRouteLegs[i];
      const result = generateSamplesAlongPath(leg.path, leg.distance_nm, i, boatSpeedKts, cumulativeHours, depMs);
      for (const s of result.samples) {
        s.distance_nm += cumulativeDist;
      }
      allSamples.push(...result.samples);
      cumulativeHours += result.legHours;
      cumulativeDist += result.legDist;
    }
    return allSamples;
  }

  const samples = [];
  let cumulativeHours = 0;
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
        lat: pt.lat, lon: pt.lon, leg: i, fraction: frac,
        distance_nm: legDist * frac,
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
function calculateSummary(waypoints, samplePoints, boatSpeedKts, totalDistOverride) {
  let totalDist = totalDistOverride || 0;
  if (!totalDist) {
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon,
                             waypoints[i].lat, waypoints[i].lon);
    }
  }

  const withWeather = samplePoints.filter(s => s.weather);
  const winds = withWeather.map(s => s.weather.wind_speed).filter(v => v != null);
  const gusts = withWeather.map(s => s.weather.wind_gusts).filter(v => v != null);
  const waves = withWeather.map(s => s.weather.wave_height).filter(v => v != null);
  const pressures = withWeather.map(s => s.weather.pressure).filter(v => v != null);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const max = arr => arr.length ? Math.max(...arr) : null;

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

// ── Calculate route weather from pre-fetched data ──
function calculateRouteWeather(waypoints, samples, weatherMap, speed, seaRouteLegs) {
  for (const s of samples) {
    const key = `${roundToGrid(s.lat)}:${roundToGrid(s.lon)}`;
    const data = weatherMap.get(key);
    if (data) {
      s.weather = interpolateWeatherAtTime(data, s.eta);
    }
  }

  let totalSeaDist = 0;
  if (seaRouteLegs) {
    for (const leg of seaRouteLegs) totalSeaDist += leg.distance_nm;
  }

  const warnings = generateWarnings(samples);
  const summary = calculateSummary(waypoints, samples, speed, totalSeaDist || null);

  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const legSamples = samples.filter(s => s.leg === i);
    const legDist = seaRouteLegs ? seaRouteLegs[i].distance_nm
      : haversine(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
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

// ── Fetch weather data for grid cells ──
async function fetchGridWeather(waypoints, speed, departureTime, modelKey, seaRouteLegs) {
  const samples = generateSamplePoints(waypoints, speed, departureTime, seaRouteLegs);

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

// ── GET /forecast — combined marine + weather forecast for boat's position ──
router.get('/forecast', async (req, res) => {
  try {
    let lat = parseFloat(req.query.lat);
    let lon = parseFloat(req.query.lon);
    const hours = parseInt(req.query.hours) || 168;
    const model = req.query.model || 'best';

    // Auto-detect boat position if no lat/lon provided
    let posSource = 'query';
    if (isNaN(lat) || isNaN(lon)) {
      const pos = await getBoatPosition();
      lat = pos.lat;
      lon = pos.lon;
      posSource = pos.source;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid lat/lon' });
    }

    const [weather, marine] = await Promise.all([
      fetchWeather(lat, lon, hours, model),
      fetchMarine(lat, lon, hours, model)
    ]);

    const merged = mergeData(weather, marine);
    if (!merged || merged.length === 0) {
      return res.status(502).json({ error: 'No forecast data available' });
    }

    // Current conditions (closest hour to now)
    const now = Date.now();
    let currentIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const diff = Math.abs(new Date(merged[i].time).getTime() - now);
      if (diff < bestDiff) { bestDiff = diff; currentIdx = i; }
    }
    const c = merged[currentIdx];

    const current = {
      wind_kts: Math.round(c.wind_speed || 0),
      wind_dir: Math.round(c.wind_direction || 0),
      gusts_kts: Math.round(c.wind_gusts || 0),
      pressure: Math.round(c.pressure || 0),
      temp: Math.round(c.temperature || 0),
      waves: Math.round((c.wave_height || 0) * 10) / 10,
      swell: Math.round((c.swell_height || 0) * 10) / 10
    };

    // Hourly summary (next 72 hours)
    const hourly_summary = merged.slice(currentIdx, currentIdx + 72).map(h => ({
      time: h.time,
      wind_kts: Math.round(h.wind_speed || 0),
      gusts: Math.round(h.wind_gusts || 0),
      dir: Math.round(h.wind_direction || 0),
      rain_mm: Math.round((h.precipitation || 0) * 10) / 10,
      pressure: Math.round(h.pressure || 0),
      waves_m: Math.round((h.wave_height || 0) * 10) / 10,
      swell_m: Math.round((h.swell_height || 0) * 10) / 10,
      temp: Math.round(h.temperature || 0)
    }));

    // Daily summary (aggregate by date)
    const dailyMap = new Map();
    for (const h of merged.slice(currentIdx)) {
      const date = h.time.substring(0, 10);
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { winds: [], gusts: [], rain: [], waves: [], pressures: [] });
      }
      const d = dailyMap.get(date);
      if (h.wind_speed != null) d.winds.push(h.wind_speed);
      if (h.wind_gusts != null) d.gusts.push(h.wind_gusts);
      if (h.precipitation != null) d.rain.push(h.precipitation);
      if (h.wave_height != null) d.waves.push(h.wave_height);
      if (h.pressure != null) d.pressures.push(h.pressure);
    }

    const daily_summary = [];
    for (const [date, d] of dailyMap) {
      const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const pFirst = d.pressures[0] || 0;
      const pLast = d.pressures[d.pressures.length - 1] || 0;
      const pDiff = pLast - pFirst;
      daily_summary.push({
        date,
        wind_avg: Math.round(avg(d.winds)),
        wind_max: Math.round(d.winds.length ? Math.max(...d.winds) : 0),
        gust_max: Math.round(d.gusts.length ? Math.max(...d.gusts) : 0),
        rain_total: Math.round(d.rain.reduce((a, b) => a + b, 0) * 10) / 10,
        wave_max: Math.round((d.waves.length ? Math.max(...d.waves) : 0) * 10) / 10,
        pressure_trend: pDiff > 2 ? 'rising' : pDiff < -2 ? 'falling' : 'steady'
      });
    }

    // Generate alerts
    const alerts = [];
    for (const h of merged.slice(currentIdx, currentIdx + 48)) {
      if (h.wind_gusts > 30) {
        alerts.push({ type: 'gale_warning', message: `Gusts to ${Math.round(h.wind_gusts)} kts at ${h.time}`, severity: h.wind_gusts > 40 ? 'danger' : 'warning' });
      }
      if (h.wave_height > 3) {
        alerts.push({ type: 'high_seas', message: `Waves ${h.wave_height.toFixed(1)}m at ${h.time}`, severity: h.wave_height > 4 ? 'danger' : 'warning' });
      }
    }
    // Deduplicate alerts by type
    const seenAlerts = new Set();
    const uniqueAlerts = alerts.filter(a => {
      const key = `${a.type}:${a.severity}`;
      if (seenAlerts.has(key)) return false;
      seenAlerts.add(key);
      return true;
    });

    res.json({
      position: { lat: roundToGrid(lat), lon: roundToGrid(lon) },
      position_source: posSource,
      current,
      hourly_summary,
      daily_summary,
      alerts: uniqueAlerts,
      fetched_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[weather-service] forecast error:', err.message);
    res.status(502).json({ error: 'Failed to fetch forecast', detail: err.message });
  }
});

// ── GET /analysis — human-readable weather analysis ──
router.get('/analysis', async (req, res) => {
  try {
    const pos = await getBoatPosition();
    const lat = pos.lat;
    const lon = pos.lon;

    const [weather, marine] = await Promise.all([
      fetchWeather(lat, lon, 168, 'best'),
      fetchMarine(lat, lon, 168, 'best')
    ]);

    const merged = mergeData(weather, marine);
    if (!merged || merged.length === 0) {
      return res.status(502).json({ error: 'No forecast data available' });
    }

    // Get live telemetry for comparison
    const telemetry = await getLatestTelemetry();

    // Find current conditions
    const now = Date.now();
    let currentIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const diff = Math.abs(new Date(merged[i].time).getTime() - now);
      if (diff < bestDiff) { bestDiff = diff; currentIdx = i; }
    }
    const c = merged[currentIdx];

    // Next 24h / 48h / 72h
    const next24 = merged.slice(currentIdx, currentIdx + 24);
    const next48 = merged.slice(currentIdx, currentIdx + 48);
    const next72 = merged.slice(currentIdx, currentIdx + 72);

    // Stats helpers
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const maxVal = arr => arr.length ? Math.max(...arr) : 0;

    // Wind stats
    const winds24 = next24.map(h => h.wind_speed).filter(v => v != null);
    const gusts24 = next24.map(h => h.wind_gusts).filter(v => v != null);
    const waves24 = next24.map(h => h.wave_height).filter(v => v != null);
    const rain24 = next24.map(h => h.precipitation).filter(v => v != null);
    const pressure24 = next24.map(h => h.pressure).filter(v => v != null);

    const windAvg24 = Math.round(avg(winds24));
    const gustMax24 = Math.round(maxVal(gusts24));
    const waveMax24 = Math.round(maxVal(waves24) * 10) / 10;
    const rainTotal24 = Math.round(rain24.reduce((a, b) => a + b, 0) * 10) / 10;

    const bfCurrent = beaufort(c.wind_speed || 0);
    const currentDir = compassDir(c.wind_direction || 0);

    // Pressure trend
    const pressureStart = pressure24[0] || 0;
    const pressureEnd = pressure24[pressure24.length - 1] || 0;
    const pressureChange = pressureEnd - pressureStart;
    let pressureTrend = 'steady';
    if (pressureChange > 3) pressureTrend = 'rising significantly';
    else if (pressureChange > 1) pressureTrend = 'rising slowly';
    else if (pressureChange < -3) pressureTrend = 'falling significantly';
    else if (pressureChange < -1) pressureTrend = 'falling slowly';

    // Weather building detection
    const winds48 = next48.map(h => h.wind_speed).filter(v => v != null);
    const gusts48 = next48.map(h => h.wind_gusts).filter(v => v != null);
    const weatherBuilding = winds48.length > 24 && maxVal(winds48.slice(24)) > maxVal(winds48.slice(0, 24)) * 1.3;

    // Comfort assessment
    const currentWind = c.wind_speed || 0;
    const currentWaves = c.wave_height || 0;
    let comfort = 'Excellent';
    if (currentWind > 25 || currentWaves > 2.5) comfort = 'Poor';
    else if (currentWind > 18 || currentWaves > 1.8) comfort = 'Fair';
    else if (currentWind > 12 || currentWaves > 1.2) comfort = 'Good';

    // Passage windows (find calm periods in next 72h)
    const passageWindows = [];
    let windowStart = null;
    for (let i = 0; i < next72.length; i++) {
      const h = next72[i];
      const isCalm = (h.wind_speed || 0) < 15 && (h.wave_height || 99) < 1.5;
      if (isCalm && !windowStart) {
        windowStart = i;
      } else if (!isCalm && windowStart !== null) {
        const durationH = i - windowStart;
        if (durationH >= 6) {
          passageWindows.push({ start: next72[windowStart].time, end: next72[i - 1].time, duration_hours: durationH });
        }
        windowStart = null;
      }
    }
    if (windowStart !== null) {
      const durationH = next72.length - windowStart;
      if (durationH >= 6) {
        passageWindows.push({ start: next72[windowStart].time, end: next72[next72.length - 1].time, duration_hours: durationH });
      }
    }

    // Build analysis text
    const lines = [];
    lines.push('WEATHER ANALYSIS -- SV Blue Moon');
    lines.push(`Position: ${lat.toFixed(4)}N, ${Math.abs(lon).toFixed(4)}W (${pos.source})`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    lines.push('=== CURRENT CONDITIONS ===');
    lines.push(`Wind: ${Math.round(c.wind_speed || 0)} kts from ${currentDir} (${Math.round(c.wind_direction || 0)} deg) -- Beaufort ${bfCurrent.force} (${bfCurrent.desc})`);
    lines.push(`Gusts: ${Math.round(c.wind_gusts || 0)} kts`);
    lines.push(`Pressure: ${Math.round(c.pressure || 0)} mbar (${pressureTrend})`);
    lines.push(`Temperature: ${Math.round(c.temperature || 0)} C`);
    lines.push(`Waves: ${(c.wave_height || 0).toFixed(1)}m | Swell: ${(c.swell_height || 0).toFixed(1)}m`);
    if (telemetry && telemetry.nmea) {
      const nmea = telemetry.nmea;
      lines.push('');
      lines.push('Live instruments:');
      lines.push(`  Baro: ${nmea.baro_mbar || 'N/A'} mbar | Wind: ${nmea.wind_speed_kts || 'N/A'} kts from ${Math.round(nmea.wind_dir_true || 0)} deg`);
      lines.push(`  Water temp: ${nmea.water_temp_c || 'N/A'} C | Depth: ${nmea.depth_m || 'N/A'}m`);
      const baroDiff = nmea.baro_mbar && c.pressure ? nmea.baro_mbar - Math.round(c.pressure) : null;
      if (baroDiff != null && Math.abs(baroDiff) > 2) {
        lines.push(`  NOTE: Live baro ${baroDiff > 0 ? 'higher' : 'lower'} than forecast by ${Math.abs(baroDiff)} mbar`);
      }
    }
    lines.push(`Comfort at anchor: ${comfort}`);
    lines.push('');

    lines.push('=== NEXT 24 HOURS ===');
    lines.push(`Wind: avg ${windAvg24} kts, gusts to ${gustMax24} kts`);
    lines.push(`Waves: up to ${waveMax24}m`);
    lines.push(`Rain: ${rainTotal24 > 0 ? rainTotal24 + 'mm total' : 'None expected'}`);
    lines.push(`Pressure: ${pressureTrend} (${Math.round(pressureStart)} -> ${Math.round(pressureEnd)} mbar)`);
    lines.push('');

    if (weatherBuilding) {
      lines.push('=== WEATHER BUILDING ===');
      lines.push('Wind is forecast to increase significantly in the next 24-48 hours.');
      lines.push(`24-48h winds: up to ${Math.round(maxVal(winds48.slice(24)))} kts with gusts to ${Math.round(maxVal(gusts48.slice(24)))} kts`);
      lines.push('Consider sheltering or passage planning now.');
      lines.push('');
    }

    if (passageWindows.length > 0) {
      lines.push('=== PASSAGE WINDOWS (next 72h) ===');
      for (const w of passageWindows) {
        const start = w.start.substring(5, 16).replace('T', ' ');
        const end = w.end.substring(5, 16).replace('T', ' ');
        lines.push(`  ${start} to ${end} (${w.duration_hours}h) -- winds <15 kts, seas <1.5m`);
      }
      lines.push('');
    } else {
      lines.push('=== PASSAGE WINDOWS ===');
      lines.push('No extended calm windows (>6h with <15kts, <1.5m seas) in next 72 hours.');
      lines.push('');
    }

    // 7-day outlook
    const dailyMap = new Map();
    for (const h of merged.slice(currentIdx)) {
      const date = h.time.substring(0, 10);
      if (!dailyMap.has(date)) dailyMap.set(date, { winds: [], gusts: [], waves: [], rain: [] });
      const d = dailyMap.get(date);
      if (h.wind_speed != null) d.winds.push(h.wind_speed);
      if (h.wind_gusts != null) d.gusts.push(h.wind_gusts);
      if (h.wave_height != null) d.waves.push(h.wave_height);
      if (h.precipitation != null) d.rain.push(h.precipitation);
    }
    lines.push('=== 7-DAY OUTLOOK ===');
    for (const [date, d] of dailyMap) {
      const wAvg = Math.round(avg(d.winds));
      const gMax = Math.round(maxVal(d.gusts));
      const wMax = Math.round(maxVal(d.waves) * 10) / 10;
      const rSum = Math.round(d.rain.reduce((a, b) => a + b, 0) * 10) / 10;
      lines.push(`  ${date}: wind ${wAvg} (G${gMax}) kts, waves ${wMax}m${rSum > 0 ? ', rain ' + rSum + 'mm' : ''}`);
    }

    const analysis = lines.join('\n');

    res.type('text/plain').send(analysis);
  } catch (err) {
    console.error('[weather-service] analysis error:', err.message);
    res.status(502).json({ error: 'Analysis failed', detail: err.message });
  }
});

// ── GET /passage — simple passage planning ──
router.get('/passage', async (req, res) => {
  try {
    const toLat = parseFloat(req.query.to_lat);
    const toLon = parseFloat(req.query.to_lon);
    const speed = parseFloat(req.query.speed) || 7;

    if (isNaN(toLat) || isNaN(toLon)) {
      return res.status(400).json({ error: 'Required: to_lat, to_lon' });
    }
    if (toLat < -90 || toLat > 90 || toLon < -180 || toLon > 180) {
      return res.status(400).json({ error: 'Invalid destination coordinates' });
    }

    const pos = await getBoatPosition();
    const fromLat = pos.lat;
    const fromLon = pos.lon;

    // Distance and bearing
    const distNm = haversine(fromLat, fromLon, toLat, toLon);
    const brg = bearing(fromLat, fromLon, toLat, toLon);
    const passageHours = distNm / speed;

    // Fetch weather along route
    const [weather, marine] = await Promise.all([
      fetchWeather(fromLat, fromLon, 168, 'best'),
      fetchMarine(fromLat, fromLon, 168, 'best')
    ]);
    const merged = mergeData(weather, marine);

    // Also fetch destination weather
    const [destWeather, destMarine] = await Promise.all([
      fetchWeather(toLat, toLon, 168, 'best'),
      fetchMarine(toLat, toLon, 168, 'best')
    ]);
    const destMerged = mergeData(destWeather, destMarine);

    // Find current conditions index
    const now = Date.now();
    let currentIdx = 0;
    let bestDiffVal = Infinity;
    if (merged) {
      for (let i = 0; i < merged.length; i++) {
        const diff = Math.abs(new Date(merged[i].time).getTime() - now);
        if (diff < bestDiffVal) { bestDiffVal = diff; currentIdx = i; }
      }
    }

    // Identify weather windows for departure (next 72h)
    const windows = [];
    if (merged) {
      const next72 = merged.slice(currentIdx, currentIdx + 72);
      let windowStart = null;
      for (let i = 0; i < next72.length; i++) {
        const h = next72[i];
        const isGood = (h.wind_speed || 0) < 20 && (h.wave_height || 99) < 2.0 && (h.wind_gusts || 0) < 25;
        if (isGood && windowStart === null) {
          windowStart = i;
        } else if (!isGood && windowStart !== null) {
          const durationH = i - windowStart;
          if (durationH >= passageHours || durationH >= 6) {
            windows.push({
              depart: next72[windowStart].time,
              end: next72[i - 1].time,
              duration_hours: durationH,
              sufficient_for_passage: durationH >= passageHours
            });
          }
          windowStart = null;
        }
      }
      if (windowStart !== null) {
        const durationH = next72.length - windowStart;
        if (durationH >= passageHours || durationH >= 6) {
          windows.push({
            depart: next72[windowStart].time,
            end: next72[next72.length - 1].time,
            duration_hours: durationH,
            sufficient_for_passage: durationH >= passageHours
          });
        }
      }
    }

    // Wind along route assessment
    let avgWindRoute = 0;
    let maxGustRoute = 0;
    let maxWaveRoute = 0;
    if (merged) {
      const passageSlice = merged.slice(currentIdx, currentIdx + Math.ceil(passageHours) + 1);
      const winds = passageSlice.map(h => h.wind_speed).filter(v => v != null);
      const gusts = passageSlice.map(h => h.wind_gusts).filter(v => v != null);
      const waves = passageSlice.map(h => h.wave_height).filter(v => v != null);
      avgWindRoute = winds.length ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length) : 0;
      maxGustRoute = gusts.length ? Math.round(Math.max(...gusts)) : 0;
      maxWaveRoute = waves.length ? Math.round(Math.max(...waves) * 10) / 10 : 0;
    }

    // Go/no-go recommendation
    let recommendation = 'GO';
    let reasons = [];
    if (maxGustRoute > 35) { recommendation = 'NO-GO'; reasons.push(`Gusts to ${maxGustRoute} kts forecast`); }
    else if (maxGustRoute > 25) { recommendation = 'CAUTION'; reasons.push(`Gusts to ${maxGustRoute} kts`); }
    if (maxWaveRoute > 3) { recommendation = 'NO-GO'; reasons.push(`Waves to ${maxWaveRoute}m`); }
    else if (maxWaveRoute > 2) { if (recommendation !== 'NO-GO') recommendation = 'CAUTION'; reasons.push(`Waves to ${maxWaveRoute}m`); }
    if (avgWindRoute > 25) { recommendation = 'NO-GO'; reasons.push(`Avg wind ${avgWindRoute} kts`); }
    if (passageHours > 48) { if (recommendation !== 'NO-GO') recommendation = 'CAUTION'; reasons.push(`Long passage (${Math.round(passageHours)}h)`); }
    if (reasons.length === 0) reasons.push('Conditions favorable');

    res.json({
      from: { lat: fromLat, lon: fromLon, source: pos.source },
      to: { lat: toLat, lon: toLon },
      distance_nm: Math.round(distNm * 10) / 10,
      bearing_deg: Math.round(brg),
      bearing_compass: compassDir(brg),
      estimated_hours: Math.round(passageHours * 10) / 10,
      estimated_speed_kts: speed,
      route_weather: {
        avg_wind_kts: avgWindRoute,
        max_gust_kts: maxGustRoute,
        max_wave_m: maxWaveRoute
      },
      weather_windows: windows,
      recommendation,
      reasons,
      fetched_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[weather-service] passage error:', err.message);
    res.status(502).json({ error: 'Passage planning failed', detail: err.message });
  }
});

// ── GET /squall — squall risk assessment ──
router.get('/squall', async (req, res) => {
  try {
    const pos = await getBoatPosition();
    const telemetry = await getLatestTelemetry();
    const baroHistory = await getBaroHistory(60); // last 60 minutes

    // Get forecast pressure
    const weather = await fetchWeather(pos.lat, pos.lon, 24, 'best');
    let forecastPressure = null;
    if (weather && weather.hourly && weather.hourly.pressure_msl) {
      const now = Date.now();
      let bestIdx = 0;
      let bestDiffVal = Infinity;
      for (let i = 0; i < weather.hourly.time.length; i++) {
        const diff = Math.abs(new Date(weather.hourly.time[i]).getTime() - now);
        if (diff < bestDiffVal) { bestDiffVal = diff; bestIdx = i; }
      }
      forecastPressure = weather.hourly.pressure_msl[bestIdx];
    }

    // Live baro
    const liveBaro = telemetry?.nmea?.baro_mbar || null;

    // Calculate rate of pressure change
    let pressureRatePerHour = null;
    let pressureChange30min = null;
    let pressureChange60min = null;
    if (baroHistory.length >= 2) {
      const first = baroHistory[0];
      const last = baroHistory[baroHistory.length - 1];
      const durationMs = new Date(last.ts).getTime() - new Date(first.ts).getTime();
      const durationHours = durationMs / 3600000;
      if (durationHours > 0) {
        pressureRatePerHour = (last.baro - first.baro) / durationHours;
      }

      // 30-min change
      const thirtyMinAgo = Date.now() - 30 * 60000;
      const thirtyMinEntry = baroHistory.find(b => new Date(b.ts).getTime() >= thirtyMinAgo);
      if (thirtyMinEntry && liveBaro) {
        pressureChange30min = liveBaro - thirtyMinEntry.baro;
      }

      // 60-min change
      if (liveBaro && first.baro) {
        pressureChange60min = liveBaro - first.baro;
      }
    }

    // Forecast vs live delta
    const forecastDelta = (liveBaro && forecastPressure) ? liveBaro - forecastPressure : null;

    // Determine risk level
    let risk = 'low';
    let riskFactors = [];

    // Rapid pressure drop is the primary squall indicator
    if (pressureRatePerHour !== null) {
      if (pressureRatePerHour < -3) {
        risk = 'high';
        riskFactors.push(`Rapid pressure drop: ${pressureRatePerHour.toFixed(1)} mbar/hr`);
      } else if (pressureRatePerHour < -1.5) {
        risk = 'moderate';
        riskFactors.push(`Pressure dropping: ${pressureRatePerHour.toFixed(1)} mbar/hr`);
      }
    }

    if (pressureChange30min !== null && pressureChange30min < -2) {
      if (risk !== 'high') risk = 'high';
      riskFactors.push(`30-min pressure drop: ${pressureChange30min.toFixed(1)} mbar`);
    }

    // Live pressure significantly below forecast
    if (forecastDelta !== null && forecastDelta < -4) {
      if (risk === 'low') risk = 'moderate';
      riskFactors.push(`Live baro ${Math.abs(forecastDelta).toFixed(1)} mbar below forecast`);
    }

    // Low absolute pressure in tropics
    if (liveBaro && liveBaro < 1005) {
      if (risk === 'low') risk = 'moderate';
      riskFactors.push(`Low absolute pressure: ${liveBaro} mbar`);
    }

    // Check forecast for upcoming wind spikes (squall proxies)
    if (weather && weather.hourly) {
      const now = Date.now();
      const next6h = weather.hourly.time
        .map((t, i) => ({ time: t, gust: weather.hourly.wind_gusts_10m?.[i], wind: weather.hourly.wind_speed_10m?.[i] }))
        .filter(h => {
          const t = new Date(h.time).getTime();
          return t >= now && t <= now + 6 * 3600000;
        });
      const maxGust6h = next6h.reduce((max, h) => Math.max(max, h.gust || 0), 0);
      const currentWind = next6h[0]?.wind || 0;
      if (maxGust6h > currentWind * 2 && maxGust6h > 20) {
        if (risk === 'low') risk = 'moderate';
        riskFactors.push(`Forecast gust spike: ${Math.round(maxGust6h)} kts in next 6h (current ${Math.round(currentWind)} kts)`);
      }
    }

    if (riskFactors.length === 0) {
      riskFactors.push('No squall indicators detected');
    }

    res.json({
      position: { lat: pos.lat, lon: pos.lon },
      risk,
      factors: riskFactors,
      barometer: {
        live_mbar: liveBaro,
        forecast_mbar: forecastPressure ? Math.round(forecastPressure * 10) / 10 : null,
        delta: forecastDelta ? Math.round(forecastDelta * 10) / 10 : null,
        rate_per_hour: pressureRatePerHour ? Math.round(pressureRatePerHour * 100) / 100 : null,
        change_30min: pressureChange30min ? Math.round(pressureChange30min * 10) / 10 : null,
        change_60min: pressureChange60min ? Math.round(pressureChange60min * 10) / 10 : null,
        history_points: baroHistory.length
      },
      fetched_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[weather-service] squall error:', err.message);
    res.status(502).json({ error: 'Squall assessment failed', detail: err.message });
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

    for (const wp of waypoints) {
      if (wp.lat == null || wp.lon == null || wp.lat < -90 || wp.lat > 90 || wp.lon < -180 || wp.lon > 180) {
        return res.status(400).json({ error: `Invalid waypoint: ${JSON.stringify(wp)}` });
      }
    }

    const samples = generateSamplePoints(waypoints, speed, departure_time);

    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
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
    const { waypoints, boat_speed_kts, model, window_start, window_end, interval_hours } = req.body;

    if (!waypoints || waypoints.length < 2) {
      return res.status(400).json({ error: 'At least 2 waypoints required' });
    }

    const speed = parseFloat(boat_speed_kts) || 7;
    const start = new Date(window_start || Date.now());
    const end = new Date(window_end || (start.getTime() + 72 * 3600000));

    const stepHrs = [3, 6, 12, 24].includes(interval_hours) ? interval_hours : 3;
    const departures = [];
    for (let t = start.getTime(); t <= end.getTime(); t += stepHrs * 3600000) {
      departures.push(new Date(t).toISOString());
    }

    let totalDist = 0;
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversine(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
    }
    const maxHours = Math.ceil(totalDist / speed) + Math.ceil((end - start) / 3600000) + 24;
    const forecastHours = Math.min(maxHours, 384);

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

    scored.sort((a, b) => b.comfort_score - a.comfort_score);

    res.json({
      total_distance_nm: Math.round(totalDist * 10) / 10,
      total_hours: Math.round((totalDist / speed) * 10) / 10,
      window: { start: start.toISOString(), end: end.toISOString() },
      departures: scored
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

    if (!hasComparisonBudget(modelList.length)) {
      return res.status(429).json({ error: 'Insufficient rate limit budget for comparison' });
    }

    const modelResults = await Promise.allSettled(
      modelList.map(async modelKey => {
        const { samples, weatherMap } = await fetchGridWeather(waypoints, speed, departure_time, modelKey);
        const result = calculateRouteWeather(waypoints, samples, weatherMap, speed);
        result.samples = result.samples.filter((_, i) => i % 2 === 0);
        return { model: modelKey, ...result };
      })
    );

    const modelsOut = {};
    for (const r of modelResults) {
      if (r.status === 'fulfilled') {
        const { model, summary, warnings, legs } = r.value;
        modelsOut[model] = { summary, warnings, legs: legs.map(l => ({ from: l.from, to: l.to, distance_nm: l.distance_nm, hours: l.hours })) };
      }
    }

    if (Object.keys(modelsOut).length === 0) {
      return res.status(502).json({ error: 'All model requests failed' });
    }

    const summaries = Object.values(modelsOut).map(m => m.summary).filter(Boolean);
    const maxWinds = summaries.map(s => s.max_wind_kts).filter(v => v != null);
    const maxWaves = summaries.map(s => s.max_wave_m).filter(v => v != null);
    const comforts = {};
    for (const [k, v] of Object.entries(modelsOut)) {
      if (v.summary?.avg_comfort != null) comforts[k] = v.summary.avg_comfort;
    }

    const maxWindSpread = maxWinds.length >= 2 ? Math.max(...maxWinds) - Math.min(...maxWinds) : 0;
    const maxWaveSpread = maxWaves.length >= 2 ? Math.max(...maxWaves) - Math.min(...maxWaves) : 0;

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

// ── GET /grid — weather grid for map overlay ──
router.get('/grid', async (req, res) => {
  try {
    const { north, south, east, west, time, model } = req.query;
    if (!north || !south || !east || !west || !time) {
      return res.status(400).json({ error: 'Required: north, south, east, west, time' });
    }

    const n = parseFloat(north), s = parseFloat(south);
    const e = parseFloat(east), w = parseFloat(west);
    const t = new Date(time);
    if (isNaN(t.getTime())) return res.status(400).json({ error: 'Invalid time' });

    const latSpan = n - s;
    const lonSpan = e - w;
    const step = Math.max(0.25, Math.round(Math.max(latSpan, lonSpan) / 14 * 4) / 4);

    const points = [];
    for (let lat = s; lat <= n; lat += step) {
      for (let lon = w; lon <= e; lon += step) {
        points.push({ lat: roundToGrid(lat), lon: roundToGrid(lon) });
      }
    }

    if (points.length > 225) {
      const bigStep = Math.max(0.25, Math.round(Math.max(latSpan, lonSpan) / 14 * 4) / 4);
      points.length = 0;
      for (let lat = s; lat <= n; lat += bigStep) {
        for (let lon = w; lon <= e; lon += bigStep) {
          points.push({ lat: roundToGrid(lat), lon: roundToGrid(lon) });
        }
      }
    }

    const seen = new Set();
    const unique = points.filter(p => {
      const key = `${p.lat}:${p.lon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const hours = 168;
    const results = await Promise.all(unique.map(async (p) => {
      try {
        const [weather, marine] = await Promise.all([
          fetchWeather(p.lat, p.lon, hours, model || 'best'),
          fetchMarine(p.lat, p.lon, hours, model || 'best')
        ]);
        const merged = mergeData(weather, marine);
        if (!merged) return null;

        const targetMs = t.getTime();
        let best = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < merged.length; i++) {
          const diff = Math.abs(new Date(merged[i].time).getTime() - targetMs);
          if (diff < bestDiff) { bestDiff = diff; best = i; }
        }

        const wx = merged[best];
        return {
          lat: p.lat,
          lon: p.lon,
          weather: {
            wind_speed: wx.wind_speed,
            wind_direction: wx.wind_direction,
            wind_gusts: wx.wind_gusts,
            wave_height: wx.wave_height,
            wave_direction: wx.wave_direction,
            wave_period: wx.wave_period,
            pressure: wx.pressure,
            swell_height: wx.swell_height,
            swell_direction: wx.swell_direction
          }
        };
      } catch {
        return null;
      }
    }));

    res.json({
      time: t.toISOString(),
      step,
      points: results.filter(Boolean)
    });
  } catch (err) {
    console.error('[weather-service] grid error:', err.message);
    res.status(500).json({ error: 'Grid fetch failed' });
  }
});

// ── GET /health — provider health + rate limits ──
router.get('/health', (req, res) => {
  res.json({
    providers: getHealthStatus(),
    rate_limits: getRateLimitStatus(),
    db_connected: dbReady,
    timestamp: new Date().toISOString()
  });
});

// ── GET /models — available forecast models ──
router.get('/models', (req, res) => {
  const health = getHealthStatus();
  res.json({
    models: [
      { id: 'best', name: 'Best Available', description: 'Open-Meteo auto-selects best model for location', marine: null },
      { id: 'gfs', name: 'GFS', description: 'NOAA Global Forecast System -- 16-day, 0.25 deg global', marine: 'GFS-Wave (ncep_gfswave025)' },
      { id: 'ecmwf', name: 'ECMWF IFS', description: 'European model -- generally most accurate, 10-day', marine: 'ECMWF WAM (ecmwf_wam025)' },
      { id: 'icon', name: 'ICON', description: 'DWD German model -- good for Atlantic/European waters', marine: null }
    ],
    providers: Object.entries(health).map(([name, h]) => ({ name, status: h.status }))
  });
});

// zero-shot forecasts of wind speed, barometric pressure, battery voltage.


router.get('/forecast/sensor', async (req, res) => {
  const metric = req.query.metric || 'all';  // wind, pressure, battery, all
  const horizon = Math.min(parseInt(req.query.horizon) || 24, 256);
  const history = Math.min(parseInt(req.query.history) || 360, 2048); // minutes of history

  const db = await ensureDb();
  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  try {
    // Query sensor data from telemetry DB
    const queries = {};

    if (metric === 'wind' || metric === 'all') {
      queries.wind_speed = `SELECT ts, (snapshot->'nmea'->>'wind_speed_kts')::float as val
        FROM boat_telemetry WHERE boat_id=$1
        AND ts > NOW() - make_interval(mins => $2)
        AND snapshot->'nmea'->'wind_speed_kts' IS NOT NULL
        ORDER BY ts ASC`;
    }
    if (metric === 'pressure' || metric === 'all') {
      queries.pressure = `SELECT ts, (snapshot->'nmea'->>'baro_mbar')::float as val
        FROM boat_telemetry WHERE boat_id=$1
        AND ts > NOW() - make_interval(mins => $2)
        AND snapshot->'nmea'->'baro_mbar' IS NOT NULL
        ORDER BY ts ASC`;
    }
    if (metric === 'battery' || metric === 'all') {
      queries.battery_voltage = `SELECT ts, (snapshot->'nmea'->>'battery_voltage')::float as val
        FROM boat_telemetry WHERE boat_id=$1
        AND ts > NOW() - make_interval(mins => $2)
        AND snapshot->'nmea'->'battery_voltage' IS NOT NULL
        ORDER BY ts ASC`;
    }

    if (Object.keys(queries).length === 0) {
      return res.status(400).json({ error: 'Invalid metric. Use: wind, pressure, battery, or all' });
    }

    // Fetch all metrics in parallel, thin to ~1 per minute
    const series = {};
    await Promise.all(Object.entries(queries).map(async ([name, sql]) => {
      const result = await db.query(sql, [BOAT_ID, history]);
      if (result.rows.length < 10) return; // need minimum data
      const thinned = [];
      let lastTs = 0;
      for (const row of result.rows) {
        const t = new Date(row.ts).getTime();
        if (t - lastTs >= 55000) {
          thinned.push(row.val);
          lastTs = t;
        }
      }
      if (thinned.length >= 10) series[name] = thinned;
    }));

    if (Object.keys(series).length === 0) {
      return res.json({ error: 'Insufficient sensor data', metrics_available: [], horizon });
    }

    // Single metric → direct call, multiple → batch
    const names = Object.keys(series);
    let forecasts;

    if (names.length === 1) {
      const name = names[0];
      forecasts = {
        [name]: {
          forecast: fc.forecast,
          q10: fc.quantile_10,
          q50: fc.quantile_50,
          q90: fc.quantile_90,
          input_length: fc.input_length,
        }
      };
    } else {
      // Add input lengths
      for (const name of names) {
        if (forecasts[name]) forecasts[name].input_length = series[name].length;
      }
    }

    res.json({
      forecasts,
      horizon,
      metrics: names,
      source: 'sensor_history',
    });
  } catch (err) {
    res.status(500).json({ error: 'Forecast failed', message: err.message });
  }
});

router.get('/forecast/sensor/health', async (_req, res) => {
  try {
    res.json(status);
  } catch (err) {
    console.error('[weather-service] Sensor health check error:', err.message);
    res.status(500).json({ error: 'Health check failed', message: err.message });
  }
});

export default router;
