// ============================================================
// STATUS BUILDER — Adaptive WhatsApp-formatted boat reports
// ============================================================
// Builds reports from whatever sensors exist. A monohull with
// one engine gets a different report than a catamaran with two.
// A boat with no wind instruments skips the wind section.
// ============================================================

import { haversineM } from './signalk-client.js';

export class StatusBuilder {
  constructor(sk, config = {}) {
    this.sk = sk;
    this.boatName = config.boat?.name || 'My Boat';
    this.boatType = config.boat?.type || '';
  }

  // ── Full status report ─────────────────────────────────
  status() {
    const sk = this.sk;
    const pos = sk.getPosition();
    const sog = sk.get('navigation.speedOverGround');
    const heading = sk.get('navigation.headingMagnetic') ?? sk.get('navigation.headingTrue');
    const anyEngineRunning = sk.discovered.engines.some(id => sk.getEngine(id).running);
    const mode = sog > 1 ? (anyEngineRunning ? 'Motoring' : 'Sailing') : 'Stationary';

    let s = `⚓ *${this.boatName.toUpperCase()}*\n`;
    if (pos) s += `📍 ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}\n`;
    s += `🧭 ${mode}`;
    if (heading != null) s += ` | HDG ${heading}°`;
    if (sog != null) s += ` | SOG ${sog} kts`;
    s += '\n';

    // Environment
    const depth = sk.get('environment.depth.belowTransducer') ?? sk.get('environment.depth.belowKeel');
    const waterT = sk.get('environment.water.temperature');
    if (depth != null || waterT != null) {
      s += '\n';
      if (depth != null) s += `🌊 Depth: ${depth}m`;
      if (waterT != null) s += `${depth != null ? ' | ' : ''}Water: ${waterT}°C`;
      s += '\n';
    }

    if (sk.discovered.hasWind) {
      const ws = sk.get('environment.wind.speedApparent');
      const wa = sk.get('environment.wind.angleApparent');
      if (ws != null) s += `💨 Wind: ${ws} kts${wa != null ? ` @ ${wa}°` : ''} apparent\n`;
    }

    // Engines
    if (sk.discovered.engines.length > 0) {
      s += '\n';
      if (anyEngineRunning) {
        s += `⚙️ *ENGINES*\n`;
        for (const id of sk.discovered.engines) {
          const e = sk.getEngine(id);
          if (!e.running) { s += `  ${id}: OFF\n`; continue; }
          s += `  ${id}: ${e.rpm} RPM`;
          if (e.oilPressure != null) s += ` | Oil ${e.oilPressure} PSI`;
          if (e.coolantTemp != null) s += ` | ${e.coolantTemp}°C`;
          if (e.fuelRate != null) s += ` | ${e.fuelRate} L/hr`;
          s += '\n';
        }
      } else {
        const hrs = sk.discovered.engines.map(id => {
          const e = sk.getEngine(id);
          return e.hours != null ? `${id}: ${e.hours} hrs` : null;
        }).filter(Boolean).join(' | ');
        s += `⚙️ Engines OFF${hrs ? ` (${hrs})` : ''}\n`;
      }
    }

    // Batteries
    if (sk.discovered.batteries.length > 0) {
      s += '\n';
      for (const id of sk.discovered.batteries) {
        const b = sk.getBattery(id);
        const dir = b.current != null ? (b.current > 0 ? '⚡' : '🔻') : '';
        s += `🔋 ${id}: `;
        if (b.soc != null) s += `${b.soc}% | `;
        if (b.voltage != null) s += `${b.voltage}V`;
        if (b.current != null) s += ` | ${dir} ${Math.abs(b.current)}A`;
        s += '\n';
      }
      if (sk.discovered.hasSolar) {
        const sp = sk.get('electrical.solar.power');
        if (sp != null && sp > 10) s += `☀️ Solar: ${sp}W\n`;
      }
      if (sk.discovered.hasGenerator) {
        const gv = sk.get('electrical.ac.generator.voltage');
        s += `🔌 Generator: ${gv && gv > 50 ? 'Running' : 'Off'}\n`;
      }
      if (sk.discovered.hasShore) {
        const sv = sk.get('electrical.ac.shore.voltage');
        if (sv && sv > 50) s += `🔌 Shore power: Connected\n`;
      }
    }

    // Tanks
    const tankLines = [];
    for (const [type, ids] of Object.entries(sk.discovered.tanks)) {
      for (const id of ids) {
        const t = sk.getTank(type, id);
        if (t.level == null) continue;
        const emoji = type === 'fuel' ? '⛽' : type === 'freshWater' ? '💧' : '🚽';
        const label = type === 'fuel' ? 'Fuel' : type === 'freshWater' ? 'Water' : 'Holding';
        tankLines.push(`${emoji} ${label} [${id}]: ${t.level}%`);
      }
    }
    if (tankLines.length > 0) {
      s += '\n' + tankLines.join('\n') + '\n';
    }

    // Anchor
    if (sk.discovered.hasAnchor) {
      const anchorPos = sk.raw['navigation.anchor.position'];
      const boatPos = sk.getPosition();
      if (anchorPos && boatPos) {
        const drift = Math.round(haversineM(boatPos.lat, boatPos.lon, anchorPos.latitude, anchorPos.longitude));
        const radius = sk.raw['navigation.anchor.maxRadius'] ?? '?';
        s += `\n⚓ Anchor: ${drift}m / ${radius}m limit\n`;
      }
    }

    s += `\n_${new Date().toLocaleTimeString()}_`;
    return s;
  }

