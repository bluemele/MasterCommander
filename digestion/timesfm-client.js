// ============================================================
// TIMESFM CLIENT — Zero-shot time series forecasting
// ============================================================
// Calls TimesFM 2.5-200m API on ElmoServer for sensor-based
// forecasts: wind speed, barometric pressure, battery voltage.
// Returns point forecasts + confidence intervals (q10/q50/q90).
// ============================================================

const TIMESFM_URL = process.env.TIMESFM_URL || 'http://100.89.16.27:8100';
const TIMEOUT_MS = 10_000;

async function fetchTimesFM(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${TIMESFM_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`TimesFM ${resp.status}: ${text}`);
    }
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('TimesFM request timeout');
    throw err;
  }
}

/**
 * Forecast a single telemetry metric.
 * @param {number[]} values — historical time series values
 * @param {number} horizon — steps to predict (default 24)
 * @param {string} metricName — e.g. 'wind_speed', 'pressure', 'battery_voltage'
 * @returns {{ forecast, quantile_10, quantile_50, quantile_90, input_length, horizon }}
 */
export async function forecastTelemetry(values, horizon = 24, metricName = null) {
  return fetchTimesFM('/forecast/telemetry', {
    values,
    horizon,
    metric_name: metricName,
  });
}

/**
 * Forecast multiple metrics in one batch call.
 * @param {Object.<string, number[]>} metrics — { wind_speed: [...], pressure: [...], ... }
 * @param {number} horizon — steps to predict
 * @returns {Object.<string, { forecast, q10, q50, q90 }>}
 */
export async function forecastMultiMetric(metrics, horizon = 24) {
  const names = Object.keys(metrics);
  const series = names.map(k => metrics[k]);

  const result = await fetchTimesFM('/forecast/batch', { series, horizon });

  const out = {};
  for (let i = 0; i < names.length; i++) {
    out[names[i]] = {
      forecast: result.forecasts[i],
      q10: result.quantiles_10[i],
      q90: result.quantiles_90[i],
    };
  }
  return out;
}

/**
 * Check if TimesFM API is available.
 */
export async function healthCheck() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${TIMESFM_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { available: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { available: data.model_loaded === true, ...data };
  } catch (err) {
    clearTimeout(timer);
    return { available: false, error: err.message };
  }
}
