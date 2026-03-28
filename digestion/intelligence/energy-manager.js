// ============================================================
// ENERGY MANAGER — Battery, solar, generator intelligence
// ============================================================
// Projects battery state forward in time, estimates solar
// yield based on time of day and weather, and recommends
// optimal generator scheduling.
// ============================================================

export class EnergyManager {
  constructor({ signalkClient, config } = {}) {
    this.sk = signalkClient;
    this.config = config || {};

    // Rolling current draw history (amps, one per analysis cycle)
    this.drawHistory = [];
    this.maxDrawHistory = 60; // ~30 minutes at 30s interval

    // Battery config
    this.batteryCapacityAh = config?.batteryCapacityAh || 1700;
    this.nominalVoltage = config?.nominalVoltage || 24;
    this.socWarning = config?.socWarning || 20; // percent
    this.socCritical = config?.socCritical || 10;
  }

  analyze() {
    const snap = this.sk?.getSnapshot();
    if (!snap || !snap._meta?.connected) return null;

    const results = [];

    // Get house battery data
    const house = snap.batteries?.house;
    if (!house) return null;

    const soc = house.soc;     // percent
    const current = house.current; // amps (negative = discharging)
    const solarPower = snap.electrical?.solar?.power || 0;

    if (soc == null || current == null) return null;

    // Record draw
    this.drawHistory.push({ current, soc, solar: solarPower, time: Date.now() });
    if (this.drawHistory.length > this.maxDrawHistory) this.drawHistory.shift();

    // 1. Battery projection
    const projRec = this._projectBattery(soc, current, solarPower);
    if (projRec) results.push(projRec);

    // 2. Unusual draw spike
    const spikeRec = this._detectDrawSpike(current);
    if (spikeRec) results.push(spikeRec);

    // 3. Generator recommendation
    const genRec = this._recommendGenerator(soc, current, solarPower);
    if (genRec) results.push(genRec);

    return results.length > 0 ? results : null;
  }

