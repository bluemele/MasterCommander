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
import { createIngestion } from './boat-ingestion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const ALERT_BUFFER_SIZE = 50;
const SSE_INTERVAL = 2000;
const MAX_SSE_CONNECTIONS = 20;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;

export function startTelemetryServer({ sk, alerts, advisor, config, configManager, profileManager, templateEngine, scheduler }) {
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
      try {
        if (!sk.connected) {
          res.write('event: status\ndata: {"connected":false}\n\n');
          return;
        }
        const snapshot = sk.getSnapshot();
        snapshot._alerts = alertBuffer.slice(-10);
        if (advisor) snapshot._advisor = advisor.getActive();
        res.write('data: ' + JSON.stringify(snapshot) + '\n\n');
      } catch (err) {
        console.error('[telemetry-server] SSE send error:', err.message);
      }
    };

    send(); // immediate first push
    const timer = setInterval(send, SSE_INTERVAL);

    // Guard against double-decrement from both close + error firing
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      sseConnectionCount = Math.max(0, sseConnectionCount - 1);
    };

    req.on('close', cleanup);

    req.on('error', (err) => {
      console.error('[telemetry-server] SSE request error:', err.message);
      cleanup();
    });
  });

  // ── REST: latest snapshot ───────────────────────────────
  app.get('/api/telemetry/latest', rateLimit, (req, res) => {
    try {
      if (!sk.connected) {
        return res.json({ _meta: { connected: false }, _alerts: [] });
      }
      const snapshot = sk.getSnapshot();
      snapshot._alerts = alertBuffer.slice(-10);
      res.json(snapshot);
    } catch (err) {
      console.error('[telemetry-server] /api/telemetry/latest error:', err.message);
      res.status(500).json({ error: 'Failed to build snapshot' });
    }
  });

  // ── REST: scenario list ─────────────────────────────────
  app.get('/api/telemetry/scenarios', rateLimit, async (req, res) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `Simulator returned ${resp.status}` });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      const detail = e.name === 'TimeoutError' ? 'Simulator request timed out' : e.message;
      res.status(502).json({ error: 'Simulator not reachable', detail });
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
      const resp = await fetch(`http://127.0.0.1:${simPort}/scenario/${name}`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `Simulator returned ${resp.status}` });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      const detail = e.name === 'TimeoutError' ? 'Simulator request timed out' : e.message;
      res.status(502).json({ error: 'Simulator not reachable', detail });
    }
  });

  // ── REST: recent alerts ─────────────────────────────────
  app.get('/api/telemetry/alerts', rateLimit, (req, res) => {
    try {
      res.json({ alerts: alertBuffer.slice().reverse() });
    } catch (err) {
      console.error('[telemetry-server] /api/telemetry/alerts error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve alerts' });
    }
  });

  // ── ADVISOR: active recommendations ────────────────────
  app.get('/api/advisor/recommendations', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.json({ recommendations: [] });
      res.json({ recommendations: advisor.getActive() });
    } catch (err) {
      console.error('[telemetry-server] /api/advisor/recommendations error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve recommendations' });
    }
  });

  app.post('/api/advisor/accept/:id', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
      const rec = advisor.accept(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Recommendation not found or not active' });
      res.json({ accepted: rec });
    } catch (err) {
      console.error('[telemetry-server] /api/advisor/accept error:', err.message);
      res.status(500).json({ error: 'Failed to accept recommendation' });
    }
  });

  app.post('/api/advisor/dismiss/:id', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
      const rec = advisor.dismiss(req.params.id);
      if (!rec) return res.status(404).json({ error: 'Recommendation not found or not active' });
      res.json({ dismissed: rec });
    } catch (err) {
      console.error('[telemetry-server] /api/advisor/dismiss error:', err.message);
      res.status(500).json({ error: 'Failed to dismiss recommendation' });
    }
  });

  app.get('/api/advisor/explain/:id', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.status(404).json({ error: 'Advisor not initialized' });
      const explanation = advisor.explain(req.params.id);
      if (!explanation) return res.status(404).json({ error: 'Recommendation not found' });
      res.json(explanation);
    } catch (err) {
      console.error('[telemetry-server] /api/advisor/explain error:', err.message);
      res.status(500).json({ error: 'Failed to explain recommendation' });
    }
  });

  app.get('/api/advisor/history', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.json({ history: [] });
      res.json({ history: advisor.getHistory() });
    } catch (err) {
      console.error('[telemetry-server] /api/advisor/history error:', err.message);
      res.status(500).json({ error: 'Failed to retrieve history' });
    }
  });

  // ── PERFORMANCE: polar data ───────────────────────────
  app.get('/api/performance', rateLimit, (req, res) => {
    try {
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
    } catch (err) {
      console.error('[telemetry-server] /api/performance error:', err.message);
      res.status(500).json({ error: 'Failed to compute performance' });
    }
  });

  // ── ENERGY: projection ────────────────────────────────
  app.get('/api/energy/projection', rateLimit, (req, res) => {
    try {
      if (!advisor) return res.json({ error: 'Advisor not initialized' });
      const energyModule = advisor.modules.get('energy');
      if (!energyModule) return res.json({ error: 'Energy module not loaded' });
      const summary = energyModule.module.getSummary();
      res.json(summary || { error: 'No data' });
    } catch (err) {
      console.error('[telemetry-server] /api/energy/projection error:', err.message);
      res.status(500).json({ error: 'Failed to compute energy projection' });
    }
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
    // Validate scenario name before forwarding
    if (!VALID_SCENARIOS.includes(scenario)) {
      return res.status(400).json({ error: 'Boat has invalid simScenario', scenario });
    }
    try {
      const demoSimPort = process.env.SIM_PORT || 3858;
      const resp = await fetch(`http://127.0.0.1:${demoSimPort}/scenario/${scenario}`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `Simulator returned ${resp.status}` });
      const data = await resp.json();
      res.json({ boat: boat.name, scenario: data.scenario, profile: boat.simProfile });
    } catch (e) {
      const detail = e.name === 'TimeoutError' ? 'Simulator request timed out' : e.message;
      res.status(502).json({ error: 'Simulator not reachable', detail });
    }
  });

  // ══════════════════════════════════════════════════════
  // CONFIG API — Read/write boat-config.json sections
  // ══════════════════════════════════════════════════════

  if (configManager) {
    app.get('/api/config/:section', (req, res) => {
      try {
        const data = configManager.get(req.params.section);
        if (data === undefined) return res.status(404).json({ error: 'Section not found' });
        res.json(data);
      } catch (err) {
        console.error('[telemetry-server] GET /api/config error:', err.message);
        res.status(500).json({ error: 'Failed to read config' });
      }
    });

    app.put('/api/config/:section', (req, res) => {
      try {
        if (req.body == null || typeof req.body !== 'object') return res.status(400).json({ error: 'Body must be a JSON object or array' });
        // Block direct writes to rules/schedules (use dedicated endpoints)
        if (['rules', 'schedules'].includes(req.params.section)) return res.status(400).json({ error: 'Use /api/' + req.params.section + ' endpoints instead' });
        configManager.update(req.params.section, req.body);
        res.json({ ok: true, section: req.params.section });
      } catch (e) {
        console.error('[telemetry-server] PUT /api/config error:', e.message);
        res.status(400).json({ error: e.message });
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // RULES API — CRUD for alert rules
  // ══════════════════════════════════════════════════════

  if (configManager) {
    app.get('/api/rules', (req, res) => {
      try {
        res.json(configManager.get('rules') || []);
      } catch (err) {
        console.error('[telemetry-server] GET /api/rules error:', err.message);
        res.status(500).json({ error: 'Failed to read rules' });
      }
    });

    app.post('/api/rules', (req, res) => {
      try {
        const rule = req.body;
        if (!rule.id) rule.id = configManager.generateId();
        if (rule.enabled === undefined) rule.enabled = true;
        const errors = configManager.validateRule(rule);
        if (errors.length) return res.status(400).json({ errors });
        const rules = configManager.get('rules') || [];
        if (rules.find(r => r.id === rule.id)) return res.status(409).json({ error: 'Rule ID already exists' });
        rules.push(rule);
        configManager.update('rules', rules);
        if (alerts) alerts.setRules(rules);
        res.status(201).json(rule);
      } catch (err) {
        console.error('[telemetry-server] POST /api/rules error:', err.message);
        res.status(500).json({ error: 'Failed to create rule' });
      }
    });

    app.put('/api/rules/:id', (req, res) => {
      try {
        const rules = configManager.get('rules') || [];
        const idx = rules.findIndex(r => r.id === req.params.id);
        if (idx < 0) return res.status(404).json({ error: 'Rule not found' });
        const updated = { ...rules[idx], ...req.body, id: req.params.id };
        const errors = configManager.validateRule(updated);
        if (errors.length) return res.status(400).json({ errors });
        rules[idx] = updated;
        configManager.update('rules', rules);
        if (alerts) alerts.setRules(rules);
        res.json(updated);
      } catch (err) {
        console.error('[telemetry-server] PUT /api/rules error:', err.message);
        res.status(500).json({ error: 'Failed to update rule' });
      }
    });

    app.delete('/api/rules/:id', (req, res) => {
      try {
        const rules = configManager.get('rules') || [];
        const idx = rules.findIndex(r => r.id === req.params.id);
        if (idx < 0) return res.status(404).json({ error: 'Rule not found' });
        rules.splice(idx, 1);
        configManager.update('rules', rules);
        if (alerts) alerts.setRules(rules);
        res.json({ ok: true });
      } catch (err) {
        console.error('[telemetry-server] DELETE /api/rules error:', err.message);
        res.status(500).json({ error: 'Failed to delete rule' });
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // SCHEDULES API — CRUD for scheduled tasks
  // ══════════════════════════════════════════════════════

  if (configManager) {
    app.get('/api/schedules', (req, res) => {
      try {
        res.json(configManager.get('schedules') || []);
      } catch (err) {
        console.error('[telemetry-server] GET /api/schedules error:', err.message);
        res.status(500).json({ error: 'Failed to read schedules' });
      }
    });

    app.post('/api/schedules', (req, res) => {
      try {
        if (req.body == null || typeof req.body !== 'object') return res.status(400).json({ error: 'Body must be a JSON object' });
        const sched = req.body;
        if (!sched.id) sched.id = configManager.generateId();
        if (sched.enabled === undefined) sched.enabled = true;
        const errors = configManager.validateSchedule(sched);
        if (errors.length) return res.status(400).json({ errors });
        const schedules = configManager.get('schedules') || [];
        if (schedules.find(s => s.id === sched.id)) return res.status(409).json({ error: 'Schedule ID already exists' });
        schedules.push(sched);
        configManager.update('schedules', schedules);
        if (scheduler) scheduler.reload();
        res.status(201).json(sched);
      } catch (err) {
        console.error('[telemetry-server] POST /api/schedules error:', err.message);
        res.status(500).json({ error: 'Failed to create schedule' });
      }
    });

    app.put('/api/schedules/:id', (req, res) => {
      try {
        const schedules = configManager.get('schedules') || [];
        const idx = schedules.findIndex(s => s.id === req.params.id);
        if (idx < 0) return res.status(404).json({ error: 'Schedule not found' });
        const updated = { ...schedules[idx], ...req.body, id: req.params.id };
        const errors = configManager.validateSchedule(updated);
        if (errors.length) return res.status(400).json({ errors });
        schedules[idx] = updated;
        configManager.update('schedules', schedules);
        if (scheduler) scheduler.reload();
        res.json(updated);
      } catch (err) {
        console.error('[telemetry-server] PUT /api/schedules error:', err.message);
        res.status(500).json({ error: 'Failed to update schedule' });
      }
    });

    app.delete('/api/schedules/:id', (req, res) => {
      try {
        const schedules = configManager.get('schedules') || [];
        const idx = schedules.findIndex(s => s.id === req.params.id);
        if (idx < 0) return res.status(404).json({ error: 'Schedule not found' });
        schedules.splice(idx, 1);
        configManager.update('schedules', schedules);
        if (scheduler) scheduler.reload();
        res.json({ ok: true });
      } catch (err) {
        console.error('[telemetry-server] DELETE /api/schedules error:', err.message);
        res.status(500).json({ error: 'Failed to delete schedule' });
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // PROFILES API — User profile management
  // ══════════════════════════════════════════════════════

  if (profileManager) {
    app.get('/api/profiles', (req, res) => {
      try {
        res.json({
          profiles: profileManager.getAllProfiles(),
          active: profileManager.getActive(),
        });
      } catch (err) {
        console.error('[telemetry-server] GET /api/profiles error:', err.message);
        res.status(500).json({ error: 'Failed to read profiles' });
      }
    });

    app.get('/api/profiles/active', (req, res) => {
      try {
        const activeId = profileManager.getActive();
        const profile = activeId ? profileManager.getProfile(activeId) : null;
        res.json({ active: activeId, profile });
      } catch (err) {
        console.error('[telemetry-server] GET /api/profiles/active error:', err.message);
        res.status(500).json({ error: 'Failed to read active profile' });
      }
    });

    app.put('/api/profiles/active', (req, res) => {
      try {
        if (req.body == null || typeof req.body !== 'object') return res.status(400).json({ error: 'Body must be a JSON object' });
        const { profileId } = req.body;
        if (profileId && !profileManager.getProfile(profileId)) return res.status(404).json({ error: 'Profile not found' });
        const profile = profileManager.setActive(profileId || null);
        res.json({ active: profileId, profile });
      } catch (err) {
        console.error('[telemetry-server] PUT /api/profiles/active error:', err.message);
        res.status(500).json({ error: 'Failed to set active profile' });
      }
    });

    app.post('/api/profiles', (req, res) => {
      try {
        const profile = profileManager.createCustom(req.body);
        res.status(201).json(profile);
      } catch (err) {
        console.error('[telemetry-server] POST /api/profiles error:', err.message);
        res.status(500).json({ error: 'Failed to create profile' });
      }
    });

    app.put('/api/profiles/:id', (req, res) => {
      try {
        const updated = profileManager.updateProfile(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: 'Profile not found' });
        res.json(updated);
      } catch (err) {
        console.error('[telemetry-server] PUT /api/profiles/:id error:', err.message);
        res.status(500).json({ error: 'Failed to update profile' });
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // TEMPLATES API — Message template management
  // ══════════════════════════════════════════════════════

  if (configManager) {
    app.get('/api/templates', (req, res) => {
      try {
        res.json(configManager.get('templates') || {});
      } catch (err) {
        console.error('[telemetry-server] GET /api/templates error:', err.message);
        res.status(500).json({ error: 'Failed to read templates' });
      }
    });

    app.put('/api/templates', (req, res) => {
      try {
        const templates = req.body;
        for (const [key, val] of Object.entries(templates)) {
          if (typeof val !== 'string') return res.status(400).json({ error: `Template "${key}" must be a string` });
          if (val.length > 2000) return res.status(400).json({ error: `Template "${key}" exceeds 2000 chars` });
        }
        configManager.update('templates', templates);
        res.json({ ok: true });
      } catch (err) {
        console.error('[telemetry-server] PUT /api/templates error:', err.message);
        res.status(500).json({ error: 'Failed to update templates' });
      }
    });
  }

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

  // ── Boat telemetry ingestion (PostgreSQL) ────────────────
  createIngestion(app);

  // ── Global error handler (must be last middleware) ──────
  app.use((err, req, res, next) => {
    console.error('[telemetry-server] Unhandled route error:', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // ── Start server ────────────────────────────────────────
  const server = createServer(app);
  server.on('error', (err) => {
    console.error('[telemetry-server] Server error:', err.message);
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Telemetry API listening');
  });

  return { app, server, pushAlert };
}
