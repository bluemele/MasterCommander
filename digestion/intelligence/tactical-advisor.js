// ============================================================
// TACTICAL ADVISOR — Course optimization intelligence
// ============================================================
// Analyzes current sailing conditions against boat polars
// and destination to recommend optimal course changes.
//
// Generates: TWA optimization, tack/gybe timing, current
// compensation, wave comfort angle, lee shore awareness.
// ============================================================

export class TacticalAdvisor {
  constructor({ signalkClient, polarEngine, config } = {}) {
    this.sk = signalkClient;
    this.polar = polarEngine;
    this.config = config || {};
    // Destination (set externally when route is active)
    this.destination = null; // { lat, lon, name }
    this.windDirection = null; // true wind direction (degrees, where wind is FROM)
    this.waveDirection = null; // wave direction (degrees, where waves come FROM)
  }

  setDestination(dest) { this.destination = dest; }
  setWaveDirection(deg) { this.waveDirection = deg; }

  analyze() {
    const snap = this.sk?.getSnapshot();
    if (!snap || !snap._meta?.connected) return null;

    const results = [];

    // Get current conditions
    const tws = snap.environment?.windSpeedTrue;
    const twa = snap.environment?.windAngleTrue;
    const sog = snap.navigation?.sog;
    const heading = snap.navigation?.heading;
    const cog = snap.navigation?.cog;

    if (tws == null || twa == null || sog == null) return null;

    // 1. Performance check
    const perfRec = this._checkPerformance(tws, twa, sog);
    if (perfRec) results.push(perfRec);

    // 2. Course optimization (if destination set)
    if (this.destination && heading != null) {
      const courseRec = this._checkCourseOptimization(tws, twa, heading, sog);
      if (courseRec) results.push(courseRec);
    }

    // 3. Current compensation
    if (heading != null && cog != null) {
      const currentRec = this._checkCurrentSet(heading, cog, sog);
      if (currentRec) results.push(currentRec);
    }

    // 4. Wave comfort
    if (heading != null && this.waveDirection != null) {
      const waveRec = this._checkWaveComfort(heading);
      if (waveRec) results.push(waveRec);
    }

    return results.length > 0 ? results : null;
  }

