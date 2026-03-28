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
import { readFileSync } from 'fs';
import { createServer } from 'http';
import pino from 'pino';
import weatherRouter from './weather-service.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const ALERT_BUFFER_SIZE = 50;
const SSE_INTERVAL = 2000;
const MAX_SSE_CONNECTIONS = 20;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;

export function startTelemetryServer({ sk, alerts, advisor, config }) {
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
  app.use('/api/weather', weatherRouter);
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  // Rate limiting for telemetry endpoints
  const rateLimits = new Map();
  function rateLimit(req, res, next) {
    const ip = req.headers['x-real-ip'] || req.ip;
    const now = Date.now();
    const entry = rateLimits.get(ip) || [];
    const recent = entry.filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    recent.push(now);
    rateLimits.set(ip, recent);
    next();
  }
  // Cleanup rate limit entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of rateLimits) {
      const valid = times.filter(t => now - t < RATE_WINDOW_MS);
      if (valid.length === 0) rateLimits.delete(ip);
      else rateLimits.set(ip, valid);
    }
  }, 300_000).unref();

  // SSE connection tracking
  let sseConnectionCount = 0;

  // Valid scenario names (must match simulator.js allowlist)
  const VALID_SCENARIOS = [
    'atAnchor', 'motoring', 'sailing', 'charging', 'shorepower', 'alarm',
    'windShift', 'weatherBuilding', 'nightPassage', 'approachingPort',
    'crossingCurrent', 'heavyWeather', 'manOverboard',
  ];

  // ── SSE: live telemetry stream ──────────────────────────
  app.get('/api/telemetry/live', rateLimit, (req, res) => {
    if (sseConnectionCount >= MAX_SSE_CONNECTIONS) {
      return res.status(503).json({ error: 'Too many connections' });
    }
    sseConnectionCount++;
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
      if (advisor) snapshot._advisor = advisor.getActive();
      res.write('data: ' + JSON.stringify(snapshot) + '\n\n');
    };

    send(); // immediate first push
    const timer = setInterval(send, SSE_INTERVAL);

    req.on('close', () => {
      clearInterval(timer);
      sseConnectionCount--;
    });
  });

  // ── REST: latest snapshot ───────────────────────────────
  app.get('/api/telemetry/latest', rateLimit, (req, res) => {
    if (!sk.connected) {
      return res.json({ _meta: { connected: false }, _alerts: [] });
    }
    const snapshot = sk.getSnapshot();
    snapshot._alerts = alertBuffer.slice(-10);
    res.json(snapshot);
  });

  // ── REST: scenario list ─────────────────────────────────
  app.get('/api/telemetry/scenarios', rateLimit, async (req, res) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario`);
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: 'Simulator not reachable', detail: e.message });
    }
  });

  // ── REST: switch scenario ───────────────────────────────
  app.post('/api/telemetry/scenario/:name', rateLimit, async (req, res) => {
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
  app.get('/api/telemetry/alerts', rateLimit, (req, res) => {
    res.json({ alerts: alertBuffer.slice().reverse() });
  });

  // ── ADVISOR: active recommendations ────────────────────
  app.get('/api/advisor/recommendations', rateLimit, (req, res) => {
    if (!advisor) return res.json({ recommendations: [] });
    res.json({ recommendations: advisor.getActive() });
  });

  app.post('/api/advisor/accept/:id', rateLimit, (req, res) => {
    if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
    const rec = advisor.accept(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recommendation not found or not active' });
    res.json({ accepted: rec });
  });

  app.post('/api/advisor/dismiss/:id', rateLimit, (req, res) => {
    if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
    const rec = advisor.dismiss(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recommendation not found or not active' });
    res.json({ dismissed: rec });
  });

  app.get('/api/advisor/explain/:id', rateLimit, (req, res) => {
    if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
    const explanation = advisor.explain(req.params.id);
    if (!explanation) return res.status(404).json({ error: 'Recommendation not found' });
    res.json(explanation);
  });

  app.get('/api/advisor/history', rateLimit, (req, res) => {
    if (!advisor) return res.json({ history: [] });
    res.json({ history: advisor.getHistory() });
  });

  // ── PERFORMANCE: polar data ───────────────────────────
  app.get('/api/performance', rateLimit, (req, res) => {
    if (!sk.connected) return res.json({ connected: false });
    const snap = sk.getSnapshot();
    const tws = snap.environment?.windSpeedTrue;
    const twa = snap.environment?.windAngleTrue;
    const sog = snap.navigation?.sog;
    const polar = advisor?.polar;

    const result = { tws, twa, sog };
    if (polar && tws != null && twa != null && sog != null) {
      result.targetSpeed = polar.getTargetSpeed(tws, twa);
      result.performance = polar.getPerformance(tws, twa, sog);
      result.optimalBeatAngle = polar.getOptimalBeatAngle(tws);
      result.optimalRunAngle = polar.getOptimalRunAngle(tws);
    }
    res.json(result);
  });

  // ── ENERGY: projection ────────────────────────────────
  app.get('/api/energy/projection', rateLimit, (req, res) => {
    if (!advisor) return res.json({ error: 'Advisor not initialized' });
    const energyModule = advisor.modules.get('energy');
    if (!energyModule) return res.json({ error: 'Energy module not loaded' });
    const summary = energyModule.module.getSummary();
    res.json(summary || { error: 'No data' });
  });

  // ── DEMO MODE ──────────────────────────────────────────
  let demoPersonas = null;
  let activeDemoPersona = null;
  try {
    // In container: /app/demo/personas.json. On host: ./demo/personas.json
    const paths = ['/app/demo/personas.json', new URL('./demo/personas.json', import.meta.url).pathname, new URL('../demo/personas.json', import.meta.url).pathname];
    for (const p of paths) {
      try { demoPersonas = JSON.parse(readFileSync(p, 'utf8')); break; } catch {}
    }
    if (demoPersonas) console.log(`  🎭 Demo: loaded ${demoPersonas.personas.length} personas (${demoPersonas.personas.reduce((s, p) => s + p.boats.length, 0)} boats)`);
  } catch {}

  app.get('/api/demo/personas', rateLimit, (req, res) => {
    if (!demoPersonas) return res.status(404).json({ error: 'Demo data not found' });
    res.json({
      personas: demoPersonas.personas.map(p => ({ id: p.id, name: p.name, icon: p.icon, description: p.description, boatCount: p.boats.length })),
      active: activeDemoPersona,
    });
  });

  app.post('/api/demo/activate/:id', rateLimit, (req, res) => {
    if (!demoPersonas) return res.status(404).json({ error: 'Demo data not found' });
    if (req.params.id === 'off') { activeDemoPersona = null; return res.json({ active: null }); }
    const persona = demoPersonas.personas.find(p => p.id === req.params.id);
    if (!persona) return res.status(404).json({ error: 'Unknown persona' });
    activeDemoPersona = req.params.id;
    res.json({ active: req.params.id, persona: persona.name });
  });

  app.get('/api/demo/boats', rateLimit, (req, res) => {
    if (!demoPersonas || !activeDemoPersona) return res.json({ boats: [], subscription: {} });
    const persona = demoPersonas.personas.find(p => p.id === activeDemoPersona);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ boats: persona.boats, subscription: persona.subscription });
  });

  app.get('/api/demo/boat/:id', rateLimit, (req, res) => {
    if (!demoPersonas || !activeDemoPersona) return res.status(400).json({ error: 'No demo active' });
    const persona = demoPersonas.personas.find(p => p.id === activeDemoPersona);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    const boat = persona.boats.find(b => b.id === parseInt(req.params.id));
    if (!boat) return res.status(404).json({ error: 'Boat not found' });
    res.json({ boat });
  });

  app.post('/api/demo/switch-boat/:id', rateLimit, async (req, res) => {
    if (!demoPersonas || !activeDemoPersona) return res.status(400).json({ error: 'No demo active' });
    const persona = demoPersonas.personas.find(p => p.id === activeDemoPersona);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    const boat = persona.boats.find(b => b.id === parseInt(req.params.id));
    if (!boat) return res.status(404).json({ error: 'Boat not found' });
    const scenario = boat.simScenario || 'atAnchor';
    try {
      const simPort = process.env.SIM_PORT || 3858;
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario/${scenario}`, { method: 'POST' });
      const data = await resp.json();
      res.json({ boat: boat.name, scenario: data.scenario, profile: boat.simProfile });
    } catch (e) {
      res.status(502).json({ error: 'Simulator not reachable' });
    }
  });

  // ── Health check ──────────────────────────────────────
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      connected: sk.connected,
      sseClients: sseConnectionCount,
      advisorModules: advisor ? advisor.modules.size : 0,
      activeRecommendations: advisor ? advisor.getActive().length : 0,
      uptime: Math.floor(process.uptime()),
    });
  });

  // ── Start server ────────────────────────────────────────
  const server = createServer(app);
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Telemetry API listening');
  });

  return { app, server, pushAlert };
}
