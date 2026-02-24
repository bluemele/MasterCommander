// ============================================================
// SETUP WIZARD — Interactive Commander configuration
// ============================================================
// Walks a boat owner through setting up Commander.
// Generates boat-config.json from their answers.
//
// Run: node setup-wizard.js
// ============================================================

import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ⚓ COMMANDER — Setup Wizard                             ║
║  Let's configure Commander for your boat.                ║
╚══════════════════════════════════════════════════════════╝
`);

  // Load existing config if present
  let config = {};
  if (existsSync('boat-config.json')) {
    config = JSON.parse(readFileSync('boat-config.json', 'utf8'));
    console.log(`Found existing config for "${config.boat?.name || 'unnamed boat'}"`);
    const update = await ask('Update existing config? (y/n) ');
    if (update.toLowerCase() !== 'y') { rl.close(); return; }
  } else {
    config = JSON.parse(readFileSync('boat-config.template.json', 'utf8'));
  }

  // ── Boat Info ──────────────────────────────────────────
  console.log('\n─── BOAT INFO ───');
  config.boat.name = await ask(`Boat name [${config.boat.name || ''}]: `) || config.boat.name;
  config.boat.type = await ask(`Type (e.g. "Catamaran 58ft", "Monohull 40ft") [${config.boat.type || ''}]: `) || config.boat.type;
  const draftStr = await ask(`Draft in meters [${config.boat.draft || 1.5}]: `);
  if (draftStr) config.boat.draft = parseFloat(draftStr);
  config.boat.homePort = await ask(`Home port [${config.boat.homePort || ''}]: `) || config.boat.homePort;

  // ── SignalK Connection ─────────────────────────────────
  console.log('\n─── SIGNALK SERVER ───');
  console.log('(SignalK must be running on the Mac Mini)');
  config.signalk.host = await ask(`SignalK host [${config.signalk.host || 'localhost'}]: `) || config.signalk.host || 'localhost';
  const portStr = await ask(`SignalK port [${config.signalk.port || 3000}]: `);
  if (portStr) config.signalk.port = parseInt(portStr);

  // ── Safety Thresholds ──────────────────────────────────
  console.log('\n─── SAFETY THRESHOLDS ───');
  console.log('(Press enter to keep defaults)');
  const depthStr = await ask(`Minimum depth alarm (meters) [${config.safety.depthMinimum}]: `);
  if (depthStr) config.safety.depthMinimum = parseFloat(depthStr);
  const anchorStr = await ask(`Anchor alarm radius (meters) [${config.safety.anchorAlarmRadius}]: `);
  if (anchorStr) config.safety.anchorAlarmRadius = parseInt(anchorStr);

  // ── WhatsApp ───────────────────────────────────────────
  console.log('\n─── WHATSAPP ───');
  const waMode = await ask('WhatsApp mode — "dedicated" (boat has its own number) or "bridge" (your existing WhatsApp)? [dedicated]: ');
  config.whatsapp.mode = waMode === 'bridge' ? 'bridge' : 'dedicated';
  config.whatsapp.adminNumber = await ask(`Your phone number (country code + number, e.g. 18681234567): `) || config.whatsapp.adminNumber;

  const extraNumbers = await ask('Other allowed numbers (comma-separated, or enter to skip): ');
  config.whatsapp.allowedNumbers = [config.whatsapp.adminNumber];
  if (extraNumbers) {
    config.whatsapp.allowedNumbers.push(...extraNumbers.split(',').map(n => n.trim()));
  }

  // ── LLM ────────────────────────────────────────────────
  console.log('\n─── AI ENGINE ───');
  console.log('  "local"  — Qwen 14B via Ollama (works offline)');
  console.log('  "cloud"  — Claude CLI (needs internet)');
  console.log('  "auto"   — Claude when online, Qwen when offline');
  config.llm.provider = await ask(`LLM mode [${config.llm.provider || 'local'}]: `) || config.llm.provider || 'local';

  if (config.llm.provider === 'local' || config.llm.provider === 'auto') {
    config.llm.ollamaModel = await ask(`Ollama model [${config.llm.ollamaModel || 'qwen2.5:14b'}]: `) || config.llm.ollamaModel;
  }

  // ── Write config ───────────────────────────────────────
  config.dataDir = './data';
  writeFileSync('boat-config.json', JSON.stringify(config, null, 2));

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  ✅ Configuration saved to boat-config.json              ║
║                                                          ║
║  Next steps:                                             ║
║  1. Start SignalK:  signalk-server (or node simulator.js)║
║  2. Start Commander: node commander.js                   ║
║  3. Scan QR code when prompted                           ║
║  4. Text "${config.boat.name || 'your boat'}": status                          ║
╚══════════════════════════════════════════════════════════╝
`);

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