  // ── Performance: are you sailing well vs polar? ───────
  _checkPerformance(tws, twa, sog) {
    const perf = this.polar.getPerformance(tws, twa, sog);
    if (perf == null) return null;
    const targetSpeed = this.polar.getTargetSpeed(tws, twa);

    // Only recommend if significantly underperforming
    if (perf < 70 && sog > 1) {
      return {
        type: 'performance_low',
        urgency: 'suggestion',
        title: `Sailing at ${perf}% of polar — ${targetSpeed}kts possible`,
        reasoning: `At ${tws}kts TWS and ${twa}° TWA, your polar predicts ${targetSpeed}kts but you're doing ${sog}kts. Check sail trim, reef state, or fouling.`,
        impact: `${(targetSpeed - sog).toFixed(1)}kts potential speed gain`,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Course optimization: better TWA for VMG? ──────────
  _checkCourseOptimization(tws, twa, heading, sog) {
    if (!this.destination) return null;

    const pos = this.sk.getPosition();
    if (!pos) return null;

    // Calculate bearing to destination
    const bearingToDest = this._bearing(pos.lat, pos.lon, this.destination.lat, this.destination.lon);

    // Get wind direction from heading + TWA
    // windDir = heading + TWA (where wind is FROM, relative to north)
    const windDir = (heading + twa + 360) % 360;
    this.windDirection = windDir;

    // Current VMG
    const currentVMG = this.polar.getVMG(heading, bearingToDest, sog);

    // Optimal VMG
    const optimal = this.polar.getOptimalTWA(tws, windDir, bearingToDest);
    if (!optimal) return null;

    const vmgImprovement = optimal.vmg - currentVMG;
    const vmgImprovementPct = currentVMG > 0 ? Math.round((vmgImprovement / currentVMG) * 100) : 0;

    // Only recommend if improvement > 5%
    if (vmgImprovementPct > 5 && vmgImprovement > 0.3) {
      const magVar = this.sk.get('navigation.magneticVariation') || 0;
      const suggestedMagnetic = (optimal.heading - magVar + 360) % 360;

      return {
        type: 'course_optimization',
        urgency: vmgImprovementPct > 15 ? 'advisory' : 'suggestion',
        title: `Fall off to ${optimal.twa}° TWA for ${vmgImprovementPct}% better VMG`,
        reasoning: `Current TWA ${twa}° gives ${sog}kts / ${currentVMG}kts VMG. At TWA ${optimal.twa}° (${optimal.tack} tack), polar speed is ${optimal.speed}kts / ${optimal.vmg}kts VMG.`,
        action: {
          suggestedHeading: Math.round(suggestedMagnetic),
          suggestedTWA: optimal.twa,
          tack: optimal.tack,
        },
        impact: `VMG improves ${currentVMG} → ${optimal.vmg}kts. Heading ${Math.round(heading)}° → ${Math.round(suggestedMagnetic)}°M.`,
        alternatives: this._getAlternatives(tws, windDir, bearingToDest, magVar),
        expiresAt: Date.now() + 15 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Current set: COG ≠ heading ────────────────────────
  _checkCurrentSet(heading, cog, sog) {
    let drift = cog - heading;
    // Normalize to [-180, 180]
    while (drift > 180) drift -= 360;
    while (drift < -180) drift += 360;

    if (Math.abs(drift) > 5 && sog > 1) {
      const dir = drift > 0 ? 'starboard' : 'port';
      const compensation = Math.round(-drift);

      return {
        type: 'current_compensation',
        urgency: Math.abs(drift) > 15 ? 'advisory' : 'suggestion',
        title: `Current setting you ${Math.abs(Math.round(drift))}° to ${dir}`,
        reasoning: `Heading ${Math.round(heading)}° but COG ${Math.round(cog)}°. Current or leeway is pushing you ${Math.abs(Math.round(drift))}° ${dir}. Adjust heading ${Math.abs(compensation)}° to ${compensation > 0 ? 'starboard' : 'port'} to compensate.`,
        action: {
          suggestedHeading: Math.round((heading + compensation + 360) % 360),
          driftAngle: Math.round(drift),
        },
        impact: `Corrects ${Math.abs(Math.round(drift))}° of set. Without correction, you'll miss your track by ~${(Math.abs(drift) * sog * 0.03).toFixed(1)}nm per hour.`,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Wave comfort optimization ─────────────────────────
  _checkWaveComfort(heading) {
    if (this.waveDirection == null) return null;

    // Wave angle relative to heading (0° = head on, 90° = beam, 180° = stern)
    let relWave = this.waveDirection - heading;
    while (relWave < 0) relWave += 360;
    while (relWave > 360) relWave -= 360;
    if (relWave > 180) relWave = 360 - relWave;

    // Worst: 75-105° (beam) — worst rolling
    // Best: 140-170° (quarter) — comfortable
    if (relWave >= 75 && relWave <= 105) {
      // Waves on the beam — bad
      const adjustNeeded = relWave < 90 ? (90 - relWave + 40) : (relWave - 90 + 40);
      return {
        type: 'wave_comfort',
        urgency: 'suggestion',
        title: `Waves on the beam (${Math.round(relWave)}° relative) — poor motion`,
        reasoning: `Waves from ${Math.round(this.waveDirection)}° hitting at ${Math.round(relWave)}° relative (beam). Best comfort is waves 140-170° relative (on the quarter). Bearing off ${Math.round(adjustNeeded)}° would significantly improve motion.`,
        action: { waveAngle: Math.round(relWave), suggestedAdjustment: Math.round(adjustNeeded) },
        impact: 'Significantly reduced rolling. Better comfort below decks.',
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
    }
    return null;
  }

  // ── Generate alternative course options ───────────────
  _getAlternatives(tws, windDir, bearingToDest, magVar) {
    const alts = [];
    // Try a few different TWAs and show their VMG
    for (const testTwa of [60, 90, 120, 150]) {
      for (const sign of [1, -1]) {
        const h = (windDir + sign * testTwa + 360) % 360;
        const speed = this.polar.getTargetSpeed(tws, testTwa);
        const vmg = this.polar.getVMG(h, bearingToDest, speed);
        if (vmg > 0) {
          alts.push({
            twa: testTwa,
            heading: Math.round((h - magVar + 360) % 360),
            speed,
            vmg: Math.round(vmg * 10) / 10,
            note: testTwa < 70 ? 'Close hauled' : testTwa < 100 ? 'Beam reach' : testTwa < 140 ? 'Broad reach' : 'Run',
          });
        }
      }
    }
    return alts.sort((a, b) => b.vmg - a.vmg).slice(0, 3);
  }

  // ── Bearing calculation ───────────────────────────────
  _bearing(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
}