  // ── Project battery forward ───────────────────────────
  _projectBattery(soc, current, solarPower) {
    if (current >= 0) return null; // Charging — no worry

    // Average draw over recent history
    const recentDraw = this.drawHistory.slice(-10);
    const avgDraw = recentDraw.reduce((s, d) => s + d.current, 0) / recentDraw.length;
    if (avgDraw >= 0) return null; // net positive

    // Time to warning threshold
    const ahRemaining = ((soc - this.socWarning) / 100) * this.batteryCapacityAh;
    if (ahRemaining <= 0) return null; // already below warning
    const hoursToWarning = ahRemaining / Math.abs(avgDraw);

    // Time to critical
    const ahToCritical = ((soc - this.socCritical) / 100) * this.batteryCapacityAh;
    const hoursToCritical = ahToCritical > 0 ? ahToCritical / Math.abs(avgDraw) : 0;

    // Solar estimate
    const hour = new Date().getHours();
    const hoursOfDaylightRemaining = hour < 18 ? Math.max(0, 18 - hour) : 0;
    const estimatedSolarYieldWh = hoursOfDaylightRemaining > 0
      ? solarPower * 0.6 * hoursOfDaylightRemaining // 60% efficiency assumption
      : 0;
    const estimatedSolarAh = estimatedSolarYieldWh / this.nominalVoltage;

    // Will solar save us?
    const netAhNeeded = Math.abs(avgDraw) * hoursToWarning - estimatedSolarAh;
    const solarSufficient = netAhNeeded <= 0;

    // Format time
    const warningTime = new Date(Date.now() + hoursToWarning * 3600000);
    const timeStr = warningTime.toTimeString().slice(0, 5);

    if (hoursToWarning < 8) {
      return {
        type: 'battery_projection',
        urgency: hoursToWarning < 3 ? 'advisory' : 'suggestion',
        title: `Battery hits ${this.socWarning}% at ${timeStr} (${hoursToWarning.toFixed(1)}hrs)`,
        reasoning: `House bank at ${soc}%, drawing ${Math.abs(avgDraw).toFixed(1)}A (${Math.abs(Math.round(avgDraw * this.nominalVoltage))}W). ${solarPower > 10 ? `Solar producing ${Math.round(solarPower)}W but ` : ''}net drain ${Math.abs(Math.round(avgDraw * this.nominalVoltage - solarPower))}W.${!solarSufficient ? ' Solar won\'t be enough.' : ' Solar should cover it.'}`,
        action: {
          hoursToWarning: Math.round(hoursToWarning * 10) / 10,
          hoursToCritical: Math.round(hoursToCritical * 10) / 10,
          avgDrawAmps: Math.round(Math.abs(avgDraw) * 10) / 10,
          solarWatts: Math.round(solarPower),
          solarSufficient,
        },
        impact: solarSufficient
          ? 'Solar should maintain charge through today.'
          : `Generator needed. ${Math.round(netAhNeeded / 50)}hr at 50A charge rate to cover deficit.`,
        expiresAt: Date.now() + 30 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Detect unusual draw spikes ────────────────────────
  _detectDrawSpike(current) {
    if (this.drawHistory.length < 5) return null;

    const baseline = this.drawHistory.slice(-10, -1);
    const avgBaseline = baseline.reduce((s, d) => s + d.current, 0) / baseline.length;

    // Spike = current draw more than doubled suddenly
    if (current < avgBaseline * 2 && Math.abs(current - avgBaseline) > 5) {
      return {
        type: 'draw_spike',
        urgency: 'info',
        title: `Draw jumped: ${Math.abs(Math.round(avgBaseline))}A → ${Math.abs(Math.round(current))}A`,
        reasoning: `Current draw increased by ${Math.abs(Math.round(current - avgBaseline))}A. Check if watermaker, AC, or other large load was turned on.`,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Generator scheduling recommendation ───────────────
  _recommendGenerator(soc, current, solarPower) {
    if (current >= 0) return null; // already charging

    const hour = new Date().getHours();
    const isEvening = hour >= 17 && hour <= 20;
    const isNight = hour >= 21 || hour < 6;
    const solarAvailable = hour >= 6 && hour <= 17;

    // Low SOC + no solar + draining = generator time
    if (soc < 40 && !solarAvailable) {
      const chargeHoursNeeded = Math.ceil(((80 - soc) / 100 * this.batteryCapacityAh) / 50); // 50A charge rate

      return {
        type: 'generator_schedule',
        urgency: soc < 25 ? 'advisory' : 'suggestion',
        title: `Run generator ${chargeHoursNeeded}hr to reach 80% SOC`,
        reasoning: `Battery at ${soc}%, drawing ${Math.abs(Math.round(current))}A. No solar until dawn (~0615). Running generator at 50A charge for ${chargeHoursNeeded} hours brings bank to ~80%.`,
        action: {
          recommendedDuration: chargeHoursNeeded,
          targetSOC: 80,
          chargeRate: 50,
        },
        impact: isEvening
          ? 'Run now before quiet hours. Neighbors will appreciate it.'
          : 'Generator noise is less of a concern at night offshore.',
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    }

    // Daytime but solar not keeping up
    if (soc < 50 && solarAvailable && solarPower < Math.abs(current * this.nominalVoltage) * 0.5) {
      return {
        type: 'generator_supplement',
        urgency: 'suggestion',
        title: `Solar insufficient — generator would help`,
        reasoning: `Solar at ${Math.round(solarPower)}W but draw is ${Math.abs(Math.round(current * this.nominalVoltage))}W. Solar covers only ${Math.round(solarPower / Math.abs(current * this.nominalVoltage) * 100)}% of demand. Bank at ${soc}%.`,
        impact: '1 hour of generator would add ~50Ah and take pressure off the bank.',
        expiresAt: Date.now() + 30 * 60 * 1000,
      };
    }

    return null;
  }

  // ── Get current energy summary (for dashboard) ────────
  getSummary() {
    const snap = this.sk?.getSnapshot();
    if (!snap) return null;

    const house = snap.batteries?.house;
    if (!house) return null;

    const avgDraw = this.drawHistory.length > 5
      ? this.drawHistory.slice(-10).reduce((s, d) => s + d.current, 0) / Math.min(10, this.drawHistory.length)
      : house.current;

    const solarPower = snap.electrical?.solar?.power || 0;
    const netPower = Math.round((avgDraw || 0) * this.nominalVoltage + solarPower);

    return {
      soc: house.soc,
      voltage: house.voltage,
      current: house.current,
      avgDraw: Math.round(Math.abs(avgDraw || 0) * 10) / 10,
      solarWatts: Math.round(solarPower),
      netWatts: netPower,
      charging: (house.current || 0) > 0,
    };
  }
}
