// ============================================================
// WEATHER PROVIDERS — Multi-model failover + health tracking
// ============================================================
// Adapters for Open-Meteo (primary) and Stormglass (emergency).
// Failover chain, health monitoring, rate limit tracking.
// ============================================================

// ── Rate Limit Tracker ──
const rateLimits = {
  'open-meteo': { minute: { count: 0, reset: 0, limit: 600 }, hour: { count: 0, reset: 0, limit: 5000 }, day: { count: 0, reset: 0, limit: 10000 } },
  'stormglass': { day: { count: 0, reset: 0, limit: 10 } }
};

function checkRateLimit(provider) {
  const buckets = rateLimits[provider];
  if (!buckets) return true;
  const now = Date.now();
  for (const [period, bucket] of Object.entries(buckets)) {
    const windowMs = period === 'minute' ? 60000 : period === 'hour' ? 3600000 : 86400000;
    if (now - bucket.reset > windowMs) {
      bucket.count = 0;
      bucket.reset = now;
    }
    if (bucket.count >= bucket.limit) return false;
  }
  return true;
}

function checkRateLimitCapacity(provider) {
  const buckets = rateLimits[provider];
  if (!buckets) return 1;
  const now = Date.now();
  let minRatio = 1;
  for (const [period, bucket] of Object.entries(buckets)) {
    const windowMs = period === 'minute' ? 60000 : period === 'hour' ? 3600000 : 86400000;
    if (now - bucket.reset > windowMs) {
      bucket.count = 0;
      bucket.reset = now;
    }
    const ratio = 1 - (bucket.count / bucket.limit);
    if (ratio < minRatio) minRatio = ratio;
  }
  return minRatio;
}

function recordRequest(provider) {
  const buckets = rateLimits[provider];
  if (!buckets) return;
  const now = Date.now();
  for (const [period, bucket] of Object.entries(buckets)) {
    const windowMs = period === 'minute' ? 60000 : period === 'hour' ? 3600000 : 86400000;
    if (now - bucket.reset > windowMs) {
      bucket.count = 0;
      bucket.reset = now;
    }
    bucket.count++;
    if (bucket.count / bucket.limit >= 0.9) {
      console.warn(`[weather-providers] ${provider} rate limit ${period}: ${bucket.count}/${bucket.limit} (90%+)`);
    }
  }
}

// ── Health Tracker ──
const healthState = {
  'open-meteo': { status: 'healthy', consecutiveErrors: 0, lastError: null, lastSuccess: null, lastDownAt: null },
  'stormglass': { status: 'healthy', consecutiveErrors: 0, lastError: null, lastSuccess: null, lastDownAt: null }
};

function recordSuccess(provider) {
  const h = healthState[provider];
  if (!h) return;
  h.consecutiveErrors = 0;
  h.lastSuccess = Date.now();
  h.status = 'healthy';
  h.lastDownAt = null;
}

function recordError(provider, err) {
  const h = healthState[provider];
  if (!h) return;
  h.consecutiveErrors++;
  h.lastError = { message: err.message, time: Date.now() };
  if (h.consecutiveErrors >= 10 || (h.lastDownAt && Date.now() - h.lastDownAt > 300000)) {
    h.status = 'unhealthy';
  } else if (h.consecutiveErrors >= 3) {
    if (!h.lastDownAt) h.lastDownAt = Date.now();
    h.status = 'degraded';
  }
}

function isHealthy(provider) {
  return healthState[provider]?.status !== 'unhealthy';
}

// ── Error Classification ──
function isRetryable(err) {
  if (err.statusCode && [429, 502, 503, 504].includes(err.statusCode)) return true;
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(err.code)) return true;
  if (err.message && err.message.includes('timeout')) return true;
  return false;
}

function isModelError(err) {
  if (err.statusCode === 400 && err.message && /model|not available|invalid/i.test(err.message)) return true;
  return false;
}

function shouldFailover(err) {
  return isRetryable(err) || isModelError(err);
}

// ── Fetch with timeout ──
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const e = new Error('Request timeout');
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  }
}

