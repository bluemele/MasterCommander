// ============================================================
// CONFIG MANAGER — Centralized config with atomic saves
// ============================================================
// Reads/writes boat-config.json. Merges user config with
// DEFAULTS so old configs missing new sections still work.
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

const DEFAULTS = {
  rules: [
    { id: 'batt_critical', name: 'Battery Critical', enabled: true,
      trigger: 'batteries.*.soc', condition: { op: '<', value: 10 },
      severity: 'critical', cooldownMs: 300000,
      message: '🚨 BATTERY CRITICAL [{{id}}]: {{value}}% — SHED LOADS NOW' },
    { id: 'batt_low', name: 'Battery Low', enabled: true,
      trigger: 'batteries.*.soc', condition: { op: '<', value: 20 },
      severity: 'warning', cooldownMs: 600000,
      message: '⚠️ Battery low [{{id}}]: {{value}}%' },
    { id: 'eng_overheat', name: 'Engine Overheat', enabled: true,
      trigger: 'engines.*.coolantTemp', condition: { op: '>', value: 95 },
      severity: 'critical', cooldownMs: 60000,
      message: '🚨 ENGINE OVERHEAT [{{id}}]: Coolant {{value}}°C — check raw water intake & impeller!' },
    { id: 'eng_oil', name: 'Low Oil Pressure', enabled: true,
      trigger: 'engines.*.oilPressure', condition: { op: '<', value: 25 },
      severity: 'critical', cooldownMs: 60000,
      message: '🚨 LOW OIL PRESSURE [{{id}}]: {{value}} PSI — reduce power, check oil level!' },
    { id: 'eng_exhaust', name: 'High Exhaust Temp', enabled: true,
      trigger: 'engines.*.exhaustTemp', condition: { op: '>', value: 500 },
      severity: 'warning', cooldownMs: 120000,
      message: '⚠️ High exhaust temp [{{id}}]: {{value}}°C' },
    { id: 'shallow', name: 'Shallow Water', enabled: true,
      trigger: 'environment.depth', condition: { op: '<', value: 2.5 },
      severity: 'warning', cooldownMs: 60000,
      message: '⚠️ SHALLOW WATER: {{value}}m — proceed with caution' },
    { id: 'anchor_drag', name: 'Anchor Drag', enabled: true,
      trigger: 'navigation.anchor.distance', condition: { op: '>', value: 30 },
      severity: 'critical', cooldownMs: 120000, special: 'anchor_drag',
      message: '🚨 ANCHOR DRAG: {{value}}m from set point (limit {{threshold}}m) — CHECK ANCHOR' },
    { id: 'bilge_cycles', name: 'Bilge Pump Cycling', enabled: true,
      trigger: 'safety.bilgeCycles', condition: { op: '>', value: 6 },
      severity: 'critical', cooldownMs: 300000, special: 'bilge',
      params: { windowMinutes: 30 },
      message: '🚨 BILGE PUMP cycling: {{value}}× in {{window}} min — POSSIBLE LEAK, inspect bilge!' },
    { id: 'tank_fuel', name: 'Fuel Low', enabled: true,
      trigger: 'tanks.fuel.*.level', condition: { op: '<', value: 15 },
      severity: 'info', cooldownMs: 3600000,
      message: '⛽ Fuel low [{{id}}]: {{value}}%' },
    { id: 'tank_water', name: 'Fresh Water Low', enabled: true,
      trigger: 'tanks.freshWater.*.level', condition: { op: '<', value: 15 },
      severity: 'info', cooldownMs: 3600000,
      message: '💧 Fresh water low [{{id}}]: {{value}}%' },
  ],

  schedules: [],

  profiles: {
    presets: {
      captain: {
        name: 'Captain',
        alerts: ['critical', 'warning', 'info'],
        modules: ['tactical', 'weather', 'energy'],
        panels: ['advisor', 'nav', 'engines', 'batt', 'tanks', 'wind', 'perf', 'energy'],
      },
      owner: {
        name: 'Owner',
        alerts: ['critical', 'warning'],
        modules: ['energy', 'weather'],
        panels: ['advisor', 'batt', 'engines', 'tanks', 'energy'],
      },
      charter: {
        name: 'Charter Operator',
        alerts: ['critical'],
        modules: ['energy'],
        panels: ['batt', 'engines', 'tanks'],
      },
      surveyor: {
        name: 'Surveyor',
        alerts: ['critical', 'warning', 'info'],
        modules: ['tactical', 'weather', 'energy'],
        panels: ['advisor', 'nav', 'engines', 'batt', 'tanks', 'wind', 'perf', 'energy'],
      },
      crew: {
        name: 'Crew',
        alerts: ['critical', 'warning'],
        modules: ['tactical'],
        panels: ['nav', 'wind', 'engines'],
      },
    },
    active: null,
    custom: [],
  },

  templates: {
    alert: '{{severity}}: {{message}}',
    digest: '📊 Daily Report — {{boat.name}}\n🔋 Battery: {{battery.soc}}%\n⚙️ Engines: {{engine.status}}\n📍 Position: {{navigation.position}}\n💨 Wind: {{environment.windSpeed}}kts',
    maintenance: '🔧 Maintenance Due: {{task.name}} at {{value}} hours',
    watchHandoff: '⌚ Watch handoff at {{time}}\nCourse: {{navigation.heading}}° | SOG: {{navigation.sog}}kts | Wind: {{environment.windSpeed}}kts',
  },

  intelligence: {
    intervals: { tactical: 30, weather: 60, energy: 30 },
    dedupWindowMin: 15,
  },
};

