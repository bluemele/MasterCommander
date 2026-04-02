// ============================================================
// BOAT INGESTION — Real telemetry data from collector devices
// ============================================================
// Receives JSON snapshots from boat hardware collectors,
// stores in PostgreSQL boat_telemetry table, serves via REST + SSE.
//
// Endpoints:
//   POST /api/telemetry/ingest           Store a snapshot
//   GET  /api/telemetry/boat/:id/latest  Latest snapshot (translated)
//   GET  /api/telemetry/boat/:id/history Last N snapshots (?limit=100)
//   GET  /api/telemetry/boat/:id/live    SSE stream of new data (translated)
// ============================================================

import pg from 'pg';
import { EventEmitter } from 'events';

const { Pool } = pg;

// In-memory cache: boat_id -> latest snapshot
const latestSnapshots = new Map();

// EventEmitter for SSE push
const ingestionEvents = new EventEmitter();
ingestionEvents.setMaxListeners(100);

// ── Snapshot Alert Evaluator (runs against translated snapshots) ──
// Per-boat alert state: alerts, cooldowns, anchor position
const boatAlertState = new Map();

function getAlertState(boatId) {
  if (!boatAlertState.has(boatId)) {
    boatAlertState.set(boatId, {
      alerts: [],         // active alerts [{id, severity, message, timestamp}]
      lastFired: {},      // id -> timestamp (cooldown tracking)
      anchorSet: null,    // {lat, lon, radius} when anchor is detected
      prevSnapshot: null, // for delta/trend detection
    });
  }
  return boatAlertState.get(boatId);
}

function evaluateAlerts(translated, boatId) {
  const state = getAlertState(boatId);
  const now = Date.now();
  const alerts = [];

  function fire(id, severity, message, cooldownMs = 60000) {
    if (now - (state.lastFired[id] || 0) < cooldownMs) return;
    state.lastFired[id] = now;
    alerts.push({ id, severity, message, timestamp: new Date().toISOString() });
  }

  const nav = translated.navigation || {};
  const env = translated.environment || {};
  const batt = translated.batteries?.house;
  const engines = translated.engines || {};
  const elec = translated.electrical || {};

  // ── Battery alerts ──
  if (batt) {
    if (batt.soc != null && batt.soc <= 20) {
      fire('batt_low_house', batt.soc <= 10 ? 'critical' : 'warning',
        `${batt.soc <= 10 ? '🚨' : '⚠️'} House battery low: ${batt.soc}% | ${batt.voltage?.toFixed(1)}V`, 300000);
    }
    if (batt.voltage != null && batt.voltage < 23.5) {
      fire('batt_voltage_low', 'critical',
        `🚨 House battery voltage critical: ${batt.voltage.toFixed(1)}V`, 300000);
    }
  }

  // ── Depth alert ──
  if (env.depth != null && env.depth < 2) {
    fire('shallow_water', 'critical',
      `🚨 SHALLOW WATER: ${env.depth.toFixed(1)}m depth`, 120000);
  } else if (env.depth != null && env.depth < 4) {
    fire('depth_warning', 'warning',
      `⚠️ Depth warning: ${env.depth.toFixed(1)}m`, 300000);
  }

  // ── Engine alerts ──
  for (const [key, eng] of Object.entries(engines)) {
    if (!eng.running) continue;
    if (eng.coolantTemp != null && eng.coolantTemp > 95) {
      fire(`engine_overheat_${key}`, 'critical',
        `🚨 Engine ${key} overheating: coolant ${eng.coolantTemp}°C`, 120000);
    }
    if (eng.oilPressure != null && eng.oilPressure < 25) {
      fire(`engine_oil_${key}`, 'critical',
        `🚨 Engine ${key} low oil pressure: ${eng.oilPressure} PSI`, 120000);
    }
  }

  // ── Wind alert (high wind) ──
  const windSpeed = env.windSpeedTrue || env.windSpeed;
  if (windSpeed != null && windSpeed > 30) {
    fire('high_wind', 'warning',
      `⚠️ High wind: ${windSpeed.toFixed(0)} kts`, 600000);
  }

  // ── Shore power disconnect ──
  if (state.prevSnapshot) {
    const prevShore = state.prevSnapshot.electrical?.shore?.connected;
    const currShore = elec.shore?.connected;
    if (prevShore === true && currShore === false) {
      fire('shore_disconnect', 'warning',
        '⚠️ Shore power disconnected', 600000);
    }
  }

  state.prevSnapshot = translated;
  state.alerts = alerts.length > 0 ? alerts : state.alerts.filter(a => now - new Date(a.timestamp).getTime() < 600000);
  return state.alerts.slice(-10);
}