// ── OpenMeteoProvider ──
const OpenMeteoProvider = {
  name: 'open-meteo',

  async fetchWeather(lat, lon, hours, modelId) {
    const params = [
      'temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
      'precipitation', 'cloud_cover', 'visibility', 'pressure_msl', 'weather_code'
    ].join(',');
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=${params}&wind_speed_unit=kn&forecast_hours=${hours || 168}&timezone=UTC`;
    if (modelId) url += `&models=${modelId}`;

    recordRequest('open-meteo');
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) {
      const err = new Error(`Open-Meteo weather: ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }
    const data = await resp.json();
    recordSuccess('open-meteo');
    return data;
  },

  async fetchMarine(lat, lon, hours, modelId) {
    const params = [
      'wave_height', 'wave_direction', 'wave_period',
      'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
      'swell_wave_height', 'swell_wave_direction', 'swell_wave_period'
    ].join(',');
    let url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&hourly=${params}&forecast_hours=${hours || 168}&timezone=UTC`;
    if (modelId) url += `&models=${modelId}`;

    recordRequest('open-meteo');
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) {
      const err = new Error(`Open-Meteo marine: ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }
    const data = await resp.json();
    recordSuccess('open-meteo');
    return data;
  }
};

// ── StormglassProvider (emergency marine backup) ──
const StormglassProvider = {
  name: 'stormglass',

  async fetchMarine(lat, lon, hours) {
    const apiKey = process.env.STORMGLASS_API_KEY;
    if (!apiKey) {
      console.warn('[weather-providers] STORMGLASS_API_KEY not set — skipping Stormglass');
      return null;
    }
    if (!checkRateLimit('stormglass')) {
      console.warn('[weather-providers] Stormglass daily quota exhausted');
      return null;
    }

    const end = new Date(Date.now() + (hours || 168) * 3600000).toISOString();
    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}` +
      `&params=waveHeight,waveDirection,wavePeriod,swellHeight,swellDirection,swellPeriod,windWaveHeight` +
      `&end=${end}`;

    recordRequest('stormglass');
    const resp = await fetchWithTimeout(url, {
      headers: { 'Authorization': apiKey }
    }, 10000);

    if (!resp.ok) {
      const err = new Error(`Stormglass: ${resp.status}`);
      err.statusCode = resp.status;
      recordError('stormglass', err);
      throw err;
    }

    const raw = await resp.json();
    recordSuccess('stormglass');

    // Normalize to Open-Meteo hourly format
    if (!raw.hours || !raw.hours.length) return null;
    const hourly = {
      time: [], wave_height: [], wave_direction: [], wave_period: [],
      swell_wave_height: [], swell_wave_direction: [], swell_wave_period: [],
      wind_wave_height: [], wind_wave_direction: [], wind_wave_period: []
    };
    for (const h of raw.hours) {
      hourly.time.push(h.time.replace(':00+00:00', ''));
      hourly.wave_height.push(h.waveHeight?.sg ?? null);
      hourly.wave_direction.push(h.waveDirection?.sg ?? null);
      hourly.wave_period.push(h.wavePeriod?.sg ?? null);
      hourly.swell_wave_height.push(h.swellHeight?.sg ?? null);
      hourly.swell_wave_direction.push(h.swellDirection?.sg ?? null);
      hourly.swell_wave_period.push(h.swellPeriod?.sg ?? null);
      hourly.wind_wave_height.push(h.windWaveHeight?.sg ?? null);
      hourly.wind_wave_direction.push(null);
      hourly.wind_wave_period.push(null);
    }
    return { hourly };
  }
};

// ── Model Fallback Maps ──
const WEATHER_FALLBACKS = {
  ecmwf_ifs025: ['gfs_seamless', null],
  gfs_seamless: ['ecmwf_ifs025', null],
  icon_seamless: ['gfs_seamless', 'ecmwf_ifs025', null]
};

const MARINE_FALLBACKS = {
  ecmwf_wam025: ['ncep_gfswave025', null],
  ncep_gfswave025: ['ecmwf_wam025', null]
};

function getFallbackModels(modelId, type) {
  const map = type === 'marine' ? MARINE_FALLBACKS : WEATHER_FALLBACKS;
  return map[modelId] || [null];
}

// ── Failover Orchestrator ──
async function fetchWithFailover(type, lat, lon, hours, modelId) {
  const provider = 'open-meteo';

  // Check rate limit
  if (!checkRateLimit(provider)) {
    console.warn(`[weather-providers] ${provider} rate limited — trying fallbacks`);
  }

  const fetchFn = type === 'marine'
    ? (mid) => OpenMeteoProvider.fetchMarine(lat, lon, hours, mid)
    : (mid) => OpenMeteoProvider.fetchWeather(lat, lon, hours, mid);

  // Attempt 1: Primary model
  if (isHealthy(provider) && checkRateLimit(provider)) {
    try {
      const data = await fetchFn(modelId);
      return { data, source: provider, model: modelId || 'best', fallback: false };
    } catch (err) {
      recordError(provider, err);
      if (!shouldFailover(err)) throw err;

      // Attempt 2: Retry once after 2s
      if (isRetryable(err)) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const data = await fetchFn(modelId);
          return { data, source: provider, model: modelId || 'best', fallback: false };
        } catch (retryErr) {
          recordError(provider, retryErr);
        }
      }
    }
  }

  // Attempt 3: Fallback models
  const fallbacks = getFallbackModels(modelId, type);
  for (const fbModel of fallbacks) {
    if (!checkRateLimit(provider)) break;
    try {
      const data = await fetchFn(fbModel);
      recordSuccess(provider);
      return { data, source: provider, model: fbModel || 'best', fallback: true };
    } catch (err) {
      recordError(provider, err);
    }
  }

  // Attempt 4 (marine only): Stormglass
  if (type === 'marine') {
    try {
      const data = await StormglassProvider.fetchMarine(lat, lon, hours);
      if (data) {
        return { data, source: 'stormglass', model: 'stormglass', fallback: true };
      }
    } catch (err) {
      console.warn('[weather-providers] Stormglass fallback failed:', err.message);
    }
  }

  // All attempts exhausted
  if (type === 'marine') {
    console.warn(`[weather-providers] All marine providers failed for ${lat},${lon}`);
    return { data: null, source: null, model: null, fallback: true };
  }
  throw new Error(`All weather providers failed for ${lat},${lon}`);
}

// ── Public API ──
function getHealthStatus() {
  const result = {};
  for (const [name, state] of Object.entries(healthState)) {
    const capacity = checkRateLimitCapacity(name);
    result[name] = {
      status: state.status,
      consecutive_errors: state.consecutiveErrors,
      last_error: state.lastError,
      last_success: state.lastSuccess ? new Date(state.lastSuccess).toISOString() : null,
      rate_limit_remaining: Math.round(capacity * 100)
    };
  }
  return result;
}

function getRateLimitStatus() {
  const result = {};
  for (const [name, buckets] of Object.entries(rateLimits)) {
    result[name] = {};
    const now = Date.now();
    for (const [period, bucket] of Object.entries(buckets)) {
      const windowMs = period === 'minute' ? 60000 : period === 'hour' ? 3600000 : 86400000;
      if (now - bucket.reset > windowMs) {
        bucket.count = 0;
        bucket.reset = now;
      }
      result[name][period] = { used: bucket.count, limit: bucket.limit, remaining: bucket.limit - bucket.count };
    }
  }
  return result;
}

function hasComparisonBudget(modelCount) {
  // Each model comparison needs ~2x the normal request budget (weather + marine per cell)
  // Check if we have at least 10% capacity remaining after the comparison
  const capacity = checkRateLimitCapacity('open-meteo');
  const needed = modelCount * 0.05; // rough estimate: 5% per model
  return capacity > needed;
}

export {
  fetchWithFailover,
  getHealthStatus,
  getRateLimitStatus,
  hasComparisonBudget,
  checkRateLimit,
  OpenMeteoProvider,
  StormglassProvider
};
