// ============================================================
// COMMANDER — Main Orchestrator
// ============================================================
// Ties together: SignalK → Alerts → LLM → WhatsApp
// Loads boat config, auto-discovers equipment, routes messages.
//
// Usage:
//   node commander.js                    # uses boat-config.json
//   node commander.js --no-whatsapp      # headless (alerts to file)
//   node commander.js --config my.json   # custom config
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { SignalKClient } from './lib/signalk-client.js';
import { AlertEngine } from './lib/alert-engine.js';
import { LLMRouter } from './lib/llm-router.js';
import { StatusBuilder } from './lib/status-builder.js';
import { WhatsAppBot } from './lib/whatsapp.js';
import { startTelemetryServer } from './lib/telemetry-server.js';
import { SailingAdvisor } from './lib/intelligence/advisor.js';
import { PolarEngine } from './lib/intelligence/polar-engine.js';
import { TacticalAdvisor } from './lib/intelligence/tactical-advisor.js';
import { WeatherIntelligence } from './lib/intelligence/weather-intelligence.js';
import { EnergyManager } from './lib/intelligence/energy-manager.js';

// ── Parse CLI args ───────────────────────────────────────
const args = process.argv.slice(2);
const noWhatsApp = args.includes('--no-whatsapp');
const configFile = args.includes('--config')
  ? args[args.indexOf('--config') + 1]
  : 'boat-config.json';

// ── Load config ──────────────────────────────────────────
if (!existsSync(configFile)) {
  console.error(`\n❌ Config not found: ${configFile}`);
  console.error('   Run: node setup-wizard.js\n');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configFile, 'utf8'));
