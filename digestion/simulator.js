// ============================================================
// SIGNALK SIMULATOR — Configurable virtual boat
// ============================================================
// Generates realistic marine telemetry in SignalK format.
// Ships with preset profiles (monohull, catamaran, powerboat)
// or load a custom boat profile from JSON.
//
// Run:  node simulator.js                   # default profile
//       node simulator.js --profile cat58   # catamaran 58ft
//       node simulator.js --profile mono40  # monohull 40ft
//       node simulator.js --profile power   # powerboat
// ============================================================

import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';

const PORT = parseInt(process.env.SIM_PORT || '3858');

// ── CLI profile selection ────────────────────────────────
const args = process.argv.slice(2);
const profileArg = args.includes('--profile')
  ? args[args.indexOf('--profile') + 1]
  : 'cat58';

// ── BOAT PROFILES ────────────────────────────────────────
const PROFILES = {
  cat58: {
    name: 'Catana 581',
    type: 'Sailing Catamaran',
    position: { lat: 10.6544, lon: -61.5017 },  // Chaguaramas, Trinidad
    engines: {
      port: { hoursBase: 2847 },
      starboard: { hoursBase: 2791 },
    },
    batteries: { house: { voltage: 26.4, soc: 0.92, capacity: 1700, nominal: 24 } },
    tanks: {
      fuel: { port: 0.72, starboard: 0.68 },
      freshWater: { port: 0.85, starboard: 0.79 },
      wasteWater: { port: 0.15, starboard: 0.12 },
    },
    hasSolar: true, hasGenerator: true, hasWind: true, hasDepth: true,
    hasAutopilot: true, hasAnchor: true, hasAIS: true,
    depth: 8.2, draft: 1.2,
  },
  mono40: {
    name: 'Generic 40ft Monohull',
    type: 'Sailing Monohull',
    position: { lat: 25.7617, lon: -80.1918 },  // Miami
    engines: {
      main: { hoursBase: 1523 },
    },
    batteries: {
      house: { voltage: 12.8, soc: 0.78, capacity: 400, nominal: 12 },
      starter: { voltage: 12.9, soc: 0.95, capacity: 100, nominal: 12 },
    },
    tanks: {
      fuel: { main: 0.65 },
      freshWater: { main: 0.50 },
      wasteWater: { main: 0.30 },
    },
    hasSolar: true, hasGenerator: false, hasWind: true, hasDepth: true,
    hasAutopilot: true, hasAnchor: true, hasAIS: false,
    depth: 12, draft: 1.8,
  },
  power: {
    name: 'Sport Fisher 45',
    type: 'Powerboat',
    position: { lat: 26.1224, lon: -80.1373 },  // Fort Lauderdale
    engines: {
      port: { hoursBase: 890 },
      starboard: { hoursBase: 876 },
    },
    batteries: {
      house: { voltage: 12.6, soc: 0.85, capacity: 600, nominal: 12 },
      starter: { voltage: 12.8, soc: 0.98, capacity: 200, nominal: 12 },
    },
    tanks: {
      fuel: { main: 0.80 },
      freshWater: { main: 0.70 },
      wasteWater: { main: 0.10 },
    },
    hasSolar: false, hasGenerator: true, hasWind: false, hasDepth: true,
    hasAutopilot: true, hasAnchor: true, hasAIS: true,
    depth: 20, draft: 1.0,
  },
};

const profile = PROFILES[profileArg] || PROFILES.cat58;
console.log(`📋 Profile: ${profile.name} (${profile.type})`);

