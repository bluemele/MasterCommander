// ============================================================
// SCHEDULER — Time-based task automation
// ============================================================
// Supports three schedule types:
//   - daily: fires at HH:MM each day
//   - weekly: fires on DAY at HH:MM each week
//   - interval: fires every Nm/Nh (e.g. "30m", "2h", "250h")
//
// Actions: digest, maintenance, watchHandoff, custom
// ============================================================

import { writeFileSync } from 'fs';

export class Scheduler {
  constructor({ configManager, templateEngine, sk, wa }) {
    this.configManager = configManager;
    this.tpl = templateEngine;
    this.sk = sk;
    this.wa = wa;
    this.timers = new Map();
    this._tickTimer = null;
    this._lastExecuted = new Map(); // scheduleId -> timestamp (prevents double-fire)
  }

  start() {
    // Master tick: check daily/weekly schedules every 60s
    this._tickTimer = setInterval(() => this._tick(), 60000);
    this._startIntervalSchedules();
    console.log('📅 Scheduler started');
  }

  stop() {
    if (this._tickTimer) clearInterval(this._tickTimer);
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this._lastExecuted.clear();
  }

  reload() {
    this.stop();
    this.start();
  }

  _tick() {
    const now = new Date();
    const schedules = this.configManager.get('schedules') || [];
    for (const sched of schedules.filter(s => s.enabled)) {
      if (sched.type === 'daily' && this._isDailyDue(sched, now)) {
        this._executeOnce(sched);
      }
      if (sched.type === 'weekly' && this._isWeeklyDue(sched, now)) {
        this._executeOnce(sched);
      }
    }
  }

  _startIntervalSchedules() {
    const schedules = this.configManager.get('schedules') || [];
    for (const sched of schedules.filter(s => s.enabled && s.type === 'interval')) {
      const ms = this._parseIntervalMs(sched.interval);
      if (ms > 0) {
        this.timers.set(sched.id, setInterval(() => this._execute(sched), ms));
      }
    }
  }

  _isDailyDue(sched, now) {
    if (!sched.time) return false;
    const [h, m] = sched.time.split(':').map(Number);
    return now.getHours() === h && now.getMinutes() === m;
  }

  _isWeeklyDue(sched, now) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    if (days[now.getDay()] !== sched.day?.toLowerCase()) return false;
    return this._isDailyDue(sched, now);
  }

  _executeOnce(sched) {
    // Prevent double-fire within same minute
    const key = `${sched.id}:${new Date().toISOString().slice(0, 16)}`;
    if (this._lastExecuted.has(key)) return;
    this._lastExecuted.set(key, Date.now());
    // Cleanup old entries
    if (this._lastExecuted.size > 200) {
      const cutoff = Date.now() - 3600000;
      for (const [k, t] of this._lastExecuted) {
        if (t < cutoff) this._lastExecuted.delete(k);
      }
    }
    this._execute(sched);
  }

  async _execute(sched) {
    try {
      switch (sched.action) {
        case 'digest': return this._sendDigest(sched);
        case 'maintenance': return this._checkMaintenance(sched);
        case 'watchHandoff': return this._watchHandoff(sched);
        case 'custom': return this._customMessage(sched);
        default: console.warn(`📅 Unknown schedule action: ${sched.action}`);
      }
    } catch (e) {
      console.error(`📅 Schedule ${sched.id} failed:`, e.message);
    }
  }

  _sendDigest(sched) {
    const config = this.configManager.getAll();
    const context = this.tpl.buildContext(this.sk, config);
    const message = this.tpl.render('digest', context);
    this._deliver(message, sched.recipients);
    console.log(`📅 Digest sent: ${sched.name || sched.id}`);
  }

  _checkMaintenance(sched) {
    if (!sched.params?.sensor || !sched.params?.threshold) return;
    const value = this._resolveSensor(sched.params.sensor);
    if (value == null) return;
    if (value >= sched.params.threshold) {
      const context = { task: { name: sched.name || 'Maintenance' }, value };
      const message = this.tpl.render('maintenance', context);
      this._deliver(message, sched.recipients);
      console.log(`📅 Maintenance alert: ${sched.name || sched.id}`);
    }
  }

  _watchHandoff(sched) {
    const config = this.configManager.getAll();
    const context = this.tpl.buildContext(this.sk, config);
    const message = this.tpl.render('watchHandoff', context);
    this._deliver(message, sched.recipients);
    console.log(`📅 Watch handoff sent: ${sched.name || sched.id}`);
  }

  _customMessage(sched) {
    if (!sched.params?.template) return;
    const config = this.configManager.getAll();
    const context = this.tpl.buildContext(this.sk, config);
    const message = this.tpl.renderString(sched.params.template, context);
    this._deliver(message, sched.recipients);
  }

  _resolveSensor(path) {
    if (!this.sk.connected) return null;
    // Try direct SignalK path first
    const val = this.sk.get(path);
    if (val != null) return val;
    // Try engine hours pattern
    const parts = path.split('.');
    if (parts[0] === 'engines' && parts.length >= 3) {
      const eng = this.sk.getEngine(parts[1]);
      return eng?.[parts[2]] ?? null;
    }
    return null;
  }

  async _deliver(message, recipients) {
    if (!message) return;
    if (this.wa?.connected) {
      if (recipients?.length) {
        for (const num of recipients) {
          await this.wa.sendTo(num, message);
        }
      } else {
        await this.wa.sendAlert(message);
      }
    } else {
      // Log to file when WhatsApp unavailable
      const config = this.configManager.getAll();
      const dataDir = config.dataDir || './data';
      const file = `${dataDir}/scheduled-messages.jsonl`;
      try {
        writeFileSync(file, JSON.stringify({
          message, recipients, timestamp: new Date().toISOString()
        }) + '\n', { flag: 'a' });
      } catch {}
    }
  }

  _parseIntervalMs(interval) {
    if (!interval || typeof interval !== 'string') return 0;
    const match = interval.match(/^(\d+(?:\.\d+)?)\s*(m|h|min|mins|hr|hrs|hour|hours|minute|minutes)$/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('h')) return val * 3600000;
    return val * 60000;
  }
}