const dataDir = config.dataDir || './data';
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// ── Banner ───────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════╗
║  ⚓ COMMANDER${config.boat?.name ? ` — ${config.boat.name}` : ''}
║  SignalK:   ${config.signalk?.host || 'localhost'}:${config.signalk?.port || 3000}
║  LLM:       ${config.llm?.provider || 'local'}${config.llm?.provider === 'local' ? ` (${config.llm?.ollamaModel || 'qwen2.5:14b'})` : ''}
║  WhatsApp:  ${noWhatsApp ? 'disabled' : (config.whatsapp?.mode || 'dedicated')}
╚══════════════════════════════════════════════════════════╝
`);

// ── Initialize components ────────────────────────────────
const sk = new SignalKClient(config.signalk || {});
const alerts = new AlertEngine(sk, config);
const llm = new LLMRouter(config.llm || {});
const status = new StatusBuilder(sk, config);

// ── Initialize Intelligence Layer ──────────────────────
let advisor = null;
try {
  const polar = new PolarEngine();
  advisor = new SailingAdvisor({ signalkClient: sk, polarEngine: polar, config });

  const tactical = new TacticalAdvisor({ signalkClient: sk, polarEngine: polar, config });
  const weather = new WeatherIntelligence({ signalkClient: sk, config });
  const energy = new EnergyManager({
    signalkClient: sk,
    config: {
      batteryCapacityAh: config.batteries?.house?.capacity || 1700,
      nominalVoltage: config.batteries?.house?.nominal || 24,
      socWarning: config.batteries?.thresholds?.socWarning || 20,
      socCritical: config.batteries?.thresholds?.socCritical || 10,
    },
  });

  advisor.register('tactical', tactical, 30);
  advisor.register('weather', weather, 60);
  advisor.register('energy', energy, 30);
  console.log('🧠 Intelligence layer initialized');
} catch (e) {
  console.warn('⚠️  Intelligence layer failed to load:', e.message);
  console.warn('   Advisor features disabled. Core monitoring still active.');
}

let wa = null;
if (!noWhatsApp && config.whatsapp?.adminNumber) {
  wa = new WhatsAppBot({
    mode: config.whatsapp.mode || 'dedicated',
    authDir: config.whatsapp.authDir || './auth',
    adminNumber: config.whatsapp.adminNumber,
    allowedNumbers: config.whatsapp.allowedNumbers || [],
    respondToGroups: config.whatsapp.respondToGroups || false,
    triggerWord: config.whatsapp.triggerWord || 'commander',
  });
}

// ── Quick command routing (no LLM needed) ────────────────
const COMMANDS = {
  'status':   () => status.status(),
  'engines':  () => status.engines(),
  'battery':  () => status.battery(),
  'position': () => status.position(),
  'tanks':    () => status.tanks(),
  'help':     () => status.help(),
  'wind':     () => {
    if (!sk.discovered.hasWind) return '💨 No wind instruments detected';
    const ws = sk.get('environment.wind.speedApparent');
    const windAngle = sk.get('environment.wind.angleApparent');
    const d = sk.get('environment.depth.belowTransducer') ?? sk.get('environment.depth.belowKeel');
    const wt = sk.get('environment.water.temperature');
    let s = '';
    if (ws != null) s += `💨 Wind: ${ws} kts${windAngle != null ? ` @ ${windAngle}°` : ''} apparent\n`;
    if (d != null) s += `🌊 Depth: ${d}m\n`;
    if (wt != null) s += `🌡️ Water: ${wt}°C`;
    return s || '💨 No wind data available';
  },
  'anchor': () => {
    if (!sk.discovered.hasAnchor) return '⚓ No anchor watch data on SignalK';
    const ap = sk.raw['navigation.anchor.position'];
    const bp = sk.getPosition();
    if (!ap || !bp) return '⚓ Anchor position not set';
    const drift = Math.round(
      Math.sqrt(Math.pow((bp.lat - ap.latitude) * 111320, 2) + Math.pow((bp.lon - ap.longitude) * 111320 * Math.cos(bp.lat * Math.PI/180), 2))
    );
    const r = sk.raw['navigation.anchor.maxRadius'] ?? '?';
    return `⚓ Anchor deployed\nSwing: ${drift}m / ${r}m limit\n📍 ${ap.latitude.toFixed(6)}, ${ap.longitude.toFixed(6)}`;
  },
};

// ── Boat-query keyword detection ─────────────────────────
const BOAT_KEYWORDS = [
  'boat', 'engine', 'battery', 'fuel', 'water', 'anchor', 'wind', 'depth',
  'position', 'speed', 'heading', 'oil', 'coolant', 'solar', 'generator',
  'bilge', 'tank', 'yanmar', 'victron', 'autopilot', 'radar', 'impeller',
  'how is', 'how are', 'how\'s', 'what\'s the', 'what is the', 'check',
  'worried', 'concern', 'problem', 'alarm', 'alert', 'safe',
  'report', 'summary', 'overview', 'everything ok', 'all good',
  'commander', 'stbd', 'starboard', 'port', 'shore', 'gps',
  'knots', 'sailing', 'motoring', 'at anchor', 'underway',
];

// ── Message handler ──────────────────────────────────────
async function handleMessage(text, senderNumber, isGroup) {
  const msg = text.trim();
  const lower = msg.toLowerCase().replace(/^\//, '');

  // Quick commands (instant, no LLM)
  if (COMMANDS[lower]) return COMMANDS[lower]();

  // Check if it's a boat-related question
  const isBoatQuery = BOAT_KEYWORDS.some(kw => lower.includes(kw));

  if (isBoatQuery) {
    console.log(`🤖 Boat query → LLM: "${msg.substring(0, 50)}..."`);
    try {
      const snapshot = sk.getSnapshot();
      snapshot._config = { boat: config.boat };
      return await llm.ask(msg, snapshot);
    } catch (e) {
      console.error('LLM error:', e.message);
      return `⚠️ AI unavailable right now. Quick report:\n\n${status.status()}`;
    }
  }

  // Not a boat query
  if (wa?.mode === 'dedicated') {
    // Dedicated mode: everything is for Commander
    return status.help();
  }

  // Bridge mode: return null so other handlers can process
  return null;
}

// ── Wire up WhatsApp ─────────────────────────────────────
if (wa) {
  wa.onMessage = handleMessage;
}

// ── Alert → WhatsApp forwarding ──────────────────────────
const pendingAlerts = [];

alerts.on('alert', async (alert) => {
  if (wa?.connected) {
    const sent = await wa.sendAlert(alert.message);
    if (!sent) pendingAlerts.push(alert);
  } else {
    pendingAlerts.push(alert);
    // Also write to file for headless mode
    const file = `${dataDir}/alerts.jsonl`;
    try { writeFileSync(file, JSON.stringify(alert) + '\n', { flag: 'a' }); } catch {}
  }
});

// Retry pending alerts every 30s
setInterval(async () => {
  if (!wa?.connected || pendingAlerts.length === 0) return;
  const batch = pendingAlerts.splice(0, 5);  // send up to 5 at once
  for (const alert of batch) {
    const sent = await wa.sendAlert(alert.message);
    if (!sent) pendingAlerts.push(alert);
  }
}, 30000);

// ── Telemetry logging ────────────────────────────────────
setInterval(() => {
  if (!sk.connected) return;
  const today = new Date().toISOString().split('T')[0];
  const file = `${dataDir}/telemetry-${today}.jsonl`;
  const entry = JSON.stringify({ t: new Date().toISOString(), ...sk.getSnapshot() });
  try { writeFileSync(file, entry + '\n', { flag: 'a' }); } catch {}
}, 60000);

// ── Discovery logging ────────────────────────────────────
sk.on('discovered', (item) => {
  const file = `${dataDir}/discovered.json`;
  try { writeFileSync(file, JSON.stringify(sk.discovered, null, 2)); } catch {}
});

// ── Start everything ─────────────────────────────────────
sk.connect();
alerts.start();

// Start telemetry API for dashboard gauges
const telemetry = startTelemetryServer({ sk, alerts, advisor, config });

// Start advisor after SignalK connects (needs live data)
if (advisor) {
  sk.on('discovered', () => {
    if (!advisor._running) {
      advisor.start();
    }
  });
  // Forward critical recommendations to WhatsApp
  advisor.on('critical', async (rec) => {
    const msg = `🚨 *${rec.title}*\n${rec.reasoning}`;
    if (wa?.connected) {
      await wa.sendAlert(msg);
    } else {
      const file = `${dataDir}/alerts.jsonl`;
      try { writeFileSync(file, JSON.stringify({ ...rec, timestamp: new Date().toISOString() }) + '\n', { flag: 'a' }); } catch {}
    }
  });
}

if (wa) {
  // Delay WhatsApp start slightly to let SignalK connect first
  setTimeout(() => {
    console.log('\n📱 Starting WhatsApp...');
    wa.start();
  }, 2000);
}

// ── Graceful shutdown ────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n⚓ Commander shutting down...');
  alerts.stop();
  if (advisor) advisor.stop();
  process.exit(0);
});

// ── Export for testing / integration ─────────────────────
export { sk, alerts, llm, status, handleMessage, config };
