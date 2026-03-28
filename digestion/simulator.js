// ============================================================
// SIGNALK SIMULATOR — Configurable virtual boat
// ============================================================
// Generates realistic marine telemetry in SignalK format.
// Ships with preset profiles (monohull, catamaran, powerboat)
// plus Gil's exact Catana 581 with B&G Zeus 3 equipment.
//
// Run:  node simulator.js                      # default profile
//       node simulator.js --profile gilsboat   # Gil's Catana 581
//       node simulator.js --profile cat58      # generic catamaran
//       node simulator.js --profile mono40     # monohull 40ft
//       node simulator.js --profile power      # powerboat
// ============================================================

import { WebSocketServer } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.SIM_PORT || '3858');

// ── CLI profile selection ────────────────────────────────
const args = process.argv.slice(2);
const profileArg = args.includes('--profile')
  ? args[args.indexOf('--profile') + 1]
  : 'gilsboat';

// ── BOAT PROFILES ────────────────────────────────────────
const PROFILES = {

  // Gil's actual boat — B&G Zeus 3, Victron, Onan 11k
  gilsboat: {
    name: "Gil's Catana 581",
    type: 'Sailing Catamaran',
    position: { lat: 10.6544, lon: -61.5017 },  // Chaguaramas, Trinidad
    engines: {
      port: { hoursBase: 2847 },
      starboard: { hoursBase: 2791 },
    },
    batteries: {
      house: { voltage: 26.4, soc: 0.72, capacity: 1700, nominal: 24 },
      starterPort: { voltage: 12.8, soc: 0.97, capacity: 100, nominal: 12 },
      starterStbd: { voltage: 12.9, soc: 0.98, capacity: 100, nominal: 12 },
    },
    tanks: {
      fuel: { port: 0.72, starboard: 0.68 },
      freshWater: { port: 0.85, starboard: 0.79 },
      wasteWater: { port: 0.15, starboard: 0.12 },
    },
    hasSolar: true, hasGenerator: true, hasWind: true, hasDepth: true,
    hasAutopilot: true, hasAnchor: true, hasAIS: true,
    hasBarometer: true, hasForwardScan: true,
    solarPeakWatts: 800,
    depth: 8.2, draft: 1.2,
    magneticVariation: -14,  // degrees, Caribbean
  },

  cat58: {
    name: 'Catana 581',
    type: 'Sailing Catamaran',
    position: { lat: 10.6544, lon: -61.5017 },
    engines: {
      port: { hoursBase: 2847 },
      starboard: { hoursBase: 2791 },
    },
    batteries: {
      house: { voltage: 26.4, soc: 0.92, capacity: 1700, nominal: 24 },
      starterPort: { voltage: 12.8, soc: 0.97, capacity: 100, nominal: 12 },
      starterStbd: { voltage: 12.9, soc: 0.98, capacity: 100, nominal: 12 },
    },
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
    position: { lat: 25.7617, lon: -80.1918 },
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
    position: { lat: 26.1224, lon: -80.1373 },
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

const profile = PROFILES[profileArg] || PROFILES.gilsboat;
console.log(`\u{1F4CB} Profile: ${profile.name} (${profile.type})`);

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── AIS VESSEL LIBRARY ─────────────────────────────────
// Realistic Caribbean vessel traffic. Scenarios pick subsets.
const AIS_LIBRARY = {
  caribbeanStar: {
    mmsi: '211234567', name: 'CARIBBEAN STAR', callsign: 'V2CS',
    type: 'cargo',
  },
  islandBreeze: {
    mmsi: '338765432', name: 'ISLAND BREEZE', callsign: 'WDH9876',
    type: 'sailing',
  },
  sarahJane: {
    mmsi: '319876543', name: 'SARAH JANE', callsign: 'ZBM4521',
    type: 'motor_yacht',
  },
  pelican: {
    mmsi: '375654321', name: 'PELICAN', callsign: 'J8FP',
    type: 'fishing',
  },
  fortGeorge: {
    mmsi: '341123456', name: 'FORT GEORGE', callsign: 'J8FG',
    type: 'ferry',
  },
  windDancer: {
    mmsi: '244987654', name: 'WIND DANCER', callsign: 'PD7654',
    type: 'sailing',
  },
  mariePierre: {
    mmsi: '227345678', name: 'MARIE PIERRE', callsign: 'FW1234',
    type: 'sailing',
  },
  seaHawk: {
    mmsi: '316789012', name: 'SEA HAWK', callsign: 'VR5678',
    type: 'motor_yacht',
  },
};

// ── MUTABLE STATE ────────────────────────────────────────
const state = {
  position: { ...profile.position },
  heading: 3.49,          // magnetic heading (radians)
  headingTrue: 3.49,      // true heading (radians)
  sog: 0,                 // m/s
  cog: 0,                 // radians
  depth: profile.depth,
  windSpeedApparent: 2.1, // m/s
  windAngleApparent: 0.52,// radians
  windSpeedTrue: 2.5,     // m/s
  windAngleTrue: 0.60,    // radians
  waterTemp: 28.5,        // Celsius (emitted as Kelvin)
  engines: {},
  batteries: {},
  tanks: JSON.parse(JSON.stringify(profile.tanks)),
  solar: { power: 0 },
  generator: { running: false, hours: 412, voltage: 0 },
  shore: { connected: false, voltage: 0 },
  autopilot: { state: 'standby', targetHeading: 0, targetWindAngle: 0 },
  anchor: { deployed: true, lat: profile.position.lat, lon: profile.position.lon, radius: 30 },
  bilgePump: { running: false },

  // New: B&G Zeus 3 + extended instrumentation
  magneticVariation: (profile.magneticVariation || -14) * DEG_TO_RAD,
  rateOfTurn: 0,         // rad/s
  rudderAngle: 0,        // radians
  baroPressure: 101300,  // Pascals (1013.0 hPa)
  airTemp: 30,           // Celsius (emitted as Kelvin)
  tripLog: 0,            // meters
  totalLog: 225000,      // meters (~122nm logged)
  forwardDepth: 12,      // forward-scan depth (meters)
  transmissionGear: {},  // per engine: 'forward', 'neutral', 'reverse'

  // AIS targets (active for current scenario)
  ais: [],
};

// Init engines + transmission
for (const [id, cfg] of Object.entries(profile.engines)) {
  state.engines[id] = { rpm: 0, oilPressure: 0, coolantTemp: 25, exhaustTemp: 45, hours: cfg.hoursBase, fuelRate: 0 };
  state.transmissionGear[id] = 'neutral';
}
// Init batteries
for (const [id, cfg] of Object.entries(profile.batteries)) {
  state.batteries[id] = { voltage: cfg.voltage, current: -2.1, soc: cfg.soc, nominal: cfg.nominal };
}

// ── SCENARIOS ────────────────────────────────────────────
const SCENARIOS = {
  atAnchor:         'At anchor, engines off, on battery',
  motoring:         'Underway on engines',
  sailing:          'Under sail, engines off',
  charging:         'Generator running, charging batteries',
  shorepower:       'Docked, shore power connected',
  alarm:            'Bilge pump cycling \u2014 leak simulation',
  // Intelligence-triggering scenarios
  windShift:        'Sailing with wind rotating 30\u00B0 \u2014 triggers tactical advisor',
  weatherBuilding:  'Wind building 12\u219222kts, baro dropping \u2014 reef advisory',
  nightPassage:     'Overnight passage, AP steering, battery draining',
  approachingPort:  'Entering harbor, depth decreasing, AIS traffic',
  crossingCurrent:  'Underway with 15\u00B0 current set \u2014 drift compensation',
  heavyWeather:     '25kt+ winds, high seas, engines loaded',
  manOverboard:     'MOB alarm \u2014 Williamson turn',
};
let scenario = 'atAnchor';
let scenarioTick = 0; // increments each 2s update, resets on scenario change

function noise(base, range) { return base + (Math.random() - 0.5) * range; }
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

function getSolarPower() {
  if (!profile.hasSolar) return 0;
  const peak = profile.solarPeakWatts || 800;
  const h = new Date().getHours();
  if (h < 6 || h > 18) return 0;
  return noise(peak * Math.sin(((h - 6) / 12) * Math.PI), 50);
}

// ── Helper: slew value toward target ────────────────────
function slew(current, target, rate) {
  const diff = target - current;
  if (Math.abs(diff) < rate) return target;
  return current + Math.sign(diff) * rate;
}

// ── Helper: slew angle (handles wraparound) ─────────────
function slewAngle(current, target, rate) {
  let diff = target - current;
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) < rate) return target;
  return current + Math.sign(diff) * rate;
}

