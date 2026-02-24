// ============================================================
// TEST — Verify Commander works with the simulator
// ============================================================
// 1. Start simulator first: node simulator.js
// 2. Run this:              node test.js
// ============================================================

import { SignalKClient } from './lib/signalk-client.js';
import { AlertEngine } from './lib/alert-engine.js';
import { StatusBuilder } from './lib/status-builder.js';

const sk = new SignalKClient({ host: 'localhost', port: 3858 });
const alerts = new AlertEngine(sk, { safety: { bilgeCyclesMax: 6, bilgeWindowMinutes: 30 } });
const status = new StatusBuilder(sk, { boat: { name: 'Test Boat' } });

let alertCount = 0;
alerts.on('alert', (a) => { alertCount++; console.log(`  🚨 ${a.message}\n`); });

sk.on('connected', () => console.log('✅ Connected to simulator\n'));

sk.on('discovered', ({ type, id }) => {
  // Log discovery as it happens
});

sk.connect();
alerts.start();

console.log('⏳ Waiting 5 seconds for data...\n');

setTimeout(async () => {
  // ── Test 1: Auto-discovery ──────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 1: Auto-Discovery');
  console.log('═══════════════════════════════════════');
  console.log('  Engines:', sk.discovered.engines);
  console.log('  Batteries:', sk.discovered.batteries);
  console.log('  Tanks:', sk.discovered.tanks);
  console.log('  Wind:', sk.discovered.hasWind);
  console.log('  Depth:', sk.discovered.hasDepth);
  console.log('  Autopilot:', sk.discovered.hasAutopilot);
  console.log('  Anchor:', sk.discovered.hasAnchor);
  console.log('  Solar:', sk.discovered.hasSolar);
  console.log('  Generator:', sk.discovered.hasGenerator);
  console.log('  Total paths:', sk.paths.size);
  console.log('');

  // ── Test 2: Status reports ──────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 2: Status Reports');
  console.log('═══════════════════════════════════════\n');

  for (const cmd of ['status', 'engines', 'battery', 'position', 'tanks', 'help']) {
    console.log(`📩 "${cmd}":`);
    console.log('─'.repeat(40));
    console.log(status[cmd] ? status[cmd]() : 'Unknown command');
    console.log('');
  }

  // ── Test 3: Scenario change ─────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 3: Scenario Change → Motoring');
  console.log('═══════════════════════════════════════\n');

  try {
    await fetch('http://localhost:3858/scenario/motoring', { method: 'POST' });
    console.log('🔄 Switched to motoring, waiting 5s...\n');
    await new Promise(r => setTimeout(r, 5000));
    console.log(status.status());
    console.log('');
  } catch (e) {
    console.log('⚠️ Could not change scenario:', e.message);
  }

  // ── Test 4: Alarm scenario ──────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  TEST 4: Alarm Scenario');
  console.log('═══════════════════════════════════════\n');

  try {
    await fetch('http://localhost:3858/scenario/alarm', { method: 'POST' });
    console.log('🔄 Switched to alarm (bilge leak), waiting 10s for alerts...\n');
    await new Promise(r => setTimeout(r, 10000));
    console.log(`  Alerts fired: ${alertCount}`);
  } catch (e) {
    console.log('⚠️ Could not change scenario:', e.message);
  }

  // ── Test 5: Snapshot for LLM ────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 5: LLM Snapshot');
  console.log('═══════════════════════════════════════\n');
  const snap = sk.getSnapshot();
  console.log(JSON.stringify(snap, null, 2).substring(0, 500) + '...');

  console.log('\n✅ All tests complete!');
  process.exit(0);
}, 5000);