// ── MUTABLE STATE ────────────────────────────────────────
const state = {
  position: { ...profile.position },
  heading: 3.49,
  sog: 0,
  cog: 0,
  depth: profile.depth,
  windSpeedApparent: 2.1,
  windAngleApparent: 0.52,
  waterTemp: 28.5,
  engines: {},
  batteries: {},
  tanks: JSON.parse(JSON.stringify(profile.tanks)),
  solar: { power: 0 },
  generator: { running: false, hours: 412, voltage: 0 },
  shore: { connected: false, voltage: 0 },
  autopilot: { state: 'standby', target: 0 },
  anchor: { deployed: true, lat: profile.position.lat, lon: profile.position.lon, radius: 30 },
  bilgePump: { running: false },
};

// Init engines
for (const [id, cfg] of Object.entries(profile.engines)) {
  state.engines[id] = { rpm: 0, oilPressure: 0, coolantTemp: 25, exhaustTemp: 45, hours: cfg.hoursBase, fuelRate: 0 };
}
// Init batteries
for (const [id, cfg] of Object.entries(profile.batteries)) {
  state.batteries[id] = { voltage: cfg.voltage, current: -2.1, soc: cfg.soc, nominal: cfg.nominal };
}

// ── SCENARIOS ────────────────────────────────────────────
const SCENARIOS = {
  atAnchor:   'At anchor, engines off, on battery',
  motoring:   'Underway on engines',
  sailing:    'Under sail, engines off',
  charging:   'Generator running, charging batteries',
  shorepower: 'Docked, shore power connected',
  alarm:      'Bilge pump cycling — leak simulation',
};
let scenario = 'atAnchor';

function noise(base, range) { return base + (Math.random() - 0.5) * range; }

function getSolarPower() {
  if (!profile.hasSolar) return 0;
  const h = new Date().getHours();
  if (h < 6 || h > 18) return 0;
  return noise(800 * Math.sin(((h - 6) / 12) * Math.PI), 50);
}

function updateState() {
  switch (scenario) {
    case 'atAnchor':
      state.sog = noise(0.1, 0.15);
      state.position.lat += (Math.random() - 0.5) * 0.00001;
      state.position.lon += (Math.random() - 0.5) * 0.00001;
      for (const e of Object.values(state.engines)) { e.rpm = 0; e.oilPressure = 0; }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-2.5, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(profile.depth, 0.3);
      break;

    case 'motoring':
      state.sog = noise(3.6, 0.3);
      state.cog = noise(1.57, 0.05);
      state.heading = noise(state.cog, 0.03);
      state.position.lat += 0.00005 * Math.cos(state.cog);
      state.position.lon += 0.00005 * Math.sin(state.cog);
      for (const e of Object.values(state.engines)) {
        e.rpm = noise(2200, 50);
        e.oilPressure = noise(42, 3) * 6894.76;
        e.coolantTemp = noise(82, 2) + 273.15;
        e.exhaustTemp = noise(380, 15) + 273.15;
        e.fuelRate = noise(8.5, 0.5) / 3600000;
        e.hours += 0.0003;
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(45, 5);
        b.soc = Math.min(1, b.soc + 0.0001);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.depth = noise(15, 2);
      break;

    case 'sailing':
      state.sog = noise(3.3, 0.4);
      state.cog = noise(2.09, 0.08);
      state.heading = noise(state.cog, 0.05);
      state.position.lat += 0.00004 * Math.cos(state.cog);
      state.position.lon += 0.00004 * Math.sin(state.cog);
      for (const e of Object.values(state.engines)) { e.rpm = 0; e.oilPressure = 0; }
      state.windSpeedApparent = noise(8.5, 1.5);
      state.windAngleApparent = noise(0.87, 0.15);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-3.5, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(25, 5);
      break;

    case 'charging':
      state.sog = noise(0.1, 0.1);
      state.generator.running = true;
      state.generator.voltage = noise(240, 2);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(80, 10);
        b.soc = Math.min(1, b.soc + 0.0002);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      break;

    case 'shorepower':
      state.sog = 0;
      state.shore.connected = true;
      state.shore.voltage = noise(120, 2);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(30, 5);
        b.soc = Math.min(1, b.soc + 0.0001);
      }
      break;

    case 'alarm':
      state.sog = noise(0.1, 0.1);
      state.bilgePump.running = Math.random() > 0.6;
      for (const b of Object.values(state.batteries)) { b.current = noise(-4, 1); }
      break;
  }
  state.waterTemp = noise(28.5, 0.3);
  if (profile.hasWind && scenario !== 'sailing') {
    state.windSpeedApparent = noise(3.5, 2);
    state.windAngleApparent = noise(0.78, 0.3);
  }
}