// ── AIS: spawn vessels for scenario ─────────────────────
function spawnAIS(vessels) {
  // vessels: array of { key, lat, lon, sogKts, cogDeg }
  state.ais = vessels.map(v => {
    const lib = AIS_LIBRARY[v.key];
    return {
      ...lib,
      lat: v.lat, lon: v.lon,
      sog: v.sogKts / 1.94384,  // kts to m/s
      cog: v.cogDeg * DEG_TO_RAD,
    };
  });
}

// ── AIS: move vessels each tick ─────────────────────────
function updateAIS() {
  for (const v of state.ais) {
    // Move based on SOG/COG (2 second tick)
    const dist = v.sog * 2; // meters moved in 2 seconds
    v.lat += (dist * Math.cos(v.cog)) / 111320;
    v.lon += (dist * Math.sin(v.cog)) / (111320 * Math.cos(v.lat * DEG_TO_RAD));
    // Add slight noise
    v.sog = Math.max(0, v.sog + (Math.random() - 0.5) * 0.05);
    v.cog += (Math.random() - 0.5) * 0.005;
  }
}

// ── Common: update heading from autopilot ───────────────
function updateAutopilotSteering() {
  if (state.autopilot.state === 'auto' && state.autopilot.targetHeading) {
    // Gradually slew heading toward target at ~3 deg/tick
    const rate = 3 * DEG_TO_RAD;
    state.heading = slewAngle(state.heading, state.autopilot.targetHeading, rate);
    state.rudderAngle = slewAngle(state.rudderAngle, 0, 0.02);
    // Rudder proportional to correction needed
    let err = state.autopilot.targetHeading - state.heading;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    state.rudderAngle = clamp(err * 0.5, -30 * DEG_TO_RAD, 30 * DEG_TO_RAD);
  }
  if (state.autopilot.state === 'wind' && state.autopilot.targetWindAngle) {
    // Steer to maintain target apparent wind angle
    const windDir = state.heading + state.windAngleApparent;
    const targetHeading = windDir - state.autopilot.targetWindAngle;
    state.heading = slewAngle(state.heading, targetHeading, 2 * DEG_TO_RAD);
  }
  // True heading = magnetic + variation
  state.headingTrue = state.heading + state.magneticVariation;
  // Rate of turn
  state.rateOfTurn = noise(0, 0.002); // small noise when stable
}

