// ============================================================
// WEATHER INTELLIGENCE — Forecast-driven sailing decisions
// ============================================================
// Monitors barometric pressure trends, correlates with weather
// forecasts, and recommends: reef/unreef timing, wind shift
// preparation, squall warnings, and weather windows.
// ============================================================

export class WeatherIntelligence {
  constructor({ signalkClient, weatherService, config } = {}) {
    this.sk = signalkClient;
    this.weather = weatherService;
    this.config = config || {};

    // Rolling barometric pressure history (hPa, one per minute)
    this.baroHistory = [];
    this.maxBaroHistory = 360; // 6 hours at 1/min

    // Wind history for shift detection
    this.windHistory = [];
    this.maxWindHistory = 30; // 30 entries (every 30s analysis = 15 min)

    // Reef state tracking
    this.lastReefRecommendation = 0;
    this.reefCooldownMs = 15 * 60 * 1000; // Don't nag about reef more than every 15 min

    // Cached forecast
    this._forecastCache = null;
    this._forecastFetchedAt = 0;
    this._forecastTtl = 30 * 60 * 1000; // 30 min

    // TimesFM sensor forecast cache
    this._sensorForecastCache = null;
    this._sensorForecastAt = 0;
    this._sensorForecastTtl = 15 * 60 * 1000; // 15 min (sensor data refreshes faster)
  }

  async analyze() {
    const snap = this.sk?.getSnapshot();
    if (!snap || !snap._meta?.connected) return null;

    const results = [];

    // Record current barometric pressure
    const baroPressure = snap.environment?.baroPressure;
    if (baroPressure != null) {
      this.baroHistory.push({ value: baroPressure, time: Date.now() });
      if (this.baroHistory.length > this.maxBaroHistory) this.baroHistory.shift();
    }

    // Record current wind
    const windSpeedTrue = snap.environment?.windSpeedTrue;
    const windAngleTrue = snap.environment?.windAngleTrue;
    if (windSpeedTrue != null) {
      this.windHistory.push({ speed: windSpeedTrue, angle: windAngleTrue, time: Date.now() });
      if (this.windHistory.length > this.maxWindHistory) this.windHistory.shift();
    }

    // 1. Barometric trend analysis
    const baroRec = this._analyzeBaroTrend();
    if (baroRec) results.push(baroRec);

    // 2. Reef/unreef recommendation
    const reefRec = await this._analyzeReefTiming(windSpeedTrue);
    if (reefRec) results.push(reefRec);

    // 3. Wind shift detection
    const shiftRec = this._detectWindShift();
    if (shiftRec) results.push(shiftRec);

    return results.length > 0 ? results : null;
  }

  // ── Barometric pressure trend ─────────────────────────
  _analyzeBaroTrend() {
    if (this.baroHistory.length < 10) return null; // need some history

    const now = Date.now();
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    const current = this.baroHistory[this.baroHistory.length - 1].value;

    // 3-hour trend
    const threeHr = this.baroHistory.find(b => b.time >= threeHoursAgo);
    const threeHrDrop = threeHr ? threeHr.value - current : 0;

    // 1-hour trend
    const oneHr = this.baroHistory.find(b => b.time >= oneHourAgo);
    const oneHrDrop = oneHr ? oneHr.value - current : 0;

    // Rapid drop: > 3 hPa in 1 hour or > 5 hPa in 3 hours
    if (oneHrDrop > 3) {
      return {
        type: 'baro_rapid_drop',
        urgency: 'advisory',
        title: `Barometer dropping rapidly: ${oneHrDrop.toFixed(1)} hPa/hr`,
        reasoning: `Pressure fell from ${(current + oneHrDrop).toFixed(0)} to ${current.toFixed(0)} hPa in the last hour. Rapid drops (>3 hPa/hr) indicate approaching front or squall. Expect wind increase and possible direction change.`,
        impact: 'Prepare for deteriorating conditions. Consider reefing now.',
        expiresAt: now + 60 * 60 * 1000,
      };
    }

    if (threeHrDrop > 5) {
      return {
        type: 'baro_steady_drop',
        urgency: 'suggestion',
        title: `Barometer falling: ${threeHrDrop.toFixed(1)} hPa over 3 hours`,
        reasoning: `Pressure down from ${(current + threeHrDrop).toFixed(0)} to ${current.toFixed(0)} hPa. Gradual drops suggest approaching weather system. Monitor wind and clouds.`,
        impact: 'Weather likely deteriorating over next 6-12 hours.',
        expiresAt: now + 2 * 60 * 60 * 1000,
      };
    }

    return null;
  }

