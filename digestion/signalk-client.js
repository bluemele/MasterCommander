// ============================================================
// SIGNALK CLIENT — Auto-discovering boat data connector
// ============================================================
// Connects to ANY SignalK server, discovers what sensors exist,
// and maintains a live state tree. Commander doesn't assume
// what equipment a boat has — it asks SignalK and adapts.
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// ── UNIT CONVERSIONS (SignalK uses SI: Kelvin, m/s, rad, Pa) ──
export const convert = {
  kelvinToC:     (k) => k != null ? Math.round((k - 273.15) * 10) / 10 : null,
  msToKnots:     (ms) => ms != null ? Math.round(ms * 1.94384 * 10) / 10 : null,
  radToDeg:      (r) => r != null ? Math.round(r * 180 / Math.PI) : null,
  paToPsi:       (pa) => pa != null ? Math.round(pa / 6894.76) : null,
  hzToRpm:       (hz) => hz != null ? Math.round(hz * 60) : null,
  m3sToLph:      (v) => v != null ? Math.round(v * 3600000 * 10) / 10 : null,
  secToHours:    (s) => s != null ? Math.round(s / 3600) : null,
  fracToPercent: (f) => f != null ? Math.round(f * 100) : null,
  round1:        (v) => v != null ? Math.round(v * 10) / 10 : null,
};

// ── Path → conversion lookup (leaf key matching) ──
const CONVERTERS = {
  'navigation.position':              { unit: '', fn: v => v },
  'navigation.speedOverGround':       { unit: 'kts', fn: convert.msToKnots },
  'navigation.courseOverGroundTrue':   { unit: '°', fn: convert.radToDeg },
  'navigation.headingMagnetic':       { unit: '°', fn: convert.radToDeg },
  'navigation.headingTrue':           { unit: '°', fn: convert.radToDeg },
  'environment.depth.belowTransducer':{ unit: 'm', fn: convert.round1 },
  'environment.depth.belowKeel':      { unit: 'm', fn: convert.round1 },
  'environment.wind.speedApparent':   { unit: 'kts', fn: convert.msToKnots },
  'environment.wind.angleApparent':   { unit: '°', fn: convert.radToDeg },
  'environment.wind.speedTrue':       { unit: 'kts', fn: convert.msToKnots },
  'environment.water.temperature':    { unit: '°C', fn: convert.kelvinToC },
  'environment.outside.temperature':  { unit: '°C', fn: convert.kelvinToC },
  'environment.outside.pressure':     { unit: 'hPa', fn: v => v != null ? Math.round(v / 100) : null },
  // Leaf-key fallbacks for engines, batteries, tanks
  'revolutions':        { unit: 'rpm', fn: convert.hzToRpm },
  'oilPressure':        { unit: 'PSI', fn: convert.paToPsi },
  'coolantTemperature':  { unit: '°C', fn: convert.kelvinToC },
  'exhaustTemperature':  { unit: '°C', fn: convert.kelvinToC },
  'runTime':            { unit: 'hrs', fn: convert.secToHours },
  'fuel.rate':          { unit: 'L/hr', fn: convert.m3sToLph },
  'voltage':            { unit: 'V', fn: convert.round1 },
  'current':            { unit: 'A', fn: convert.round1 },
  'power':              { unit: 'W', fn: v => v != null ? Math.round(v) : null },
  'capacity.stateOfCharge': { unit: '%', fn: convert.fracToPercent },
  'currentLevel':       { unit: '%', fn: convert.fracToPercent },
};

function findConverter(path) {
  if (CONVERTERS[path]) return CONVERTERS[path];
  const leaf = path.split('.').slice(-1)[0];
  const leaf2 = path.split('.').slice(-2).join('.');
  return CONVERTERS[leaf2] || CONVERTERS[leaf] || null;
}