// ── UPDATE STATE PER SCENARIO ────────────────────────────
function updateState() {
  scenarioTick++;

  switch (scenario) {

    // ── EXISTING SCENARIOS ──────────────────────────────
    case 'atAnchor':
      state.sog = noise(0.1, 0.15);
      state.position.lat += (Math.random() - 0.5) * 0.00001;
      state.position.lon += (Math.random() - 0.5) * 0.00001;
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0; state.engines[id].oilPressure = 0;
        state.transmissionGear[id] = 'neutral';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-2.5, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(profile.depth, 0.3);
      state.forwardDepth = noise(profile.depth + 2, 0.5);
      state.autopilot.state = 'standby';
      state.baroPressure = noise(101300, 30);
      break;

    case 'motoring':
      state.sog = noise(3.6, 0.3);
      state.cog = noise(1.57, 0.05);
      state.heading = noise(state.cog, 0.03);
      state.position.lat += 0.00005 * Math.cos(state.cog);
      state.position.lon += 0.00005 * Math.sin(state.cog);
      for (const [id, e] of Object.entries(state.engines)) {
        e.rpm = noise(2200, 50);
        e.oilPressure = noise(42, 3) * 6894.76;
        e.coolantTemp = noise(82, 2) + 273.15;
        e.exhaustTemp = noise(380, 15) + 273.15;
        e.fuelRate = noise(8.5, 0.5) / 3600000;
        e.hours += 0.0003;
        state.transmissionGear[id] = 'forward';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(45, 5);
        b.soc = Math.min(1, b.soc + 0.0001);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.depth = noise(15, 2);
      state.forwardDepth = noise(16, 2);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.baroPressure = noise(101300, 30);
      break;

    case 'sailing':
      state.sog = noise(3.3, 0.4);
      state.cog = noise(2.09, 0.08);
      state.heading = noise(state.cog, 0.05);
      state.position.lat += 0.00004 * Math.cos(state.cog);
      state.position.lon += 0.00004 * Math.sin(state.cog);
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0; state.engines[id].oilPressure = 0;
        state.transmissionGear[id] = 'neutral';
      }
      state.windSpeedApparent = noise(8.5, 1.5);
      state.windAngleApparent = noise(0.87, 0.15);
      state.windSpeedTrue = noise(10.2, 1.8);
      state.windAngleTrue = noise(1.05, 0.12);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-3.5, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(25, 5);
      state.forwardDepth = noise(27, 5);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'wind';
      state.autopilot.targetWindAngle = 0.87;
      state.baroPressure = noise(101300, 30);
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
      state.baroPressure = noise(101300, 30);
      break;

    case 'shorepower':
      state.sog = 0;
      state.shore.connected = true;
      state.shore.voltage = noise(120, 2);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(30, 5);
        b.soc = Math.min(1, b.soc + 0.0001);
      }
      state.baroPressure = noise(101300, 30);
      break;

    case 'alarm':
      state.sog = noise(0.1, 0.1);
      state.bilgePump.running = Math.random() > 0.6;
      for (const b of Object.values(state.batteries)) { b.current = noise(-4, 1); }
      state.baroPressure = noise(101300, 30);
      break;

    // ── INTELLIGENCE-TRIGGERING SCENARIOS ────────────────

    case 'windShift': {
      // Sailing beam reach, wind gradually rotates 30 degrees over ~2 min
      // Triggers tactical advisor: "wind shifted, new optimal heading is..."
      const baseWindDir = 1.57; // ~90 deg (east)
      const shiftRate = 0.5 * DEG_TO_RAD; // 0.5 deg per tick
      const maxShift = 30 * DEG_TO_RAD;
      const shift = Math.min(scenarioTick * shiftRate, maxShift);

      state.windAngleTrue = noise(baseWindDir + shift, 0.05);
      state.windAngleApparent = state.windAngleTrue - 0.18; // apparent slightly forward
      state.windSpeedTrue = noise(7.7, 0.8);   // ~15 kts
      state.windSpeedApparent = noise(8.2, 0.8);
      state.sog = noise(3.6, 0.3);   // ~7 kts
      state.cog = noise(0.0, 0.05);  // heading ~north
      state.heading = noise(state.cog, 0.03);
      state.position.lat += 0.00005 * Math.cos(state.cog);
      state.position.lon += 0.00005 * Math.sin(state.cog);
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0;
        state.transmissionGear[id] = 'neutral';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-3, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(30, 3);
      state.forwardDepth = noise(32, 3);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'auto';
      state.autopilot.targetHeading = 0.0; // holding north — won't adapt to wind shift
      state.baroPressure = noise(101300, 20);
      break;
    }

    case 'weatherBuilding': {
      // Wind building from 12 to 22+ kts over ~3 minutes, baro dropping
      // Triggers: reef recommendation, course adjustment
      const windBuild = Math.min(scenarioTick * 0.055, 5.15); // 0→5.15 m/s (~0→10 kts added)
      const baroDrop = Math.min(scenarioTick * 0.5, 500);      // 0→500 Pa (5 hPa drop)

      state.windSpeedTrue = noise(6.17 + windBuild, 0.8);  // starts ~12 kts, builds to ~22
      state.windSpeedApparent = state.windSpeedTrue + noise(0.5, 0.3);
      state.windAngleTrue = noise(1.05, 0.08);    // ~60 deg
      state.windAngleApparent = noise(0.87, 0.08);
      state.sog = noise(3.6 - windBuild * 0.15, 0.3); // speed drops as wind builds
      state.cog = noise(5.24, 0.05);  // ~300 deg heading
      state.heading = noise(state.cog, 0.03);
      state.position.lat += 0.00004 * Math.cos(state.cog);
      state.position.lon += 0.00004 * Math.sin(state.cog);
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0;
        state.transmissionGear[id] = 'neutral';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-4, 1.5);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
      }
      state.solar.power = getSolarPower() * 0.4; // cloudy
      state.depth = noise(40, 5);
      state.forwardDepth = noise(42, 5);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'wind';
      state.autopilot.targetWindAngle = 1.05;
      state.baroPressure = noise(101300 - baroDrop, 20);
      state.airTemp = noise(27, 0.5); // cooling
      break;
    }

    case 'nightPassage': {
      // Overnight passage: AP on heading, slow battery drain, AIS contacts
      // Triggers: energy projection, CPA alerts, watch mode
      state.sog = noise(3.34, 0.3);   // ~6.5 kts
      state.cog = noise(6.11, 0.04);  // ~350 deg (heading to Grenada)
      state.heading = noise(state.cog, 0.02);
      state.position.lat += 0.00005 * Math.cos(state.cog);
      state.position.lon += 0.00005 * Math.sin(state.cog);
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0;
        state.transmissionGear[id] = 'neutral';
      }
      state.windSpeedTrue = noise(9.26, 1.0);   // ~18 kts
      state.windSpeedApparent = noise(10.3, 1.0);
      state.windAngleTrue = noise(1.05, 0.06);   // ~60 deg
      state.windAngleApparent = noise(0.87, 0.06);
      // Battery draining — nav lights + instruments + AP + fridge
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-6, 1.5); // 6A draw (~144W at 24V)
        b.soc = Math.max(0.05, b.soc + b.current * 0.000015);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.solar.power = 0; // night
      state.depth = noise(200, 30); // deep water
      state.forwardDepth = noise(200, 30);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'auto';
      state.autopilot.targetHeading = 6.11;
      // Baro slowly falling
      state.baroPressure = noise(101100 - scenarioTick * 0.1, 20);
      state.airTemp = noise(25, 0.3); // cooler at night
      break;
    }

    case 'approachingPort': {
      // Entering harbor: depth decreasing, lots of AIS, engines on low
      // Triggers: depth trend alerts, speed advisory, AIS awareness
      const depthBase = Math.max(3.5, 15 - scenarioTick * 0.12); // 15m → 3.5m
      state.depth = noise(depthBase, 0.3);
      state.forwardDepth = noise(Math.max(2.8, depthBase - 1.5), 0.3); // forward scan shows shallower
      state.sog = noise(2.06, 0.2);   // ~4 kts, slowing
      state.cog = noise(4.71, 0.05);  // ~270 deg west
      state.heading = noise(state.cog, 0.03);
      state.position.lat += 0.00003 * Math.cos(state.cog);
      state.position.lon += 0.00003 * Math.sin(state.cog);
      for (const [id, e] of Object.entries(state.engines)) {
        e.rpm = noise(1200, 50);
        e.oilPressure = noise(38, 2) * 6894.76;
        e.coolantTemp = noise(75, 2) + 273.15;
        e.exhaustTemp = noise(320, 10) + 273.15;
        e.fuelRate = noise(4.5, 0.3) / 3600000;
        state.transmissionGear[id] = 'forward';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(25, 3);
        b.soc = Math.min(1, b.soc + 0.00005);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'standby'; // hand steering
      state.baroPressure = noise(101300, 20);
      break;
    }

    case 'crossingCurrent': {
      // Sailing across a current: COG ≠ heading by ~15 degrees
      // Triggers: "current pushing you south, adjust 15° north"
      const currentSet = 15 * DEG_TO_RAD; // 15 deg drift
      state.heading = noise(0.0, 0.03);  // pointing north
      state.cog = noise(0.0 + currentSet, 0.03); // tracking NNE due to current
      state.sog = noise(3.6, 0.3);
      state.position.lat += 0.00005 * Math.cos(state.cog);
      state.position.lon += 0.00005 * Math.sin(state.cog);
      for (const id of Object.keys(state.engines)) {
        state.engines[id].rpm = 0;
        state.transmissionGear[id] = 'neutral';
      }
      state.windSpeedTrue = noise(7.72, 1.0);   // ~15 kts
      state.windSpeedApparent = noise(8.2, 1.0);
      state.windAngleTrue = noise(1.57, 0.08);   // beam reach (~90 deg)
      state.windAngleApparent = noise(1.31, 0.08);
      for (const b of Object.values(state.batteries)) {
        b.current = noise(-3, 1);
        b.soc = Math.max(0.1, b.soc + b.current * 0.00001);
      }
      state.solar.power = getSolarPower();
      state.depth = noise(50, 5);
      state.forwardDepth = noise(52, 5);
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'auto';
      state.autopilot.targetHeading = 0.0;
      state.baroPressure = noise(101300, 20);
      break;
    }

    case 'heavyWeather': {
      // 25+ knot winds, high engine load, big rudder swings
      // Triggers: double reef advisory, wave angle optimization
      state.windSpeedTrue = noise(14.4, 2.0);   // 25-30 kts
      state.windSpeedApparent = noise(15.4, 2.0);
      state.windAngleTrue = noise(0.87, 0.15);   // ~50 deg — close hauled
      state.windAngleApparent = noise(0.70, 0.12);
      state.sog = noise(3.09, 0.5);   // ~6 kts, pounding
      state.cog = noise(5.24, 0.1);   // ~300 deg
      state.heading = noise(state.cog, 0.08); // more heading oscillation
      state.position.lat += 0.00004 * Math.cos(state.cog);
      state.position.lon += 0.00004 * Math.sin(state.cog);
      // Engines on for safety, high load
      for (const [id, e] of Object.entries(state.engines)) {
        e.rpm = noise(2800, 100);
        e.oilPressure = noise(45, 3) * 6894.76;
        e.coolantTemp = noise(89, 3) + 273.15; // running hot
        e.exhaustTemp = noise(440, 20) + 273.15;
        e.fuelRate = noise(12, 1) / 3600000;
        e.hours += 0.0003;
        state.transmissionGear[id] = 'forward';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(55, 8);
        b.soc = Math.min(1, b.soc + 0.0001);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.generator.running = true;
      state.generator.voltage = noise(240, 3);
      state.depth = noise(60, 10);
      state.forwardDepth = noise(62, 10);
      state.rudderAngle = noise(0, 0.35); // big swings
      state.rateOfTurn = noise(0, 0.03);  // lots of yaw
      state.tripLog += state.sog * 2;
      state.totalLog += state.sog * 2;
      state.autopilot.state = 'auto';
      state.autopilot.targetHeading = 5.24;
      // Baro dropping fast
      state.baroPressure = noise(100800 - scenarioTick * 0.3, 30);
      state.airTemp = noise(24, 0.5);
      break;
    }

    case 'manOverboard': {
      // MOB: Williamson turn — heading changes rapidly, engines at 1800 RPM
      // Triggers: CRITICAL safety alert, AP in MOB mode
      const turnPhase = scenarioTick % 90; // 3 minute cycle
      const turnRate = 5 * DEG_TO_RAD; // 5 deg/tick = aggressive turn
      if (turnPhase < 30) {
        // Phase 1: hard to starboard
        state.heading += turnRate;
        state.rudderAngle = 25 * DEG_TO_RAD;
      } else if (turnPhase < 60) {
        // Phase 2: steady on reciprocal
        state.rudderAngle = slew(state.rudderAngle, 0, 2 * DEG_TO_RAD);
      } else {
        // Phase 3: approach MOB position
        state.sog = slew(state.sog, 1.0, 0.05);
        state.rudderAngle = noise(0, 0.05);
      }
      state.rateOfTurn = turnPhase < 30 ? noise(0.08, 0.01) : noise(0, 0.005);
      state.cog = state.heading + noise(0, 0.03);
      state.sog = turnPhase < 60 ? noise(2.57, 0.3) : noise(1.0, 0.2); // ~5kts then slowing
      state.position.lat += (state.sog * 2 * Math.cos(state.cog)) / 111320;
      state.position.lon += (state.sog * 2 * Math.sin(state.cog)) / (111320 * Math.cos(state.position.lat * DEG_TO_RAD));
      for (const [id, e] of Object.entries(state.engines)) {
        e.rpm = noise(1800, 50);
        e.oilPressure = noise(40, 2) * 6894.76;
        e.coolantTemp = noise(80, 2) + 273.15;
        e.exhaustTemp = noise(360, 10) + 273.15;
        e.fuelRate = noise(7, 0.5) / 3600000;
        state.transmissionGear[id] = 'forward';
      }
      for (const b of Object.values(state.batteries)) {
        b.current = noise(40, 5);
        b.soc = Math.min(1, b.soc + 0.00005);
        b.voltage = b.nominal + b.soc * (b.nominal === 24 ? 4.2 : 2.1);
      }
      state.depth = noise(30, 3);
      state.forwardDepth = noise(32, 3);
      state.autopilot.state = 'MOB';
      state.baroPressure = noise(101300, 20);
      break;
    }
  }

  // ── Common updates (all scenarios) ─────────────────────
  state.waterTemp = noise(28.5, 0.3);
  state.airTemp = state.airTemp || noise(30, 0.5);

  // Wind update for non-sailing scenarios that don't set their own
  const customWindScenarios = ['sailing', 'windShift', 'weatherBuilding', 'nightPassage', 'crossingCurrent', 'heavyWeather'];
  if (profile.hasWind && !customWindScenarios.includes(scenario)) {
    state.windSpeedApparent = noise(3.5, 2);
    state.windAngleApparent = noise(0.78, 0.3);
    state.windSpeedTrue = noise(4.2, 2.5);
    state.windAngleTrue = noise(0.92, 0.35);
  }

  // Autopilot steering (applies heading slew + true heading calc)
  updateAutopilotSteering();

  // AIS movement
  updateAIS();
}