// ── Basic Advisor (snapshot-based insights) ──
function evaluateAdvisor(translated) {
  const recs = [];
  const batt = translated.batteries?.house;
  const elec = translated.electrical || {};
  const env = translated.environment || {};
  const nav = translated.navigation || {};

  // Energy advice
  if (batt) {
    const soc = batt.soc;
    const current = batt.current || 0;
    const solarW = elec.solar?.power || 0;
    const discharging = current < -0.5;

    if (discharging && soc != null && soc < 40 && solarW < 50) {
      const draw = Math.abs(current);
      const hoursLeft = draw > 0 ? Math.round((1700 * 24 * (soc / 100)) / (draw * (batt.voltage || 24))) : 999;
      recs.push({
        id: 'energy_low',
        type: 'energy',
        urgency: soc < 25 ? 'critical' : 'advisory',
        title: `Battery at ${soc}% — ${hoursLeft}h remaining`,
        reasoning: `Drawing ${draw.toFixed(1)}A with minimal solar (${solarW}W). Consider starting generator or reducing loads.`,
        impact: hoursLeft < 6 ? 'Risk of battery damage if SOC drops below 15%' : null,
        createdAt: Date.now()
      });
    }

    if (solarW > 200 && soc != null && soc > 90 && current > 5) {
      recs.push({
        id: 'solar_excess',
        type: 'energy',
        urgency: 'suggestion',
        title: 'Solar surplus — good time for high loads',
        reasoning: `${solarW}W solar with battery at ${soc}%. Run watermaker, charge devices, or heat water.`,
        createdAt: Date.now()
      });
    }
  }

  // Anchor watch
  if (nav.position && nav.sog != null && nav.sog < 1) {
    const windSpeed = env.windSpeedTrue || env.windSpeed;
    if (windSpeed != null && windSpeed > 20) {
      recs.push({
        id: 'anchor_wind',
        type: 'safety',
        urgency: 'advisory',
        title: `Wind ${windSpeed.toFixed(0)} kts at anchor`,
        reasoning: 'Monitor anchor holding. Consider deploying second anchor or increasing scope.',
        createdAt: Date.now()
      });
    }
  }

  // Depth awareness
  if (env.depth != null && env.depth < 5 && nav.sog != null && nav.sog > 2) {
    recs.push({
      id: 'depth_moving',
      type: 'safety',
      urgency: 'advisory',
      title: `Shallow water (${env.depth.toFixed(1)}m) while underway`,
      reasoning: `SOG ${nav.sog.toFixed(1)} kts in ${env.depth.toFixed(1)}m. Verify chart and reduce speed.`,
      createdAt: Date.now()
    });
  }

  return recs;
}

// ── Database connection with retry ──────────────────────
let pool = null;
let dbReady = false;

