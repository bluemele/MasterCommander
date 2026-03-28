// ============================================================
// POLAR PERFORMANCE ENGINE
// ============================================================
// Loads boat polar diagram and provides:
// - Target speed at any TWS/TWA
// - VMG to any bearing
// - Optimal upwind/downwind angles
// - Performance percentage (actual vs polar)
//
// Foundation for all tactical sailing intelligence.
// ============================================================

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class PolarEngine {
  constructor(polarPath) {
    const path = polarPath || join(__dirname, 'polars', 'catana58.json');
    this.polar = JSON.parse(readFileSync(path, 'utf8'));
    this.tws = this.polar.tws;
    this.twa = this.polar.twa;
    this.speeds = this.polar.speeds;
    this.beatAngles = this.polar.beatAngle;
    this.runAngles = this.polar.runAngle;
    console.log(`  📊 Polar loaded: ${this.polar.name} (${this.tws.length} wind speeds, ${this.twa.length} angles)`);
  }

  // ── Bilinear interpolation of polar table ─────────────
  // Returns predicted boat speed (kts) for given TWS and TWA
  getTargetSpeed(tws, twa) {
    if (tws == null || twa == null) return null;
    tws = Math.abs(tws);
    twa = Math.abs(twa);
    // Clamp to polar bounds
    if (twa < this.twa[0]) twa = this.twa[0];
    if (twa > this.twa[this.twa.length - 1]) twa = this.twa[this.twa.length - 1];
    if (tws < this.tws[0]) return this._interpolateTWA(0, twa) * (tws / this.tws[0]);
    if (tws > this.tws[this.tws.length - 1]) tws = this.tws[this.tws.length - 1];

    // Find bounding TWS indices
    let twsLow = 0;
    for (let i = 0; i < this.tws.length - 1; i++) {
      if (this.tws[i] <= tws && this.tws[i + 1] >= tws) { twsLow = i; break; }
    }
    const twsHigh = Math.min(twsLow + 1, this.tws.length - 1);
    const twsFrac = twsLow === twsHigh ? 0 : (tws - this.tws[twsLow]) / (this.tws[twsHigh] - this.tws[twsLow]);

    // Interpolate at both TWS rows, then between them
    const speedLow = this._interpolateTWA(twsLow, twa);
    const speedHigh = this._interpolateTWA(twsHigh, twa);
    return Math.round((speedLow + (speedHigh - speedLow) * twsFrac) * 10) / 10;
  }

  // Interpolate within a single TWS row for given TWA
  _interpolateTWA(twsIndex, twa) {
    const row = this.speeds[twsIndex];
    if (twa <= this.twa[0]) return row[0];
    if (twa >= this.twa[this.twa.length - 1]) return row[row.length - 1];

    for (let i = 0; i < this.twa.length - 1; i++) {
      if (this.twa[i] <= twa && this.twa[i + 1] >= twa) {
        const frac = (twa - this.twa[i]) / (this.twa[i + 1] - this.twa[i]);
        return row[i] + (row[i + 1] - row[i]) * frac;
      }
    }
    return row[row.length - 1];
  }

  // ── VMG: velocity made good toward a bearing ──────────
  // bearingToWaypoint: degrees (true)
  // heading: degrees (true)
  // boatSpeed: knots
  // Returns VMG in knots (positive = making progress, negative = going away)
  getVMG(heading, bearingToWaypoint, boatSpeed) {
    if (heading == null || bearingToWaypoint == null || boatSpeed == null) return null;
    let angle = Math.abs(heading - bearingToWaypoint);
    if (angle > 180) angle = 360 - angle;
    return Math.round(boatSpeed * Math.cos(angle * Math.PI / 180) * 10) / 10;
  }

  // ── Optimal VMG angle for a given TWS and bearing ─────
  // Scans the polar to find the TWA that maximizes VMG to target bearing
  // Returns { twa, heading, speed, vmg }
  getOptimalTWA(tws, windDirectionTrue, bearingToWaypoint) {
    if (tws == null || windDirectionTrue == null || bearingToWaypoint == null) return null;

    let bestVMG = -Infinity;
    let bestResult = null;

    // Try both tacks (port and starboard)
    for (let twa = 30; twa <= 180; twa += 1) {
      const speed = this.getTargetSpeed(tws, twa);
      // On starboard tack: heading = windDir + TWA
      // On port tack: heading = windDir - TWA
      for (const sign of [1, -1]) {
        const heading = (windDirectionTrue + sign * twa + 360) % 360;
        const vmg = this.getVMG(heading, bearingToWaypoint, speed);
        if (vmg > bestVMG) {
          bestVMG = vmg;
          bestResult = {
            twa,
            heading: Math.round(heading),
            speed,
            vmg: Math.round(vmg * 10) / 10,
            tack: sign === 1 ? 'starboard' : 'port',
          };
        }
      }
    }
    return bestResult;
  }

  // ── Optimal beat (upwind) angle at given TWS ──────────
  getOptimalBeatAngle(tws) {
    if (tws == null) return null;
    return this._interpolateArray(this.tws, this.beatAngles, tws);
  }

  // ── Optimal run (downwind) angle at given TWS ─────────
  getOptimalRunAngle(tws) {
    if (tws == null) return null;
    return this._interpolateArray(this.tws, this.runAngles, tws);
  }

  // ── Performance percentage ────────────────────────────
  // How well are you sailing vs what the polar says you should do?
  getPerformance(tws, twa, actualSpeed) {
    if (tws == null || twa == null || actualSpeed == null) return null;
    const target = this.getTargetSpeed(tws, twa);
    if (!target || target === 0) return null;
    return Math.round((actualSpeed / target) * 100);
  }

  // ── Helper: interpolate a 1D array ────────────────────
  _interpolateArray(xArr, yArr, x) {
    if (x <= xArr[0]) return yArr[0];
    if (x >= xArr[xArr.length - 1]) return yArr[yArr.length - 1];
    for (let i = 0; i < xArr.length - 1; i++) {
      if (xArr[i] <= x && xArr[i + 1] >= x) {
        const frac = (x - xArr[i]) / (xArr[i + 1] - xArr[i]);
        return Math.round(yArr[i] + (yArr[i + 1] - yArr[i]) * frac);
      }
    }
    return yArr[yArr.length - 1];
  }
}