// ============================================================
export class SignalKClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.host = config.host || 'localhost';
    this.port = config.port || 3000;
    this.useTLS = config.useTLS || false;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;

    this.raw = {};          // raw SignalK values
    this.state = {};        // converted human-readable values
    this.paths = new Set(); // all discovered paths
    this.lastUpdate = null;

    // Auto-discovered equipment
    this.discovered = {
      engines: [],
      batteries: [],
      tanks: { fuel: [], freshWater: [], wasteWater: [] },
      hasWind: false,
      hasDepth: false,
      hasAutopilot: false,
      hasAnchor: false,
      hasSolar: false,
      hasGenerator: false,
      hasShore: false,
    };
  }

  // ── Connection ──────────────────────────────────────────
  connect() {
    const proto = this.useTLS ? 'wss' : 'ws';
    const url = `${proto}://${this.host}:${this.port}/signalk/v1/stream?subscribe=all`;
    console.log(`🔌 Connecting to SignalK: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('✅ SignalK connected');
      this.connected = true;
      this.emit('connected');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.updates) this._processDelta(msg);
      } catch {}
    });

    this.ws.on('close', () => {
      console.log('❌ SignalK disconnected — reconnecting in 5s');
      this.connected = false;
      this.emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED') console.error('SignalK error:', err.message);
      this.connected = false;
    });
  }

  // ── Delta processing + auto-discovery ───────────────────
  _processDelta(delta) {
    if (!delta?.updates?.[0]?.values) return;
    this.lastUpdate = new Date().toISOString();

    for (const v of delta.updates[0].values) {
      if (v.value == null) continue;
      this.raw[v.path] = v.value;

      const isNew = !this.paths.has(v.path);
      this.paths.add(v.path);

      // Convert
      const conv = findConverter(v.path);
      this.state[v.path] = conv ? conv.fn(v.value) : v.value;

      // Discover on first sight
      if (isNew) this._discover(v.path);
    }
    this.emit('update', this.state);
  }

  _discover(path) {
    // Engines
    if (path.startsWith('propulsion.') && !path.includes('generator')) {
      const id = path.split('.')[1];
      if (!this.discovered.engines.includes(id)) {
        this.discovered.engines.push(id);
        console.log(`  🔍 Engine: ${id}`);
        this.emit('discovered', { type: 'engine', id });
      }
    }
    // Batteries
    if (path.startsWith('electrical.batteries.')) {
      const id = path.split('.')[2];
      if (!this.discovered.batteries.includes(id)) {
        this.discovered.batteries.push(id);
        console.log(`  🔍 Battery: ${id}`);
        this.emit('discovered', { type: 'battery', id });
      }
    }
    // Tanks
    if (path.startsWith('tanks.')) {
      const [, type, id] = path.split('.');
      const map = { fuel: 'fuel', freshWater: 'freshWater', wasteWater: 'wasteWater', blackWater: 'wasteWater' };
      const key = map[type];
      if (key && this.discovered.tanks[key] && !this.discovered.tanks[key].includes(id)) {
        this.discovered.tanks[key].push(id);
        console.log(`  🔍 Tank: ${type}.${id}`);
      }
    }
    // Features
    if (path.includes('wind')) this.discovered.hasWind = true;
    if (path.includes('depth')) this.discovered.hasDepth = true;
    if (path.includes('autopilot')) this.discovered.hasAutopilot = true;
    if (path.includes('anchor')) this.discovered.hasAnchor = true;
    if (path.includes('solar')) this.discovered.hasSolar = true;
    if (path.includes('generator')) this.discovered.hasGenerator = true;
    if (path.includes('shore')) this.discovered.hasShore = true;
  }

  // ── Query helpers ───────────────────────────────────────
  get(path) { return this.state[path] ?? null; }

  getPosition() {
    const pos = this.raw['navigation.position'];
    return pos ? { lat: pos.latitude, lon: pos.longitude } : null;
  }

  getEngine(id) {
    const p = `propulsion.${id}`;
    return {
      id,
      rpm: this.get(`${p}.revolutions`),
      oilPressure: this.get(`${p}.oilPressure`),
      coolantTemp: this.get(`${p}.coolantTemperature`),
      exhaustTemp: this.get(`${p}.exhaustTemperature`),
      hours: this.get(`${p}.runTime`),
      fuelRate: this.get(`${p}.fuel.rate`),
      running: (this.get(`${p}.revolutions`) || 0) > 50,
    };
  }

  getBattery(id) {
    const p = `electrical.batteries.${id}`;
    return {
      id,
      voltage: this.get(`${p}.voltage`),
      current: this.get(`${p}.current`),
      soc: this.get(`${p}.capacity.stateOfCharge`),
    };
  }

  getTank(type, id) {
    return { type, id, level: this.get(`tanks.${type}.${id}.currentLevel`) };
  }

  // ── Full snapshot (used as LLM context) ─────────────────
  getSnapshot() {
    const s = { _meta: { connected: this.connected, lastUpdate: this.lastUpdate, pathCount: this.paths.size } };
    const pos = this.getPosition();
    s.navigation = {
      position: pos ? `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}` : null,
      sog: this.get('navigation.speedOverGround'),
      cog: this.get('navigation.courseOverGroundTrue'),
      heading: this.get('navigation.headingMagnetic') ?? this.get('navigation.headingTrue'),
    };
    s.environment = {
      depth: this.get('environment.depth.belowTransducer') ?? this.get('environment.depth.belowKeel'),
      waterTemp: this.get('environment.water.temperature'),
    };
    if (this.discovered.hasWind) {
      s.environment.windSpeed = this.get('environment.wind.speedApparent');
      s.environment.windAngle = this.get('environment.wind.angleApparent');
    }
    s.engines = {};
    for (const id of this.discovered.engines) s.engines[id] = this.getEngine(id);
    s.batteries = {};
    for (const id of this.discovered.batteries) s.batteries[id] = this.getBattery(id);
    s.tanks = {};
    for (const [type, ids] of Object.entries(this.discovered.tanks)) {
      for (const id of ids) s.tanks[`${type}_${id}`] = this.getTank(type, id);
    }
    return s;
  }
}

// ── Haversine distance (meters) ───────────────────────────
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