  // ── Reef / unreef timing ──────────────────────────────
  async _analyzeReefTiming(currentWind) {
    if (currentWind == null) return null;
    const now = Date.now();
    if (now - this.lastReefRecommendation < this.reefCooldownMs) return null;

    // Get forecast for upcoming wind
    const forecast = await this._getForecast();
    const upcomingGust = forecast?.maxGustNext2hrs;
    const upcomingWind = forecast?.avgWindNext2hrs;

    // Reef thresholds (configurable, these are good defaults for a 58ft cat)
    const reefThreshold = this.config.reefWindKts || 18;
    const unreefThreshold = this.config.unreefWindKts || 12;

    // Recommend reefing if:
    // - Current wind > threshold, OR
    // - Forecast shows wind building past threshold in next 2 hours
    if (currentWind >= reefThreshold) {
      this.lastReefRecommendation = now;
      return {
        type: 'reef_now',
        urgency: 'advisory',
        title: `Wind ${currentWind.toFixed(0)}kts — reef recommended`,
        reasoning: `Sustained wind at ${currentWind.toFixed(0)}kts exceeds reef threshold (${reefThreshold}kts).${upcomingGust ? ` Gusts to ${upcomingGust.toFixed(0)}kts forecast.` : ''} Reef now for safety and better control.`,
        impact: 'Speed will decrease slightly but boat will be balanced and safer.',
        expiresAt: now + 30 * 60 * 1000,
      };
    }

    if (upcomingWind && upcomingWind > reefThreshold && currentWind < reefThreshold) {
      this.lastReefRecommendation = now;
      // Forecast shows wind building — reef proactively
      const isDay = new Date().getHours() >= 6 && new Date().getHours() <= 18;
      return {
        type: 'reef_proactive',
        urgency: 'advisory',
        title: `Wind building to ${upcomingWind.toFixed(0)}kts — reef now while manageable`,
        reasoning: `Currently ${currentWind.toFixed(0)}kts but forecast shows ${upcomingWind.toFixed(0)}kts in next 2 hours.${!isDay ? ' It will be dark soon — reefing in daylight is much easier.' : ''} Reef now while conditions are comfortable.`,
        impact: `Proactive reef avoids a harder, potentially dangerous reef in ${upcomingWind.toFixed(0)}kts later.`,
        expiresAt: now + 60 * 60 * 1000,
      };
    }

    // Unreef recommendation
    if (currentWind < unreefThreshold && this.windHistory.length >= 10) {
      const recentAvg = this.windHistory.slice(-10).reduce((s, w) => s + w.speed, 0) / 10;
      const forecast15min = this.windHistory.slice(-5).reduce((s, w) => s + w.speed, 0) / 5;
      // Only unreef if wind has been consistently low AND not forecast to increase
      if (recentAvg < unreefThreshold && forecast15min < unreefThreshold && (!upcomingWind || upcomingWind < reefThreshold)) {
        return {
          type: 'unreef',
          urgency: 'suggestion',
          title: `Wind dropped to ${currentWind.toFixed(0)}kts — consider shaking out reef`,
          reasoning: `Wind has been below ${unreefThreshold}kts for ${Math.round((now - this.windHistory[this.windHistory.length - 10].time) / 60000)} minutes. Forecast shows continued moderate conditions. Unreefing would improve speed.`,
          impact: 'Higher speed. Better light-air performance.',
          expiresAt: now + 15 * 60 * 1000,
        };
      }
    }

    return null;
  }

