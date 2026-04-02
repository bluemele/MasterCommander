// ============================================================
// SIGNALK CLIENT — Auto-discovering boat data connector
// ============================================================
// Connects to ANY SignalK server, discovers what sensors exist,
// and maintains a live state tree. Commander doesn't assume
// what equipment a boat has — it asks SignalK and adapts.
// ============================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

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
  'environment.wind.angleTrueWater':  { unit: '°', fn: convert.radToDeg },
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
  // Extended paths for B&G Zeus / intelligence layer
  'navigation.magneticVariation':     { unit: '°', fn: convert.radToDeg },
  'navigation.rateOfTurn':            { unit: '°/min', fn: v => v != null ? Math.round(v * 180 / Math.PI * 60 * 10) / 10 : null },
  'navigation.trip.log':              { unit: 'nm', fn: v => v != null ? Math.round(v / 1852 * 10) / 10 : null },
  'navigation.log':                   { unit: 'nm', fn: v => v != null ? Math.round(v / 1852 * 10) / 10 : null },
  'steering.rudderAngle':             { unit: '°', fn: convert.radToDeg },
  'steering.autopilot.state':         { unit: '', fn: v => v },
  'steering.autopilot.target.headingMagnetic':   { unit: '°', fn: convert.radToDeg },
  'steering.autopilot.target.windAngleApparent': { unit: '°', fn: convert.radToDeg },
  'environment.depth.transducerForward': { unit: 'm', fn: convert.round1 },
  'transmission.gear':                { unit: '', fn: v => v },
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
    this._reconnectAttempts = 0;
    this._maxReconnectDelay = 60000; // cap backoff at 60s
    this._staleDataMs = 30000;      // consider data stale after 30s of silence
    this._staleCheckTimer = null;
    this._maxPendingPuts = 50;       // prevent unbounded pending PUT accumulation

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
      hasBarometer: false,
      hasForwardScan: false,
      hasRudder: false,
    };

    // AIS targets (keyed by MMSI)
    this.ais = {};

    // Pending PUT requests
    this._pendingPuts = new Map();
  }

  // ── Connection ──────────────────────────────────────────
  connect() {
    const proto = this.useTLS ? 'wss' : 'ws';
    const url = `${proto}://${this.host}:${this.port}/signalk/v1/stream?subscribe=all`;
    console.log(`🔌 Connecting to SignalK: ${url}`);

    // Clean up any existing WebSocket before reconnecting
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.close(); } catch {}
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error('[signalk-client] WebSocket creation failed:', err.message);
      this.connected = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('✅ SignalK connected');
      this.connected = true;
      this._reconnectAttempts = 0; // reset backoff on success
      this.emit('connected');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      // Start stale data detection
      this._startStaleCheck();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // PUT response
        if (msg.requestId && msg.state) {
          const pending = this._pendingPuts.get(msg.requestId);
          if (pending) {
            if (msg.state === 'COMPLETED') { pending.resolve(msg); this._pendingPuts.delete(msg.requestId); }
            else if (msg.state === 'FAILED') { pending.reject(new Error(msg.message || 'PUT failed')); this._pendingPuts.delete(msg.requestId); }
            // PENDING is just an ack, keep waiting
          }
          return;
        }
        // AIS: separate vessel context
        if (msg.context && msg.context !== 'vessels.self' && msg.updates) {
          this._processAIS(msg);
          return;
        }
        // Self delta
        if (msg.updates) this._processDelta(msg);
      } catch (err) {
        // JSON parse errors or malformed delta — log sparingly to avoid flooding
        if (err instanceof SyntaxError) return; // malformed JSON from SignalK, skip silently
        console.error('[signalk-client] Message processing error:', err.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : '';
      console.log(`❌ SignalK disconnected (code=${code}${reasonStr ? `, ${reasonStr}` : ''}) — scheduling reconnect`);
      this.connected = false;
      this._stopStaleCheck();
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED') console.error('[signalk-client] WebSocket error:', err.message);
      this.connected = false;
      // 'close' event will fire after 'error', triggering reconnect
    });
  }

  // ── Reconnect with exponential backoff ───────────────────
  _scheduleReconnect() {
    if (this.reconnectTimer) return; // already scheduled
    this._reconnectAttempts++;
    const baseDelay = 2000;
    const delay = Math.min(baseDelay * Math.pow(2, this._reconnectAttempts - 1), this._maxReconnectDelay);
    // Add jitter to prevent thundering herd
    const jitter = Math.floor(Math.random() * 1000);
    console.log(`[signalk-client] Reconnecting in ${Math.round((delay + jitter) / 1000)}s (attempt ${this._reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay + jitter);
  }

  // ── Stale data detection ───────────────────────────────
  _startStaleCheck() {
    this._stopStaleCheck();
    this._staleCheckTimer = setInterval(() => {
      if (!this.connected || !this.lastUpdate) return;
      const age = Date.now() - new Date(this.lastUpdate).getTime();
      if (age > this._staleDataMs) {
        this.emit('staleData', { lastUpdate: this.lastUpdate, ageMs: age });
      }
    }, 10000);
    this._staleCheckTimer.unref?.();
  }

  _stopStaleCheck() {
    if (this._staleCheckTimer) {
      clearInterval(this._staleCheckTimer);
      this._staleCheckTimer = null;
    }
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
    if (path === 'environment.outside.pressure') this.discovered.hasBarometer = true;
    if (path === 'environment.depth.transducerForward') this.discovered.hasForwardScan = true;
    if (path === 'steering.rudderAngle') this.discovered.hasRudder = true;
  }

  // ── AIS target processing ─────────────────────────────
  _processAIS(delta) {
    if (!delta?.updates?.[0]?.values) return;
    // Extract MMSI from context (e.g. "vessels.urn:mrn:imo:mmsi:211234567")
    const ctx = delta.context;
    const mmsiMatch = ctx.match(/mmsi:(\d+)/);
    const mmsi = mmsiMatch ? mmsiMatch[1] : ctx;

    if (!this.ais[mmsi]) this.ais[mmsi] = { mmsi };
    const target = this.ais[mmsi];
    target.lastUpdate = new Date().toISOString();

    for (const v of delta.updates[0].values) {
      switch (v.path) {
        case 'navigation.position':
          target.lat = v.value.latitude;
          target.lon = v.value.longitude;
          break;
        case 'navigation.speedOverGround':
          target.sog = convert.msToKnots(v.value);
          break;
        case 'navigation.courseOverGroundTrue':
          target.cog = convert.radToDeg(v.value);
          break;
        case 'name': target.name = v.value; break;
        case 'mmsi': target.mmsi = v.value; break;
        case 'communication.callsignVhf': target.callsign = v.value; break;
      }
    }

    // Calculate distance and bearing from own position
    const pos = this.getPosition();
    if (pos && target.lat != null && target.lon != null) {
      target.distance = Math.round(haversineM(pos.lat, pos.lon, target.lat, target.lon) / 1852 * 10) / 10; // nm
      target.bearing = Math.round(bearingDeg(pos.lat, pos.lon, target.lat, target.lon));
    }

    this.emit('ais', { mmsi, target });
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

  // ── Send PUT command to SignalK (autopilot control, etc) ─
  sendPut(path, value, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        return reject(new Error('Not connected to SignalK'));
      }
      // Prevent unbounded accumulation of pending PUTs
      if (this._pendingPuts.size >= this._maxPendingPuts) {
        return reject(new Error(`Too many pending PUT requests (${this._pendingPuts.size})`));
      }
      const requestId = randomUUID();
      const msg = JSON.stringify({ requestId, put: { path, value } });

      const timer = setTimeout(() => {
        this._pendingPuts.delete(requestId);
        reject(new Error(`PUT timeout after ${timeout}ms for ${path}`));
      }, timeout);

      this._pendingPuts.set(requestId, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.ws.send(msg, (err) => {
        if (err) {
          clearTimeout(timer);
          this._pendingPuts.delete(requestId);
          reject(new Error(`SignalK PUT send failed: ${err.message}`));
        }
      });
    });
  }

  // ── AIS targets as array ──────────────────────────────
  getAISTargets() {
    return Object.values(this.ais).filter(t => t.lat != null);
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
      s.environment.windSpeedTrue = this.get('environment.wind.speedTrue');
      s.environment.windAngleTrue = this.get('environment.wind.angleTrueWater');
    }
    s.engines = {};
    for (const id of this.discovered.engines) s.engines[id] = this.getEngine(id);
    s.batteries = {};
    for (const id of this.discovered.batteries) s.batteries[id] = this.getBattery(id);
    s.tanks = {};
    for (const [type, ids] of Object.entries(this.discovered.tanks)) {
      for (const id of ids) s.tanks[`${type}_${id}`] = this.getTank(type, id);
    }
    // Electrical system (shore, solar, generator)
    s.electrical = {};
    if (this.discovered.hasSolar) {
      s.electrical.solar = { power: this.get('electrical.solar.power') || 0 };
    }
    if (this.discovered.hasGenerator) {
      const gv = this.get('electrical.ac.generator.voltage') || 0;
      s.electrical.generator = { running: gv > 50, voltage: gv, hours: Math.round((this.get('electrical.ac.generator.runTime') || 0) / 3600) };
    }
    if (this.discovered.hasShore) {
      const sv = this.get('electrical.ac.shore.voltage') || 0;
      s.electrical.shore = { connected: sv > 50, voltage: sv };
    }

    // Autopilot
    if (this.discovered.hasAutopilot) {
      s.autopilot = {
        state: this.get('steering.autopilot.state') || 'unknown',
        targetHeading: this.get('steering.autopilot.target.headingMagnetic'),
        targetWindAngle: this.get('steering.autopilot.target.windAngleApparent'),
        rudderAngle: this.get('steering.rudderAngle'),
      };
    }

    // Extended navigation
    s.navigation.headingTrue = this.get('navigation.headingTrue');
    s.navigation.magneticVariation = this.get('navigation.magneticVariation');
    s.navigation.rateOfTurn = this.get('navigation.rateOfTurn');
    s.navigation.tripLog = this.get('navigation.trip.log');
    s.navigation.totalLog = this.get('navigation.log');

    // Barometer
    if (this.discovered.hasBarometer) {
      s.environment.airTemp = this.get('environment.outside.temperature');
      s.environment.baroPressure = this.get('environment.outside.pressure');
    }

    // Forward scan
    if (this.discovered.hasForwardScan) {
      s.environment.forwardDepth = this.get('environment.depth.transducerForward');
    }

    // AIS targets
    const aisTargets = this.getAISTargets();
    if (aisTargets.length > 0) {
      s.ais = aisTargets.map(t => ({
        mmsi: t.mmsi,
        name: t.name,
        distance: t.distance,
        bearing: t.bearing,
        sog: t.sog,
        cog: t.cog,
      }));
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

// ── Bearing (degrees) from point 1 to point 2 ────────────
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