// ── BUILD SIGNALK DELTA ──────────────────────────────────
function buildDelta() {
  const values = [];
  const pos = state.position;

  // Navigation
  values.push({ path: 'navigation.position', value: { latitude: pos.lat, longitude: pos.lon } });
  values.push({ path: 'navigation.speedOverGround', value: state.sog });
  values.push({ path: 'navigation.courseOverGroundTrue', value: state.cog });
  values.push({ path: 'navigation.headingMagnetic', value: state.heading });

  // Environment
  values.push({ path: 'environment.depth.belowTransducer', value: state.depth });
  values.push({ path: 'environment.water.temperature', value: state.waterTemp + 273.15 });

  if (profile.hasWind) {
    values.push({ path: 'environment.wind.speedApparent', value: state.windSpeedApparent });
    values.push({ path: 'environment.wind.angleApparent', value: state.windAngleApparent });
  }

  // Engines
  for (const [id, e] of Object.entries(state.engines)) {
    const p = `propulsion.${id}`;
    values.push({ path: `${p}.revolutions`, value: e.rpm / 60 });
    values.push({ path: `${p}.oilPressure`, value: e.rpm > 0 ? e.oilPressure : 0 });
    values.push({ path: `${p}.coolantTemperature`, value: e.coolantTemp > 100 ? e.coolantTemp : e.coolantTemp + 273.15 });
    values.push({ path: `${p}.exhaustTemperature`, value: e.exhaustTemp > 100 ? e.exhaustTemp : e.exhaustTemp + 273.15 });
    values.push({ path: `${p}.runTime`, value: e.hours * 3600 });
    values.push({ path: `${p}.fuel.rate`, value: e.fuelRate });
  }

  // Batteries
  for (const [id, b] of Object.entries(state.batteries)) {
    const p = `electrical.batteries.${id}`;
    values.push({ path: `${p}.voltage`, value: b.voltage });
    values.push({ path: `${p}.current`, value: b.current });
    values.push({ path: `${p}.capacity.stateOfCharge`, value: b.soc });
  }

  // Solar
  if (profile.hasSolar) {
    values.push({ path: 'electrical.solar.power', value: state.solar.power });
  }

  // Generator
  if (profile.hasGenerator) {
    values.push({ path: 'electrical.ac.generator.voltage', value: state.generator.running ? state.generator.voltage : 0 });
    values.push({ path: 'electrical.ac.generator.runTime', value: state.generator.hours * 3600 });
  }

  // Shore
  values.push({ path: 'electrical.ac.shore.voltage', value: state.shore.connected ? state.shore.voltage : 0 });

  // Tanks
  for (const [type, tanks] of Object.entries(state.tanks)) {
    for (const [id, level] of Object.entries(tanks)) {
      values.push({ path: `tanks.${type}.${id}.currentLevel`, value: level });
    }
  }

  // Safety
  values.push({ path: 'notifications.bilgePump.running', value: state.bilgePump.running });

  if (profile.hasAutopilot) {
    values.push({ path: 'steering.autopilot.state', value: state.autopilot.state });
  }

  if (profile.hasAnchor && state.anchor.deployed) {
    values.push({ path: 'navigation.anchor.position', value: { latitude: state.anchor.lat, longitude: state.anchor.lon } });
    values.push({ path: 'navigation.anchor.maxRadius', value: state.anchor.radius });
  }

  return {
    context: 'vessels.self',
    updates: [{ source: { label: 'commander-sim' }, timestamp: new Date().toISOString(), values }],
  };
}

