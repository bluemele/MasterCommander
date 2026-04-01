// ============================================================
// TEMPLATE ENGINE — Simple {{var.path}} replacement
// ============================================================

export class TemplateEngine {
  constructor(configManager) {
    this.configManager = configManager;
  }

  render(templateKey, context) {
    const templates = this.configManager.get('templates') || {};
    const tpl = templates[templateKey];
    if (!tpl) return '';
    return this.renderString(tpl, context);
  }

  renderString(str, context) {
    return str.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const val = this._resolve(context, path.trim());
      return val != null ? String(val) : match;
    });
  }

  _resolve(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }

  buildContext(sk, config) {
    const snapshot = sk.connected ? sk.getSnapshot() : {};
    const pos = sk.connected ? sk.getPosition() : null;
    const batt = sk.discovered?.batteries?.[0] ? sk.getBattery(sk.discovered.batteries[0]) : {};
    const engines = {};
    for (const id of (sk.discovered?.engines || [])) {
      const e = sk.getEngine(id);
      engines[id] = e;
    }
    const anyRunning = Object.values(engines).some(e => e.running);

    return {
      boat: { name: config.boat?.name || 'Unknown' },
      battery: { soc: batt.soc, voltage: batt.voltage, current: batt.current },
      engine: { status: anyRunning ? 'running' : 'stopped', ...engines },
      navigation: {
        sog: sk.connected ? sk.get('navigation.speedOverGround') : null,
        heading: sk.connected ? sk.get('navigation.headingTrue') : null,
        position: pos ? `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}` : 'unknown',
      },
      environment: {
        windSpeed: sk.connected ? sk.get('environment.wind.speedApparent') : null,
        depth: sk.connected ? (sk.get('environment.depth.belowTransducer') ?? sk.get('environment.depth.belowKeel')) : null,
      },
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      date: new Date().toISOString().split('T')[0],
    };
  }
}
