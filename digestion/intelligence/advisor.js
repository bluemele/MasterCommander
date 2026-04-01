// ============================================================
// SAILING ADVISOR — The Brain
// ============================================================
// Coordinates all intelligence modules, manages the
// recommendation queue, and handles human decisions
// (accept/dismiss/explain).
//
// Each module runs independently on its own interval,
// producing recommendations that flow into a priority queue.
// Recommendations are deduped, expire automatically,
// and are tracked for history (accepted vs dismissed).
// ============================================================

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// Urgency levels (highest to lowest priority)
export const URGENCY = {
  critical:   4,  // Safety — act now
  advisory:   3,  // Conditions changing — act soon
  suggestion: 2,  // Optimization opportunity
  info:       1,  // Awareness only
};

export class SailingAdvisor extends EventEmitter {
  constructor({ signalkClient, weatherService, polarEngine, config } = {}) {
    super();
    this.sk = signalkClient;
    this.weather = weatherService;
    this.polar = polarEngine;
    this.config = config || {};

    this.modules = new Map();      // name → { module, interval, timer }
    this.recommendations = [];     // active recommendations
    this.history = [];             // past recommendations (last 200)
    this._running = false;

    // Dedup: don't repeat same recommendation type within this window
    const dedupMin = config?.intelligence?.dedupWindowMin ?? 15;
    this.dedupWindowMs = dedupMin * 60 * 1000;
  }

  // ── Register an intelligence module ───────────────────
  // module must implement: analyze() → Recommendation[] or null
  register(name, module, intervalSec = 30) {
    this.modules.set(name, { module, intervalMs: intervalSec * 1000, timer: null });
    console.log(`  🧠 Advisor: registered ${name} (${intervalSec}s interval)`);
  }

  // ── Start all modules ───────────────────────���─────────
  start() {
    if (this._running) return;
    this._running = true;
    for (const [name, entry] of this.modules) {
      entry.timer = setInterval(() => this._runModule(name), entry.intervalMs);
      // Run immediately on start
      setTimeout(() => this._runModule(name), 1000 + Math.random() * 2000);
    }
    // Expiry sweep every 30s
    this._expiryTimer = setInterval(() => this._expireStale(), 30000);
    console.log(`  🧠 Advisor: started (${this.modules.size} modules)`);
  }

  stop() {
    this._running = false;
    for (const entry of this.modules.values()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.timer = null;
    }
    if (this._expiryTimer) clearInterval(this._expiryTimer);
  }

  // ── Run a single module ───────────────────────────────
  async _runModule(name) {
    try {
      const entry = this.modules.get(name);
      if (!entry) return;
      const results = await entry.module.analyze();
      if (!results) return;
      const recs = Array.isArray(results) ? results : [results];
      for (const rec of recs) {
        this._addRecommendation(name, rec);
      }
    } catch (err) {
      // Module errors shouldn't crash the advisor
      console.error(`  🧠 Advisor: ${name} error:`, err.message);
    }
  }

  // ── Add recommendation to queue ───────────────────────
  _addRecommendation(moduleName, rec) {
    // Dedup: check if same type was recently recommended
    const dedupKey = `${moduleName}:${rec.type}`;
    const now = Date.now();
    const recent = this.recommendations.find(
      r => r._dedupKey === dedupKey && (now - r.createdAt) < this.dedupWindowMs
    );
    if (recent) {
      // Update existing recommendation instead of creating new one
      recent.title = rec.title;
      recent.reasoning = rec.reasoning;
      recent.action = rec.action;
      recent.alternatives = rec.alternatives;
      recent.impact = rec.impact;
      recent.urgency = rec.urgency;
      recent.updatedAt = now;
      this.emit('updated', recent);
      return;
    }

    const recommendation = {
      id: randomUUID().slice(0, 8),
      module: moduleName,
      type: rec.type,
      urgency: rec.urgency || 'suggestion',
      title: rec.title,
      reasoning: rec.reasoning,
      action: rec.action || null,
      alternatives: rec.alternatives || [],
      impact: rec.impact || null,
      expiresAt: rec.expiresAt || (now + 30 * 60 * 1000), // default 30min
      createdAt: now,
      updatedAt: now,
      status: 'active',
      _dedupKey: dedupKey,
    };

    this.recommendations.push(recommendation);
    this.emit('recommendation', recommendation);

    // Critical recommendations also emit a special event for WhatsApp
    if (rec.urgency === 'critical') {
      this.emit('critical', recommendation);
    }
  }