  // ── Wind shift detection ──────────────────────────────
  _detectWindShift() {
    if (this.windHistory.length < 6) return null;

    const recent = this.windHistory.slice(-3);
    const older = this.windHistory.slice(-6, -3);

    const recentAngle = recent.reduce((s, w) => s + (w.angle || 0), 0) / recent.length;
    const olderAngle = older.reduce((s, w) => s + (w.angle || 0), 0) / older.length;

    let shift = recentAngle - olderAngle;
    // Don't report tiny shifts
    if (Math.abs(shift) < 10) return null;
    if (Math.abs(shift) > 180) shift = shift > 0 ? shift - 360 : shift + 360;

    const direction = shift > 0 ? 'veered (clockwise)' : 'backed (counter-clockwise)';

    return {
      type: 'wind_shift',
      urgency: Math.abs(shift) > 20 ? 'advisory' : 'info',
      title: `Wind ${direction} ${Math.abs(Math.round(shift))}°`,
      reasoning: `True wind angle changed from ${Math.round(olderAngle)}° to ${Math.round(recentAngle)}° (${direction}). ${Math.abs(shift) > 20 ? 'Significant shift — check if your heading is still optimal.' : 'Minor shift — monitor for continuation.'}`,
      impact: Math.abs(shift) > 20 ? 'Course adjustment may improve VMG.' : null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  }

  // ── Fetch and cache weather forecast ──────────────────
  async _getForecast() {
    const now = Date.now();
    if (this._forecastCache && (now - this._forecastFetchedAt) < this._forecastTtl) {
      return this._forecastCache;
    }

    if (!this.weather) return null;

    try {
      const pos = this.sk.getPosition();
      if (!pos) return null;

      // Use existing weather service to get forecast
      const forecast = await this.weather.getForecast?.(pos.lat, pos.lon, 6);
      if (!forecast?.hourly) return null;

      // Extract next 2 hours of wind data
      const next2hrs = forecast.hourly.slice(0, 2);
      const winds = next2hrs.map(h => h.wind_speed_10m).filter(Boolean);
      const gusts = next2hrs.map(h => h.wind_gusts_10m).filter(Boolean);

      this._forecastCache = {
        avgWindNext2hrs: winds.length ? winds.reduce((a, b) => a + b, 0) / winds.length * 1.94384 : null,
        maxGustNext2hrs: gusts.length ? Math.max(...gusts) * 1.94384 : null,
      };
      this._forecastFetchedAt = now;
      return this._forecastCache;
    } catch {
      return null;
    }
  }

  // ── TimesFM sensor-based forecast ────────────────────
  // Uses own sensor history (wind, baro, battery) for zero-shot
  // predictions via TimesFM 2.5 on ElmoServer.
  async getSensorForecast(horizon = 24) {
    const now = Date.now();
    if (this._sensorForecastCache && (now - this._sensorForecastAt) < this._sensorForecastTtl) {
      return this._sensorForecastCache;
    }

    // Lazy-load the timesfm client
    if (!this._timesfm) {
      try {
        this._timesfm = await import('../timesfm-client.js');
      } catch {
        return null;
      }
    }

    const metrics = {};

    // Use wind history if enough data (at least 10 points)
    if (this.windHistory.length >= 10) {
      metrics.wind_speed = this.windHistory.map(w => w.speed);
    }

    // Use baro history
    if (this.baroHistory.length >= 10) {
      metrics.pressure = this.baroHistory.map(b => b.value);
    }

    if (Object.keys(metrics).length === 0) return null;

    try {
      const result = await this._timesfm.forecastMultiMetric(metrics, horizon);
      this._sensorForecastCache = result;
      this._sensorForecastAt = now;
      return result;
    } catch (err) {
      console.warn('[weather-intelligence] TimesFM forecast failed:', err.message);
      return null;
    }
  }
}
