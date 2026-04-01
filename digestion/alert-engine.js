// ============================================================
// ALERT ENGINE — Configurable rule-based monitoring
// ============================================================
// Evaluates rules from config against live SignalK data.
// Rules auto-enable when relevant sensors are discovered.
// Special handlers for stateful checks (anchor, bilge).
// ============================================================

import { EventEmitter } from 'events';
import { haversineM } from './signalk-client.js';

export class AlertEngine extends EventEmitter {
  constructor(sk, config = {}) {
    super();
    this.sk = sk;
    this.config = config;
    this.rules = [];
    this.lastFired = {};
    this.bilgeCycles = [];
    this.interval = null;
  }

  setRules(rules) {
    this.rules = Array.isArray(rules) ? rules : [];
    console.log(`🚨 Alert engine loaded ${this.rules.filter(r => r.enabled).length}/${this.rules.length} rules`);
  }

  start(ms = 5000) {
    console.log('🚨 Alert engine started');
    this.interval = setInterval(() => this._check(), ms);
  }

  stop() { if (this.interval) clearInterval(this.interval); }

  _fire(id, severity, cooldownMs, message) {
    const now = Date.now();
    if (now - (this.lastFired[id] || 0) < cooldownMs) return;
    this.lastFired[id] = now;
    console.log(`🚨 [${severity}] ${message}`);
    this.emit('alert', { id, severity, message, timestamp: new Date().toISOString() });
  }

  _check() {
    if (!this.sk.connected) return;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      try {
        // Special-case handlers for stateful rules
        if (rule.special === 'anchor_drag') {
          this._checkAnchorDrag(rule);
          continue;
        }
        if (rule.special === 'bilge') {
          this._checkBilge(rule);
          continue;
        }
        // Standard rule evaluation with wildcard expansion
        this._evaluateRule(rule);
      } catch (e) {
        // Skip broken rules silently
      }
    }
  }

  _evaluateRule(rule) {
    const trigger = rule.trigger;
    const wildcardMatch = trigger.match(/^(\w+)\.(\*)\.(\w+)$/);

    if (wildcardMatch) {
      // Wildcard: e.g. "batteries.*.soc" or "engines.*.coolantTemp"
      const [, category, , field] = wildcardMatch;
      const ids = this._getDiscoveredIds(category);
      for (const id of ids) {
        const value = this._getFieldValue(category, id, field);
        if (value == null) continue;
        if (this._evaluate(value, rule.condition)) {
          const ruleId = `${rule.id}_${id}`;
          const msg = this._formatMessage(rule, value, id);
          this._fire(ruleId, rule.severity, rule.cooldownMs || 60000, msg);
        }
      }
    } else if (trigger.match(/^tanks\.(\w+)\.\*\.(\w+)$/)) {
      // Tank wildcard: "tanks.fuel.*.level"
      const parts = trigger.split('.');
      const tankType = parts[1];
      const field = parts[3];
      const tankIds = this.sk.discovered.tanks?.[tankType] || [];
      for (const id of tankIds) {
        const tank = this.sk.getTank(tankType, id);
        const value = tank?.[field];
        if (value == null) continue;
        if (this._evaluate(value, rule.condition)) {
          const ruleId = `${rule.id}_${id}`;
          const msg = this._formatMessage(rule, value, id);
          this._fire(ruleId, rule.severity, rule.cooldownMs || 3600000, msg);
        }
      }
    } else {
      // Direct path: e.g. "environment.depth"
      const value = this._resolveDirectPath(trigger);
      if (value == null) return;
      if (this._evaluate(value, rule.condition)) {
        const msg = this._formatMessage(rule, value, null);
        this._fire(rule.id, rule.severity, rule.cooldownMs || 60000, msg);
      }
    }
  }

  _getDiscoveredIds(category) {
    switch (category) {
      case 'batteries': return this.sk.discovered.batteries || [];
      case 'engines': return this.sk.discovered.engines || [];
      default: return [];
    }
  }

  _getFieldValue(category, id, field) {
    if (category === 'batteries') {
      const b = this.sk.getBattery(id);
      return b?.[field] ?? null;
    }
    if (category === 'engines') {
      const e = this.sk.getEngine(id);
      if (!e?.running) return null; // Only check running engines
      return e?.[field] ?? null;
    }
    return null;
  }

  _resolveDirectPath(trigger) {
    // Map common trigger paths to SignalK data
    if (trigger === 'environment.depth') {
      if (!this.sk.discovered.hasDepth) return null;
      return this.sk.get('environment.depth.belowTransducer')
          ?? this.sk.get('environment.depth.belowKeel');
    }
    return this.sk.get(trigger);
  }

  _evaluate(value, condition) {
    const { op, value: threshold } = condition;
    switch (op) {
      case '<':  return value < threshold;
      case '>':  return value > threshold;
      case '<=': return value <= threshold;
      case '>=': return value >= threshold;
      case '==': return value === threshold;
      case '!=': return value !== threshold;
      default:   return false;
    }
  }

  _formatMessage(rule, value, id) {
    if (rule.message) {
      return rule.message
        .replace(/\{\{value\}\}/g, typeof value === 'number' ? value.toFixed(1) : String(value))
        .replace(/\{\{id\}\}/g, id || '')
        .replace(/\{\{threshold\}\}/g, String(rule.condition.value))
        .replace(/\{\{window\}\}/g, String(rule.params?.windowMinutes || ''));
    }
    return `${rule.severity === 'critical' ? '🚨' : '⚠️'} ${rule.name}: ${value} (threshold: ${rule.condition.op} ${rule.condition.value})`;
  }

  // ── Special handlers (stateful) ───────────────────────────

  _checkAnchorDrag(rule) {
    if (!this.sk.discovered.hasAnchor) return;
    const anchorPos = this.sk.raw['navigation.anchor.position'];
    const boatPos = this.sk.getPosition();
    if (!anchorPos || !boatPos) return;

    const dist = haversineM(boatPos.lat, boatPos.lon, anchorPos.latitude, anchorPos.longitude);
    const maxRadius = this.sk.raw['navigation.anchor.maxRadius'] ?? rule.condition.value;

    if (dist > maxRadius) {
      const wind = this.sk.get('environment.wind.speedApparent');
      const msg = rule.message
        ? rule.message
            .replace(/\{\{value\}\}/g, Math.round(dist))
            .replace(/\{\{threshold\}\}/g, Math.round(maxRadius))
        : `🚨 ANCHOR DRAG: ${Math.round(dist)}m from set point (limit ${Math.round(maxRadius)}m)`;
      const fullMsg = wind ? `${msg} | Wind ${wind} kts` : msg;
      this._fire('anchor_drag', rule.severity, rule.cooldownMs || 120000, fullMsg);
    }
  }

  _checkBilge(rule) {
    const bilgeRunning = this.sk.raw['notifications.bilgePump.running'];
    if (bilgeRunning) this.bilgeCycles.push(Date.now());

    const windowMs = (rule.params?.windowMinutes ?? 30) * 60000;
    this.bilgeCycles = this.bilgeCycles.filter(t => Date.now() - t < windowMs);

    if (this.bilgeCycles.length > rule.condition.value) {
      const msg = this._formatMessage(rule, this.bilgeCycles.length, null);
      this._fire('bilge', rule.severity, rule.cooldownMs || 300000, msg);
    }
  }
}