// ── HTTP + WS SERVER ─────────────────────────────────────
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/signalk/v1/stream' });

app.use(express.json());

app.get('/signalk', (req, res) => res.json({
  endpoints: { v1: { version: '2.0.0', 'signalk-http': `http://localhost:${PORT}/signalk/v1/api`, 'signalk-ws': `ws://localhost:${PORT}/signalk/v1/stream` } },
  server: { id: 'commander-sim', version: '0.2.0' },
}));

app.get('/signalk/v1/api/vessels/self', (req, res) => {
  const delta = buildDelta();
  const result = {};
  for (const v of delta.updates[0].values) {
    const parts = v.path.split('.');
    let obj = result;
    for (let i = 0; i < parts.length - 1; i++) { if (!obj[parts[i]]) obj[parts[i]] = {}; obj = obj[parts[i]]; }
    obj[parts[parts.length - 1]] = { value: v.value, timestamp: delta.updates[0].timestamp };
  }
  res.json(result);
});

app.get('/scenario', (req, res) => res.json({ current: scenario, available: SCENARIOS }));
app.post('/scenario/:name', (req, res) => {
  if (!SCENARIOS[req.params.name]) return res.status(400).json({ error: 'Unknown', available: Object.keys(SCENARIOS) });
  // Reset transient state on scenario change
  state.generator.running = false;
  state.shore.connected = false;
  state.bilgePump.running = false;
  for (const e of Object.values(state.engines)) { e.coolantTemp = 25; e.exhaustTemp = 45; }
  scenario = req.params.name;
  console.log(`🔄 Scenario: ${scenario} — ${SCENARIOS[scenario]}`);
  res.json({ scenario, description: SCENARIOS[scenario] });
});

app.get('/', (req, res) => {
  res.send(`<html><head><title>Commander Simulator</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:monospace;padding:20px}
h1{color:#0ea5e9}a{color:#10b981}.s{padding:8px 16px;margin:4px;display:inline-block;
background:#1e293b;border:1px solid #334155;border-radius:6px;cursor:pointer;color:#e2e8f0;text-decoration:none}
.a{border-color:#10b981;color:#10b981}</style></head>
<body><h1>⚓ Commander Simulator — ${profile.name}</h1>
<p>Scenario: <strong>${scenario}</strong> — ${SCENARIOS[scenario]}</p>
${Object.entries(SCENARIOS).map(([k,v]) => `<a class="s ${k===scenario?'a':''}" href="#" onclick="fetch('/scenario/${k}',{method:'POST'}).then(()=>location.reload())">${k}</a>`).join('')}
<hr><p>WS: ws://localhost:${PORT}/signalk/v1/stream</p>
<p>REST: <a href="/signalk/v1/api/vessels/self">/signalk/v1/api/vessels/self</a></p>
</body></html>`);
});

wss.on('connection', (ws) => {
  console.log(`🔌 Client connected (${wss.clients.size})`);
  ws.send(JSON.stringify({ name: 'commander-sim', self: 'vessels.self', timestamp: new Date().toISOString() }));
  ws.on('close', () => console.log(`🔌 Client disconnected (${wss.clients.size})`));
});

setInterval(() => {
  updateState();
  const delta = JSON.stringify(buildDelta());
  for (const c of wss.clients) { if (c.readyState === 1) c.send(delta); }
}, 2000);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ⚓ Simulator: ${profile.name.padEnd(42)}║
║  WS:   ws://localhost:${String(PORT).padEnd(40)}║/signalk/v1/stream
║  REST: http://localhost:${String(PORT).padEnd(39)}║/signalk/v1/api
║  Web:  http://localhost:${String(PORT).padEnd(39)}║
╚══════════════════════════════════════════════════════════╝`);
});