// ── BUILD SIGNALK DELTAS ─────────────────────────────────
// Returns array: [selfDelta, ...aisDeltas]
function buildDeltas() {
  const values = [];
  const pos = state.position;
  const ts = new Date().toISOString();

  // Navigation
  values.push({ path: 'navigation.position', value: { latitude: pos.lat, longitude: pos.lon } });
  values.push({ path: 'navigation.speedOverGround', value: state.sog });
  values.push({ path: 'navigation.courseOverGroundTrue', value: state.cog });
  values.push({ path: 'navigation.headingMagnetic', value: state.heading });
  values.push({ path: 'navigation.headingTrue', value: state.headingTrue });
  values.push({ path: 'navigation.magneticVariation', value: state.magneticVariation });
  values.push({ path: 'navigation.rateOfTurn', value: state.rateOfTurn });
  values.push({ path: 'navigation.trip.log', value: state.tripLog });
  values.push({ path: 'navigation.log', value: state.totalLog });
  values.push({ path: 'navigation.datetime', value: ts });

  // Environment
  values.push({ path: 'environment.depth.belowTransducer', value: state.depth });
  values.push({ path: 'environment.water.temperature', value: state.waterTemp + 273.15 });

  if (profile.hasBarometer) {
    values.push({ path: 'environment.outside.temperature', value: (state.airTemp || 30) + 273.15 });
    values.push({ path: 'environment.outside.pressure', value: state.baroPressure });
  }

  if (profile.hasForwardScan) {
    values.push({ path: 'environment.depth.transducerForward', value: state.forwardDepth });
  }

  if (profile.hasWind) {
    values.push({ path: 'environment.wind.speedApparent', value: state.windSpeedApparent });
    values.push({ path: 'environment.wind.angleApparent', value: state.windAngleApparent });
    values.push({ path: 'environment.wind.speedTrue', value: state.windSpeedTrue });
    values.push({ path: 'environment.wind.angleTrueWater', value: state.windAngleTrue });
  }

  // Steering
  values.push({ path: 'steering.rudderAngle', value: state.rudderAngle });
  if (profile.hasAutopilot) {
    values.push({ path: 'steering.autopilot.state', value: state.autopilot.state });
    values.push({ path: 'steering.autopilot.target.headingMagnetic', value: state.autopilot.targetHeading });
    values.push({ path: 'steering.autopilot.target.windAngleApparent', value: state.autopilot.targetWindAngle });
  }

  // Engines + transmission
  for (const [id, e] of Object.entries(state.engines)) {
    const p = `propulsion.${id}`;
    values.push({ path: `${p}.revolutions`, value: e.rpm / 60 });
    values.push({ path: `${p}.oilPressure`, value: e.rpm > 0 ? e.oilPressure : 0 });
    values.push({ path: `${p}.coolantTemperature`, value: e.coolantTemp > 100 ? e.coolantTemp : e.coolantTemp + 273.15 });
    values.push({ path: `${p}.exhaustTemperature`, value: e.exhaustTemp > 100 ? e.exhaustTemp : e.exhaustTemp + 273.15 });
    values.push({ path: `${p}.runTime`, value: e.hours * 3600 });
    values.push({ path: `${p}.fuel.rate`, value: e.fuelRate });
    values.push({ path: `${p}.transmission.gear`, value: state.transmissionGear[id] || 'neutral' });
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

  if (profile.hasAnchor && state.anchor.deployed) {
    values.push({ path: 'navigation.anchor.position', value: { latitude: state.anchor.lat, longitude: state.anchor.lon } });
    values.push({ path: 'navigation.anchor.maxRadius', value: state.anchor.radius });
  }

  // Self delta
  const selfDelta = {
    context: 'vessels.self',
    updates: [{ source: { label: 'commander-sim' }, timestamp: ts, values }],
  };

  const deltas = [selfDelta];

  // AIS vessel deltas
  if (profile.hasAIS) {
    for (const v of state.ais) {
      deltas.push({
        context: `vessels.urn:mrn:imo:mmsi:${v.mmsi}`,
        updates: [{ source: { label: 'ais-sim' }, timestamp: ts, values: [
          { path: 'navigation.position', value: { latitude: v.lat, longitude: v.lon } },
          { path: 'navigation.speedOverGround', value: v.sog },
          { path: 'navigation.courseOverGroundTrue', value: v.cog },
          { path: 'name', value: v.name },
          { path: 'mmsi', value: v.mmsi },
          { path: 'communication.callsignVhf', value: v.callsign },
        ]}],
      });
    }
  }

  return deltas;
}

// ── HTTP + WS SERVER ─────────────────────────────────────
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/signalk/v1/stream' });

app.use(express.json());

app.get('/signalk', (req, res) => res.json({
  endpoints: { v1: { version: '2.0.0', 'signalk-http': `http://localhost:${PORT}/signalk/v1/api`, 'signalk-ws': `ws://localhost:${PORT}/signalk/v1/stream` } },
  server: { id: 'commander-sim', version: '1.0.0' },
}));

app.get('/signalk/v1/api/vessels/self', (req, res) => {
  const deltas = buildDeltas();
  const selfDelta = deltas[0];
  const result = {};
  for (const v of selfDelta.updates[0].values) {
    const parts = v.path.split('.');
    let obj = result;
    for (let i = 0; i < parts.length - 1; i++) { if (!obj[parts[i]]) obj[parts[i]] = {}; obj = obj[parts[i]]; }
    obj[parts[parts.length - 1]] = { value: v.value, timestamp: selfDelta.updates[0].timestamp };
  }
  res.json(result);
});

app.get('/scenario', (req, res) => res.json({ current: scenario, available: SCENARIOS }));
app.post('/scenario/:name', (req, res) => {
  if (!SCENARIOS[req.params.name]) return res.status(400).json({ error: 'Unknown', available: Object.keys(SCENARIOS) });

  // Reset transient state
  state.generator.running = false;
  state.shore.connected = false;
  state.bilgePump.running = false;
  state.rudderAngle = 0;
  state.rateOfTurn = 0;
  state.ais = [];
  for (const e of Object.values(state.engines)) { e.coolantTemp = 25; e.exhaustTemp = 45; }
  for (const id of Object.keys(state.transmissionGear)) state.transmissionGear[id] = 'neutral';

  // Anchor: deploy when stationary
  const stationaryScenarios = ['atAnchor', 'charging', 'shorepower', 'alarm'];
  if (stationaryScenarios.includes(req.params.name)) {
    state.anchor.deployed = true;
    state.anchor.lat = state.position.lat;
    state.anchor.lon = state.position.lon;
  } else {
    state.anchor.deployed = false;
  }

  // Set scenario-specific initial conditions
  switch (req.params.name) {
    case 'nightPassage':
      state.batteries.house.soc = 0.32; // mid-passage, drained
      state.batteries.house.voltage = 24 + 0.32 * 4.2;
      break;
    case 'weatherBuilding':
      state.batteries.house.soc = 0.58;
      break;
    case 'heavyWeather':
      state.batteries.house.soc = 0.45;
      break;
  }

  // Spawn AIS traffic for relevant scenarios
  const p = state.position;
  switch (req.params.name) {
    case 'nightPassage':
      spawnAIS([
        { key: 'caribbeanStar', lat: p.lat + 0.05, lon: p.lon - 0.02, sogKts: 12, cogDeg: 180 }, // cargo heading south
        { key: 'islandBreeze', lat: p.lat - 0.03, lon: p.lon + 0.04, sogKts: 5, cogDeg: 350 },  // sailboat same direction
        { key: 'pelican', lat: p.lat + 0.02, lon: p.lon + 0.01, sogKts: 3, cogDeg: 90 },        // fishing boat
      ]);
      break;
    case 'approachingPort':
      spawnAIS([
        { key: 'fortGeorge', lat: p.lat + 0.01, lon: p.lon - 0.02, sogKts: 15, cogDeg: 90 },    // ferry
        { key: 'caribbeanStar', lat: p.lat - 0.005, lon: p.lon - 0.03, sogKts: 0.5, cogDeg: 0 },// cargo at anchor
        { key: 'sarahJane', lat: p.lat + 0.008, lon: p.lon - 0.01, sogKts: 4, cogDeg: 270 },    // motor yacht leaving
        { key: 'windDancer', lat: p.lat - 0.003, lon: p.lon - 0.015, sogKts: 0.2, cogDeg: 0 },  // anchored
        { key: 'mariePierre', lat: p.lat + 0.002, lon: p.lon - 0.008, sogKts: 3, cogDeg: 90 },  // entering
        { key: 'pelican', lat: p.lat - 0.012, lon: p.lon + 0.005, sogKts: 4, cogDeg: 315 },     // fishing
        { key: 'seaHawk', lat: p.lat + 0.006, lon: p.lon - 0.025, sogKts: 8, cogDeg: 180 },     // motor yacht transiting
      ]);
      break;
    case 'crossingCurrent':
      spawnAIS([
        { key: 'caribbeanStar', lat: p.lat + 0.08, lon: p.lon + 0.01, sogKts: 11, cogDeg: 190 }, // converging cargo
      ]);
      break;
    case 'heavyWeather':
      spawnAIS([
        { key: 'islandBreeze', lat: p.lat + 0.04, lon: p.lon - 0.03, sogKts: 4, cogDeg: 300 },   // another boat in same weather
      ]);
      break;
  }

  scenarioTick = 0;
  scenario = req.params.name;
  console.log(`\u{1F504} Scenario: ${scenario} \u2014 ${SCENARIOS[scenario]}`);
  res.json({ scenario, description: SCENARIOS[scenario] });
});

app.get('/', (req, res) => {
  res.send(`<html><head><title>Commander Simulator</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:monospace;padding:20px}
h1{color:#0ea5e9}a{color:#10b981}.s{padding:8px 16px;margin:4px;display:inline-block;
background:#1e293b;border:1px solid #334155;border-radius:6px;cursor:pointer;color:#e2e8f0;text-decoration:none}
.a{border-color:#10b981;color:#10b981}.new{border-color:#f59e0b;color:#f59e0b}
h2{color:#f59e0b;margin-top:20px}</style></head>
<body><h1>\u2693 Commander Simulator \u2014 ${profile.name}</h1>
<p>Scenario: <strong>${scenario}</strong> \u2014 ${SCENARIOS[scenario]}</p>
<p>AIS targets: ${state.ais.length}</p>
<h2>Original</h2>
${['atAnchor','motoring','sailing','charging','shorepower','alarm'].map(k => `<a class="s ${k===scenario?'a':''}" href="#" onclick="fetch('/scenario/${k}',{method:'POST'}).then(()=>location.reload())">${k}</a>`).join('')}
<h2>Intelligence Triggers</h2>
${['windShift','weatherBuilding','nightPassage','approachingPort','crossingCurrent','heavyWeather','manOverboard'].map(k => `<a class="s new ${k===scenario?'a':''}" href="#" onclick="fetch('/scenario/${k}',{method:'POST'}).then(()=>location.reload())">${k}</a>`).join('')}
<hr><p>WS: ws://localhost:${PORT}/signalk/v1/stream</p>
<p>REST: <a href="/signalk/v1/api/vessels/self">/signalk/v1/api/vessels/self</a></p>
<p>Paths: ~${45 + (profile.hasAIS ? state.ais.length * 6 : 0)} per delta cycle</p>
</body></html>`);
});

// ── WebSocket connection + PUT handler ────────────────────
wss.on('connection', (ws) => {
  console.log(`\u{1F50C} Client connected (${wss.clients.size})`);
  ws.send(JSON.stringify({ name: 'commander-sim', self: 'vessels.self', timestamp: new Date().toISOString() }));

  // Handle incoming PUT messages (autopilot control)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!msg.requestId || !msg.put) return;

      const { path, value } = msg.put;
      const WRITABLE = [
        'steering.autopilot.state',
        'steering.autopilot.target.headingMagnetic',
        'steering.autopilot.target.windAngleApparent',
      ];

      if (!WRITABLE.includes(path)) {
        ws.send(JSON.stringify({ requestId: msg.requestId, state: 'FAILED', message: `Path not writable: ${path}` }));
        return;
      }

      // Ack immediately
      ws.send(JSON.stringify({ requestId: msg.requestId, state: 'PENDING' }));

      // Process with slight delay (realistic)
      setTimeout(() => {
        switch (path) {
          case 'steering.autopilot.state':
            state.autopilot.state = value;
            console.log(`  \u{1F3AF} AP state \u2192 ${value}`);
            break;
          case 'steering.autopilot.target.headingMagnetic':
            state.autopilot.targetHeading = value;
            console.log(`  \u{1F3AF} AP heading \u2192 ${(value * RAD_TO_DEG).toFixed(1)}\u00B0`);
            break;
          case 'steering.autopilot.target.windAngleApparent':
            state.autopilot.targetWindAngle = value;
            console.log(`  \u{1F3AF} AP wind angle \u2192 ${(value * RAD_TO_DEG).toFixed(1)}\u00B0`);
            break;
        }
        ws.send(JSON.stringify({ requestId: msg.requestId, state: 'COMPLETED' }));
      }, 500 + Math.random() * 500);
    } catch {}
  });

  ws.on('close', () => console.log(`\u{1F50C} Client disconnected (${wss.clients.size})`));
});

// ── BROADCAST LOOP ───────────────────────────────────────
setInterval(() => {
  updateState();
  const deltas = buildDeltas();
  for (const c of wss.clients) {
    if (c.readyState === 1) {
      for (const delta of deltas) c.send(JSON.stringify(delta));
    }
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551  \u2693 Simulator: ${profile.name.padEnd(42)}\u2551
\u2551  Profile: ${profileArg.padEnd(46)}\u2551
\u2551  Scenarios: ${Object.keys(SCENARIOS).length} (${Object.keys(SCENARIOS).filter(k => !['atAnchor','motoring','sailing','charging','shorepower','alarm'].includes(k)).length} intelligence triggers)${''.padEnd(11)}\u2551
\u2551  AIS library: ${Object.keys(AIS_LIBRARY).length} vessels${''.padEnd(32)}\u2551
\u2551  WS:   ws://localhost:${String(PORT).padEnd(36)}\u2551
\u2551  REST: http://localhost:${String(PORT).padEnd(35)}\u2551
\u2551  Web:  http://localhost:${String(PORT).padEnd(35)}\u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D`);
});