  // ── Engine detail report ───────────────────────────────
  engines() {
    const sk = this.sk;
    if (sk.discovered.engines.length === 0) return '⚙️ No engines detected on SignalK';

    let s = `⚙️ *ENGINE REPORT*\n`;
    for (const id of sk.discovered.engines) {
      const e = sk.getEngine(id);
      s += `\n*${id.toUpperCase()}*${e.running ? '' : ' (off)'}\n`;
      if (e.rpm != null) s += `  RPM: ${e.rpm}\n`;
      if (e.oilPressure != null) s += `  Oil: ${e.oilPressure} PSI\n`;
      if (e.coolantTemp != null) s += `  Coolant: ${e.coolantTemp}°C\n`;
      if (e.exhaustTemp != null) s += `  Exhaust: ${e.exhaustTemp}°C\n`;
      if (e.fuelRate != null) s += `  Fuel: ${e.fuelRate} L/hr\n`;
      if (e.hours != null) s += `  Hours: ${e.hours}\n`;
    }
    return s;
  }

  // ── Electrical detail report ───────────────────────────
  battery() {
    const sk = this.sk;
    if (sk.discovered.batteries.length === 0) return '🔋 No batteries detected on SignalK';

    let s = `🔋 *ELECTRICAL REPORT*\n`;
    for (const id of sk.discovered.batteries) {
      const b = sk.getBattery(id);
      s += `\n*${id.toUpperCase()}*\n`;
      if (b.soc != null) s += `  SOC: ${b.soc}%\n`;
      if (b.voltage != null) s += `  Voltage: ${b.voltage}V\n`;
      if (b.current != null) {
        const dir = b.current > 0 ? 'Charging' : 'Discharging';
        s += `  Current: ${b.current > 0 ? '+' : ''}${b.current}A (${dir})\n`;
        if (b.voltage) s += `  Power: ${Math.round(b.voltage * b.current)}W\n`;
      }
    }
    if (sk.discovered.hasSolar) {
      const sp = sk.get('electrical.solar.power');
      if (sp != null) s += `\n☀️ Solar: ${sp}W\n`;
    }
    if (sk.discovered.hasGenerator) {
      const gv = sk.get('electrical.ac.generator.voltage');
      s += `🔌 Generator: ${gv && gv > 50 ? 'Running' : 'Off'}\n`;
    }
    if (sk.discovered.hasShore) {
      const sv = sk.get('electrical.ac.shore.voltage');
      s += `🔌 Shore: ${sv && sv > 50 ? 'Connected' : 'Disconnected'}\n`;
    }
    return s;
  }

  // ── Position with map link ─────────────────────────────
  position() {
    const pos = this.sk.getPosition();
    if (!pos) return '📍 No GPS position available';
    const sog = this.sk.get('navigation.speedOverGround');
    const cog = this.sk.get('navigation.courseOverGroundTrue');
    let s = `📍 ${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}`;
    if (sog != null) s += `\nSOG: ${sog} kts`;
    if (cog != null) s += ` | COG: ${cog}°`;
    s += `\nhttps://www.google.com/maps?q=${pos.lat},${pos.lon}`;
    return s;
  }

  // ── Tanks ──────────────────────────────────────────────
  tanks() {
    const sk = this.sk;
    const lines = [];
    for (const [type, ids] of Object.entries(sk.discovered.tanks)) {
      for (const id of ids) {
        const t = sk.getTank(type, id);
        if (t.level == null) continue;
        const emoji = type === 'fuel' ? '⛽' : type === 'freshWater' ? '💧' : '🚽';
        const label = type === 'fuel' ? 'Fuel' : type === 'freshWater' ? 'Water' : 'Holding';
        lines.push(`${emoji} ${label} [${id}]: ${t.level}%`);
      }
    }
    return lines.length > 0 ? lines.join('\n') : 'No tank sensors detected on SignalK';
  }

  // ── Help ───────────────────────────────────────────────
  help() {
    return `⚓ *COMMANDER*\n
*status* — Full overview
*engines* — Engine details
*battery* — Electrical report
*position* — GPS + map link
*tanks* — Tank levels
*wind* — Wind & conditions
*anchor* — Anchor watch
*help* — This message

Or just ask in plain English:
"How is my boat doing?"
"Should I worry about the battery?"
"What's the engine situation?"`;
  }
}
