// ============================================================
// ALERT ENGINE — Auto-adapting rule-based monitoring
// ============================================================
// No LLM. Pure code. Runs on anything. Rules auto-enable
// when the relevant sensors are discovered by SignalK client.
// ============================================================

import { EventEmitter } from 'events';
import { haversineM } from './signalk-client.js';

export class AlertEngine extends EventEmitter {
  constructor(sk, config = {}) {
    super();
    this.sk = sk;
    this.config = config;
    this.lastFired = {};
    this.bilgeCycles = [];
    this.interval = null;
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
    const t = this.config;
    const battT  = t.batteries?.thresholds || {};
    const engT   = t.engines?.thresholds || {};
    const safeT  = t.safety || {};
    const tankT  = t.tanks?.thresholds || {};

    // ── Batteries ────────────────────────────────────────
    for (const id of this.sk.discovered.batteries) {
      const b = this.sk.getBattery(id);
      if (b.soc == null) continue;

      if (b.soc < (battT.socCritical ?? 10)) {
        this._fire(`batt_crit_${id}`, 'critical', 300000,
          `🚨 BATTERY CRITICAL [${id}]: ${b.soc}% | ${b.voltage}V | ${b.current > 0 ? '+' : ''}${b.current}A — SHED LOADS NOW`);
      } else if (b.soc < (battT.socWarning ?? 20)) {
        this._fire(`batt_low_${id}`, 'warning', 600000,
          `⚠️ Battery low [${id}]: ${b.soc}% | ${b.voltage}V | ${b.current > 0 ? 'charging' : 'discharging'} ${Math.abs(b.current)}A`);
      }
    }

    // ── Engines ──────────────────────────────────────────
    for (const id of this.sk.discovered.engines) {
      const e = this.sk.getEngine(id);
      if (!e.running) continue;

      if (e.coolantTemp != null && e.coolantTemp > (engT.coolantTempMax ?? 95)) {
        this._fire(`eng_heat_${id}`, 'critical', 60000,
          `🚨 ENGINE OVERHEAT [${id}]: Coolant ${e.coolantTemp}°C — check raw water intake & impeller!`);
      }
      if (e.oilPressure != null && e.oilPressure < (engT.oilPressureMin ?? 25)) {
        this._fire(`eng_oil_${id}`, 'critical', 60000,
          `🚨 LOW OIL PRESSURE [${id}]: ${e.oilPressure} PSI at ${e.rpm} RPM — reduce power, check oil level!`);
      }
      if (e.exhaustTemp != null && e.exhaustTemp > (engT.exhaustTempMax ?? 500)) {
        this._fire(`eng_exhaust_${id}`, 'warning', 120000,
          `⚠️ High exhaust temp [${id}]: ${e.exhaustTemp}°C at ${e.rpm} RPM`);
      }
    }

    // ── Depth ────────────────────────────────────────────
    if (this.sk.discovered.hasDepth) {
      const depth = this.sk.get('environment.depth.belowTransducer')
                 ?? this.sk.get('environment.depth.belowKeel');
      if (depth != null && depth > 0 && depth < (safeT.depthMinimum ?? 2.5)) {
        this._fire('shallow', 'warning', 60000,
          `⚠️ SHALLOW WATER: ${depth}m — proceed with caution`);
      }
    }

    // ── Anchor drag ──────────────────────────────────────
    if (this.sk.discovered.hasAnchor) {
      const anchorPos = this.sk.raw['navigation.anchor.position'];
      const maxRadius = this.sk.raw['navigation.anchor.maxRadius'] ?? (safeT.anchorAlarmRadius ?? 30);
      const boatPos = this.sk.getPosition();
      if (anchorPos && boatPos) {
        const dist = haversineM(boatPos.lat, boatPos.lon, anchorPos.latitude, anchorPos.longitude);
        if (dist > maxRadius) {
          const wind = this.sk.get('environment.wind.speedApparent');
          this._fire('anchor_drag', 'critical', 120000,
            `🚨 ANCHOR DRAG: ${Math.round(dist)}m from set point (limit ${Math.round(maxRadius)}m)${wind ? ` | Wind ${wind} kts` : ''} — CHECK ANCHOR`);
        }
      }
    }

    // ── Bilge pump frequency ─────────────────────────────
    const bilgeRunning = this.sk.raw['notifications.bilgePump.running'];
    if (bilgeRunning) this.bilgeCycles.push(Date.now());
    const windowMs = (safeT.bilgeWindowMinutes ?? 30) * 60000;
    this.bilgeCycles = this.bilgeCycles.filter(t => Date.now() - t < windowMs);
    if (this.bilgeCycles.length > (safeT.bilgeCyclesMax ?? 6)) {
      this._fire('bilge', 'critical', 300000,
        `🚨 BILGE PUMP cycling: ${this.bilgeCycles.length}× in ${safeT.bilgeWindowMinutes ?? 30} min — POSSIBLE LEAK, inspect bilge!`);
    }

    // ── Tanks ────────────────────────────────────────────
    for (const [type, ids] of Object.entries(this.sk.discovered.tanks)) {
      for (const id of ids) {
        const tank = this.sk.getTank(type, id);
        if (tank.level == null) continue;
        const threshold = type === 'fuel' ? (tankT.fuelLow ?? 15) : type === 'freshWater' ? (tankT.waterLow ?? 15) : null;
        if (threshold && tank.level > 0 && tank.level < threshold) {
          const emoji = type === 'fuel' ? '⛽' : '💧';
          this._fire(`tank_${type}_${id}`, 'info', 3600000,
            `${emoji} ${type} low [${id}]: ${tank.level}%`);
        }
      }
    }
  }
}
