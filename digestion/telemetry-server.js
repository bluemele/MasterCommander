// ============================================================
// TELEMETRY SERVER — SSE + REST API for dashboard gauges
// ============================================================
// Receives SignalK client + AlertEngine from commander.js.
// Streams live snapshots via SSE, serves REST for latest state,
// scenario control, and recent alerts.
//
// Endpoints:
//   GET  /api/telemetry/live         SSE stream (2s interval)
//   GET  /api/telemetry/latest       JSON snapshot
//   GET  /api/telemetry/scenarios    Available scenarios
//   POST /api/telemetry/scenario/:n  Switch simulator scenario
//   GET  /api/telemetry/alerts       Recent alerts (ring buffer)
// ============================================================

import express from 'express';
import { createServer } from 'http';

const ALERT_BUFFER_SIZE = 50;
const SSE_INTERVAL = 2000;

export function startTelemetryServer({ sk, alerts, config }) {
  const app = express();
  const port = parseInt(process.env.TELEMETRY_PORT || '3100');
  const simPort = config?.signalk?.port || 3858;

  // Alert ring buffer
  const alertBuffer = [];

  function pushAlert(alert) {
    alertBuffer.push(alert);
    if (alertBuffer.length > ALERT_BUFFER_SIZE) alertBuffer.shift();
  }

  // Pipe alert events in
  if (alerts) {
    alerts.on('alert', (alert) => pushAlert(alert));
  }

  app.use(express.json());
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  // Valid scenario names (must match simulator.js allowlist)
  const VALID_SCENARIOS = ['atAnchor', 'motoring', 'sailing', 'charging', 'shorepower', 'alarm'];

  // ── SSE: live telemetry stream ──────────────────────────
  app.get('/api/telemetry/live', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // SSE comment to establish connection

    const send = () => {
      if (!sk.connected) {
        res.write('event: status\ndata: {"connected":false}\n\n');
        return;
      }
      const snapshot = sk.getSnapshot();
      snapshot._alerts = alertBuffer.slice(-10);
      res.write('data: ' + JSON.stringify(snapshot) + '\n\n');
    };

    send(); // immediate first push
    const timer = setInterval(send, SSE_INTERVAL);

    req.on('close', () => {
      clearInterval(timer);
    });
  });

  // ── REST: latest snapshot ───────────────────────────────
  app.get('/api/telemetry/latest', (req, res) => {
    if (!sk.connected) {
      return res.json({ _meta: { connected: false }, _alerts: [] });
    }
    const snapshot = sk.getSnapshot();
    snapshot._alerts = alertBuffer.slice(-10);
    res.json(snapshot);
  });

  // ── REST: scenario list ─────────────────────────────────
  app.get('/api/telemetry/scenarios', async (req, res) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario`);
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Simulator not reachable', detail: e.message });
    }
  });

  // ── REST: switch scenario ───────────────────────────────
  app.post('/api/telemetry/scenario/:name', async (req, res) => {
    const name = req.params.name;
    // Validate against allowlist to prevent SSRF path traversal
    if (!VALID_SCENARIOS.includes(name)) {
      return res.status(400).json({ error: 'Invalid scenario', available: VALID_SCENARIOS });
    }
    try {
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario/${name}`, { method: 'POST' });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Simulator not reachable' });
    }
  });

  // ── REST: recent alerts ─────────────────────────────────
  app.get('/api/telemetry/alerts', (req, res) => {
    res.json({ alerts: alertBuffer.slice().reverse() });
  });

  // ── Start server ────────────────────────────────────────
  const server = createServer(app);
  server.listen(port, '127.0.0.1', () => {
    console.log(`📡 Telemetry API: http://127.0.0.1:${port}/api/telemetry/`);
  });

  return { app, server, pushAlert };
}