function createPool() {
  const p = new Pool({
    host: process.env.MC_DB_HOST || 'mastercommander-db',
    user: process.env.MC_DB_USER || 'mastercommander',
    database: process.env.MC_DB_NAME || 'mastercommander',
    password: process.env.MC_DB_PASS,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  p.on('error', (err) => {
    console.error('[boat-ingestion] Pool error:', err.message);
    dbReady = false;
  });

  return p;
}

async function ensureDB() {
  if (dbReady && pool) return true;
  try {
    if (!pool) pool = createPool();
    const client = await pool.connect();
    client.release();
    dbReady = true;
    console.log('[boat-ingestion] PostgreSQL connected');
    return true;
  } catch (err) {
    console.error('[boat-ingestion] DB connect failed:', err.message);
    dbReady = false;
    return false;
  }
}

// Retry DB connection every 10s if not connected
const retryInterval = setInterval(async () => {
  if (!dbReady) await ensureDB();
}, 10_000);
retryInterval.unref();

// Pre-warm latest snapshots from DB on startup
async function warmCache() {
  if (!dbReady) return;
  try {
    const res = await pool.query(`
      SELECT DISTINCT ON (boat_id) boat_id, ts, snapshot
      FROM boat_telemetry
      ORDER BY boat_id, ts DESC
    `);
    for (const row of res.rows) {
      latestSnapshots.set(row.boat_id, {
        boat_id: row.boat_id,
        ts: row.ts,
        snapshot: row.snapshot,
      });
    }
    if (res.rows.length > 0) {
      console.log(`[boat-ingestion] Warmed cache for ${res.rows.length} boat(s)`);
    }
  } catch (err) {
    console.error('[boat-ingestion] Cache warm failed:', err.message);
  }
}

// ── Translate raw collector snapshot to dashboard SignalK format ──
function translateSnapshot(raw) {
  const v = raw.victron || {};
  const n = raw.nmea || {};
  const bat = v.battery || {};
  const sol = v.solar || {};
  const sys = v.system || {};
  const inv = v.inverters || [];

  // Position as string "lat, lon"
  const pos = n.position
    ? (n.position.lat != null ? n.position.lat.toFixed(4) : '0') + ', ' + (n.position.lon != null ? n.position.lon.toFixed(4) : '0')
    : null;

  // Heading true = magnetic + variation
  const headingTrue = (n.heading_magnetic != null && n.mag_variation != null)
    ? Math.round(n.heading_magnetic + n.mag_variation) : null;

  return {
    _meta: { connected: true, lastUpdate: raw.ts, source: 'real' },
    navigation: {
      position: pos,
      sog: n.sog,
      cog: n.cog,
      heading: n.heading_magnetic != null ? Math.round(n.heading_magnetic) : null,
      headingTrue: headingTrue,
      magneticVariation: n.mag_variation,
      rateOfTurn: null,
      tripLog: null,
      totalLog: null
    },
    environment: {
      depth: n.depth_m,
      waterTemp: n.water_temp_c,
      windSpeed: n.wind_speed_apparent || n.wind_speed_kts,
      windAngle: n.wind_angle_apparent,
      windSpeedTrue: n.wind_speed_kts,
      windAngleTrue: n.wind_dir_true,
      airTemp: null,
      baroPressure: n.baro_mbar,
      heel: n.heel,
      trim: n.trim
    },
    engines: {
      port: { id: 'port', rpm: n.engine_0_rpm || 0, running: (n.engine_0_rpm || 0) > 0 },
      starboard: { id: 'starboard', rpm: n.engine_1_rpm || 0, running: (n.engine_1_rpm || 0) > 0 }
    },
    batteries: {
      house: {
        id: 'house',
        voltage: bat.voltage,
        current: bat.current,
        soc: bat.soc != null ? Math.round(bat.soc) : null,
        power: bat.power
      }
    },
    tanks: {},
    electrical: {
      solar: { power: sol.total_power || 0, chargers: sol.chargers },
      shore: { connected: sys.shore_connected || false },
      inverters: inv
    },
    autopilot: {
      state: 'standby',
      rudderAngle: n.rudder
    },
    _alerts: []  // populated by evaluateAlerts() after translation
  };
}

// ── Route installer ─────────────────────────────────────
export function createIngestion(app) {
  // Initial DB connection + cache warm
  ensureDB().then((ok) => { if (ok) warmCache(); });

  // ── POST /api/telemetry/ingest ──────────────────────
  app.post('/api/telemetry/ingest', async (req, res) => {
    const { boat_id, snapshot, api_key } = req.body;

    // Validate API key
    const expectedKey = process.env.MC_BOAT_API_KEY;
    if (!expectedKey || api_key !== expectedKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Validate payload
    if (!boat_id || typeof boat_id !== 'number') {
      return res.status(400).json({ error: 'boat_id must be a number' });
    }
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ error: 'snapshot must be a JSON object' });
    }

    // Check DB
    if (!dbReady) {
      const ok = await ensureDB();
      if (!ok) {
        return res.status(503).json({ error: 'Database unavailable' });
      }
    }

    try {
      const result = await pool.query(
        `INSERT INTO boat_telemetry (boat_id, source, snapshot)
         VALUES ($1, 'collector', $2)
         RETURNING id, ts`,
        [boat_id, JSON.stringify(snapshot)]
      );

      const row = result.rows[0];
      const record = { boat_id, ts: row.ts, snapshot };

      // Update in-memory cache
      latestSnapshots.set(boat_id, record);

      // Notify SSE listeners
      ingestionEvents.emit(`boat:${boat_id}`, record);

      res.status(201).json({
        ok: true,
        id: row.id,
        ts: row.ts,
      });
    } catch (err) {
      console.error('[boat-ingestion] Insert failed:', err.message);
      if (err.code === '23503') {
        return res.status(400).json({ error: 'Unknown boat_id (foreign key)' });
      }
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ── GET /api/telemetry/boat/:id/latest ──────────────
  app.get('/api/telemetry/boat/:id/latest', async (req, res) => {
    const boatId = parseInt(req.params.id);
    if (isNaN(boatId)) return res.status(400).json({ error: 'Invalid boat ID' });

    // Try in-memory cache first
    const cached = latestSnapshots.get(boatId);
    if (cached) {
      const snap = translateSnapshot(cached.snapshot);
      snap._alerts = evaluateAlerts(snap, boatId);
      snap._advisor = evaluateAdvisor(snap);
      return res.json({ boat_id: cached.boat_id, ts: cached.ts, snapshot: snap });
    }

    // Fall back to DB
    if (!dbReady) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const result = await pool.query(
        `SELECT boat_id, ts, snapshot FROM boat_telemetry
         WHERE boat_id = $1 ORDER BY ts DESC LIMIT 1`,
        [boatId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No telemetry for this boat' });
      }
      const row = result.rows[0];
      res.json({ boat_id: row.boat_id, ts: row.ts, snapshot: translateSnapshot(row.snapshot) });
    } catch (err) {
      console.error('[boat-ingestion] Query failed:', err.message);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ── GET /api/telemetry/boat/:id/history ─────────────
  app.get('/api/telemetry/boat/:id/history', async (req, res) => {
    const boatId = parseInt(req.params.id);
    if (isNaN(boatId)) return res.status(400).json({ error: 'Invalid boat ID' });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000);

    if (!dbReady) return res.status(503).json({ error: 'Database unavailable' });

    try {
      const result = await pool.query(
        `SELECT boat_id, ts, snapshot FROM boat_telemetry
         WHERE boat_id = $1 ORDER BY ts DESC LIMIT $2`,
        [boatId, limit]
      );
      res.json({ boat_id: boatId, count: result.rows.length, rows: result.rows });
    } catch (err) {
      console.error('[boat-ingestion] History query failed:', err.message);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ── GET /api/telemetry/boat/:id/live — SSE stream ───
  app.get('/api/telemetry/boat/:id/live', (req, res) => {
    const boatId = parseInt(req.params.id);
    if (isNaN(boatId)) return res.status(400).json({ error: 'Invalid boat ID' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // SSE comment to establish connection

    // Send latest cached snapshot immediately if available (translated + alerts + advisor)
    const cached = latestSnapshots.get(boatId);
    if (cached) {
      const snap = translateSnapshot(cached.snapshot);
      snap._alerts = evaluateAlerts(snap, boatId);
      snap._advisor = evaluateAdvisor(snap);
      const translated = { boat_id: cached.boat_id, ts: cached.ts, snapshot: snap };
      res.write('data: ' + JSON.stringify(translated) + '\n\n');
    }

    const onData = (record) => {
      const snap = translateSnapshot(record.snapshot);
      snap._alerts = evaluateAlerts(snap, boatId);
      snap._advisor = evaluateAdvisor(snap);
      const translated = { boat_id: record.boat_id, ts: record.ts, snapshot: snap };
      res.write('data: ' + JSON.stringify(translated) + '\n\n');
    };

    ingestionEvents.on(`boat:${boatId}`, onData);

    req.on('close', () => {
      ingestionEvents.off(`boat:${boatId}`, onData);
    });
  });

  console.log('[boat-ingestion] Routes registered');
}