  // ── Get active recommendations sorted by urgency ──────
  getActive() {
    return this.recommendations
      .filter(r => r.status === 'active')
      .sort((a, b) => (URGENCY[b.urgency] || 0) - (URGENCY[a.urgency] || 0));
  }

  // ── User accepts a recommendation ─────────────────────
  accept(id) {
    const rec = this.recommendations.find(r => r.id === id);
    if (!rec || rec.status !== 'active') return null;
    rec.status = 'accepted';
    rec.resolvedAt = Date.now();
    this._archiveToHistory(rec);
    this.recommendations = this.recommendations.filter(r => r.id !== id);
    this.emit('accepted', rec);
    return rec;
  }

  // ── User dismisses a recommendation ───────────────────
  dismiss(id) {
    const rec = this.recommendations.find(r => r.id === id);
    if (!rec || rec.status !== 'active') return null;
    rec.status = 'dismissed';
    rec.resolvedAt = Date.now();
    this._archiveToHistory(rec);
    this.recommendations = this.recommendations.filter(r => r.id !== id);
    this.emit('dismissed', rec);
    return rec;
  }

  // ── Process an alert from the alert engine ─────────────
  // Converts system alerts into contextual advisor recommendations
  processAlert(alert) {
    const alertMap = {
      anchor_drag: {
        type: 'anchor_safety',
        urgency: 'critical',
        titleFn: (a) => 'Anchor dragging — take action',
        reasoningFn: (a) => `${a.message}. Start engines and re-anchor, or motor to hold position. Check rode for chafe.`,
        impact: 'Vessel may drift onto shore or into other boats.',
      },
      bilge: {
        type: 'bilge_safety',
        urgency: 'critical',
        titleFn: (a) => 'Bilge pump cycling — possible water ingress',
        reasoningFn: (a) => `${a.message}. Check thru-hulls, shaft seal, rudder post, and raw water strainer. Monitor battery draw — bilge pump increases load.`,
        impact: 'Sustained cycling can drain batteries. Find and stop the leak.',
      },
      shallow: {
        type: 'depth_safety',
        urgency: 'advisory',
        titleFn: (a) => 'Shallow water warning',
        reasoningFn: (a) => `${a.message}. Check chart for channel markers. Consider altering course to deeper water.`,
        impact: 'Risk of grounding.',
      },
    };

    // Match alert ID prefix (e.g., "batt_crit_house" → "batt_crit")
    const key = Object.keys(alertMap).find(k => alert.id && alert.id.startsWith(k));
    if (!key) return; // No advisor mapping for this alert type

    const mapping = alertMap[key];
    this._addRecommendation('safety', {
      type: mapping.type,
      urgency: mapping.urgency,
      title: mapping.titleFn(alert),
      reasoning: mapping.reasoningFn(alert),
      impact: mapping.impact,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
  }

  // ── Get deeper explanation (for "Why?" button) ────────
  explain(id) {
    const rec = this.recommendations.find(r => r.id === id);
    if (!rec) return null;
    // Return full context — the dashboard or LLM can use this
    return {
      ...rec,
      snapshot: this.sk ? this.sk.getSnapshot() : null,
    };
  }

  // ── Get recommendation history ────────────────────────
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  // ── Expire stale recommendations ──────────────────────
  _expireStale() {
    const now = Date.now();
    const expired = this.recommendations.filter(r => r.status === 'active' && r.expiresAt < now);
    for (const rec of expired) {
      rec.status = 'expired';
      rec.resolvedAt = now;
      this._archiveToHistory(rec);
    }
    this.recommendations = this.recommendations.filter(r => r.status === 'active');
  }

  // ── Archive to history (ring buffer, max 200) ─────────
  _archiveToHistory(rec) {
    this.history.push({
      id: rec.id,
      module: rec.module,
      type: rec.type,
      urgency: rec.urgency,
      title: rec.title,
      status: rec.status,
      createdAt: rec.createdAt,
      resolvedAt: rec.resolvedAt,
    });
    if (this.history.length > 200) this.history = this.history.slice(-200);
  }
}