const VALID_SECTIONS = ['rules', 'schedules', 'profiles', 'templates', 'intelligence',
  'boat', 'signalk', 'engines', 'batteries', 'tanks', 'safety', 'whatsapp', 'llm', 'alerts'];

const VALID_OPS = ['<', '>', '<=', '>=', '==', '!='];
const VALID_SEVERITIES = ['critical', 'warning', 'info'];

export class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = {};
    this.load();
  }

  load() {
    if (existsSync(this.configPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.configPath, 'utf8'));
        // Deep merge defaults for new sections only (don't overwrite user values)
        this.config = raw;
        for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
          if (!(key in this.config)) {
            this.config[key] = JSON.parse(JSON.stringify(defaultVal));
          }
        }
      } catch (err) {
        console.error(`[config-manager] Failed to parse ${this.configPath}: ${err.message}`);
        // Try to load backup if available
        const backupPath = this.configPath + '.bak';
        if (existsSync(backupPath)) {
          try {
            console.log(`[config-manager] Attempting recovery from ${backupPath}`);
            this.config = JSON.parse(readFileSync(backupPath, 'utf8'));
            for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
              if (!(key in this.config)) {
                this.config[key] = JSON.parse(JSON.stringify(defaultVal));
              }
            }
            console.log('[config-manager] Recovered from backup');
            return this.config;
          } catch (backupErr) {
            console.error(`[config-manager] Backup also corrupt: ${backupErr.message}`);
          }
        }
        console.warn('[config-manager] Falling back to defaults');
        this.config = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } else {
      this.config = JSON.parse(JSON.stringify(DEFAULTS));
    }
    return this.config;
  }

  save() {
    try {
      // Create backup of current config before overwriting
      if (existsSync(this.configPath)) {
        try {
          const current = readFileSync(this.configPath, 'utf8');
          writeFileSync(this.configPath + '.bak', current);
        } catch {}
      }
      const tmp = this.configPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.config, null, 2));
      renameSync(tmp, this.configPath);
    } catch (err) {
      console.error(`[config-manager] Failed to save config: ${err.message}`);
      throw new Error(`Config save failed: ${err.message}`);
    }
  }

  get(section) {
    if (section in DEFAULTS && !(section in this.config)) {
      return JSON.parse(JSON.stringify(DEFAULTS[section]));
    }
    return this.config[section];
  }

  update(section, data) {
    if (!VALID_SECTIONS.includes(section)) {
      throw new Error(`Invalid config section: ${section}`);
    }
    this.config[section] = data;
    this.save();
    return this.config[section];
  }

  getAll() {
    return this.config;
  }

  // ── Validation ────────────────────────────────────────────

  validateRule(rule) {
    const errors = [];
    if (!rule.id || typeof rule.id !== 'string') errors.push('id is required (string)');
    if (!rule.trigger || typeof rule.trigger !== 'string') errors.push('trigger is required (string)');
    if (!rule.condition?.op || !VALID_OPS.includes(rule.condition.op)) errors.push(`condition.op must be one of: ${VALID_OPS.join(', ')}`);
    if (rule.condition?.value == null || typeof rule.condition.value !== 'number') errors.push('condition.value is required (number)');
    if (!rule.severity || !VALID_SEVERITIES.includes(rule.severity)) errors.push(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`);
    if (rule.cooldownMs != null && (typeof rule.cooldownMs !== 'number' || rule.cooldownMs < 0)) errors.push('cooldownMs must be a positive number');
    return errors;
  }

  validateSchedule(sched) {
    const errors = [];
    if (!sched.id || typeof sched.id !== 'string') errors.push('id is required (string)');
    if (!['interval', 'daily', 'weekly'].includes(sched.type)) errors.push('type must be interval, daily, or weekly');
    if (sched.type === 'daily' && !/^\d{2}:\d{2}$/.test(sched.time)) errors.push('time must be HH:MM for daily schedules');
    if (sched.type === 'weekly') {
      if (!/^\d{2}:\d{2}$/.test(sched.time)) errors.push('time must be HH:MM for weekly schedules');
      const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      if (!validDays.includes(sched.day?.toLowerCase())) errors.push('day must be a valid weekday name');
    }
    if (sched.type === 'interval' && (!sched.interval || typeof sched.interval !== 'string')) errors.push('interval is required (e.g. "30m", "2h", "250h")');
    if (!sched.action || typeof sched.action !== 'string') errors.push('action is required');
    return errors;
  }

  generateId() {
    return randomUUID().slice(0, 8);
  }
}
