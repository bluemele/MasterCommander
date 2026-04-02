// ============================================================
// TELEMETRY CLIENT + GAUGE RENDERERS
// ============================================================
// SSE client for live boat telemetry + pure DOM gauge panels.
// No libraries. Colors match dashboard.css variables.
// ============================================================

(function() {
  'use strict';

  // ── Color palette (matches CSS vars) ──
  var C = {
    ocean: '#0C4A6E', sky: '#0EA5E9', emerald: '#10B981',
    amber: '#F59E0B', red: '#EF4444', slate: '#64748B',
    border: '#E2E8F0', text: '#0F172A'
  };

  // ── Helpers ──
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(v, d) { return v != null ? Number(v).toFixed(d || 0) : '--'; }

  // ============================================================
  // TELEMETRY CLIENT (SSE)
  // ============================================================
  function TelemetryClient() {
    this.es = null;
    this._cb = null;
    this._statusCb = null;
    this.connected = false;
    this.lastSnapshot = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectDelay = 30000;
    this._destroyed = false; // true after explicit disconnect()
    this._currentUrl = null;
    this._currentMode = null; // 'live' or 'boat'
    this._currentBoatId = null;
  }

  TelemetryClient.prototype._scheduleReconnect = function() {
    var self = this;
    if (self._destroyed || self._reconnectTimer) return;
    self._reconnectAttempts++;
    var delay = Math.min(2000 * Math.pow(2, self._reconnectAttempts - 1), self._maxReconnectDelay);
    console.log('[telemetry] Reconnecting in ' + Math.round(delay / 1000) + 's (attempt ' + self._reconnectAttempts + ')');
    self._reconnectTimer = setTimeout(function() {
      self._reconnectTimer = null;
      if (self._destroyed) return;
      if (self._currentMode === 'boat' && self._currentBoatId != null) {
        self.connectToBoat(self._currentBoatId);
      } else {
        self.connect();
      }
    }, delay);
  };

  TelemetryClient.prototype.connect = function() {
    var self = this;
    self._destroyed = false;
    self._currentMode = 'live';
    self._currentUrl = '/api/telemetry/live';
    // Clean up any existing connection
    if (self.es) { try { self.es.close(); } catch(e) {} self.es = null; }

    self.es = new EventSource('/api/telemetry/live');

    self.es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        self.connected = true;
        self._reconnectAttempts = 0;
        self.lastSnapshot = data;
        if (self._cb) self._cb(data);
        if (self._statusCb) self._statusCb(true);
      } catch(err) {
        console.warn('[telemetry] Parse error:', err.message);
      }
    };

    self.es.addEventListener('status', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (!data.connected) {
          self.connected = false;
          if (self._statusCb) self._statusCb(false);
        }
      } catch(err) {}
    });

    self.es.onerror = function() {
      self.connected = false;
      if (self._statusCb) self._statusCb(false);
      // EventSource auto-reconnects, but if it closes fully, handle it
      if (self.es && self.es.readyState === EventSource.CLOSED) {
        self.es = null;
        self._scheduleReconnect();
      }
    };
  };

  TelemetryClient.prototype.onUpdate = function(cb) { this._cb = cb; };
  TelemetryClient.prototype.onStatus = function(cb) { this._statusCb = cb; };

  TelemetryClient.prototype.disconnect = function() {
    this._destroyed = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.es) { this.es.close(); this.es = null; }
    this.connected = false;
    this._reconnectAttempts = 0;
  };

  // Connect to real boat telemetry via boat-specific SSE endpoint
  TelemetryClient.prototype.connectToBoat = function(boatId) {
    var self = this;
    self._destroyed = false;
    self._currentMode = 'boat';
    self._currentBoatId = boatId;
    self.boatId = boatId;
    // Clean up any existing connection
    if (self.es) { try { self.es.close(); } catch(e) {} self.es = null; }

    var url = '/api/telemetry/boat/' + boatId + '/live';
    self.es = new EventSource(url);

    self.es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        // The boat SSE sends { boat_id, ts, snapshot } where snapshot is translated
        var snap = data.snapshot || data;
        self.connected = true;
        self._reconnectAttempts = 0;
        self.lastSnapshot = snap;
        if (self._cb) self._cb(snap);
        if (self._statusCb) self._statusCb(true);
      } catch(err) {
        console.warn('[telemetry] Boat SSE parse error:', err.message);
      }
    };

    self.es.onerror = function() {
      self.connected = false;
      if (self._statusCb) self._statusCb(false);
      if (self.es && self.es.readyState === EventSource.CLOSED) {
        self.es = null;
        self._scheduleReconnect();
      }
    };
  };

  // ============================================================
  // GAUGE RENDERERS (persistent DOM — init once, patch values)
  // ============================================================

  // Helper: create a row with label + value, returning a ref to the value span
  function makeRow(label, unit) {
    var row = document.createElement('div'); row.className = 'telem-row';
    var lbl = document.createElement('span'); lbl.className = 'telem-label'; lbl.textContent = label;
    var val = document.createElement('span'); val.className = 'telem-value';
    var unitEl = null;
    if (unit) { unitEl = document.createElement('span'); unitEl.className = 'telem-unit'; unitEl.innerHTML = unit; val.appendChild(document.createTextNode('')); val.appendChild(unitEl); }
    row.appendChild(lbl); row.appendChild(val);
    return { row: row, val: val, setText: function(t) { val.firstChild ? val.firstChild.textContent = t : val.textContent = t; } };
  }

  function makeTitle(icon, text) {
    var d = document.createElement('div'); d.className = 'telem-panel-title';
    var sp = document.createElement('span'); sp.innerHTML = icon; d.appendChild(sp);
    d.appendChild(document.createTextNode(' ' + text)); return d;
  }

  // Helper: update value and toggle warn/crit class
  function setValClass(valEl, text, cls) {
    if (valEl.firstChild && valEl.firstChild.nodeType === 3) valEl.firstChild.textContent = text;
    else { var tn = valEl.querySelector('.telem-unit'); if (tn) { if (!valEl.firstChild || valEl.firstChild === tn) valEl.insertBefore(document.createTextNode(text), tn); else valEl.firstChild.textContent = text; } else valEl.textContent = text; }
    valEl.className = 'telem-value' + (cls ? ' ' + cls : '');
  }

  // ── Navigation panel (persistent DOM) ──
  function renderNavPanel(el, snap) {
    var nav = snap.navigation || {};
    var env = snap.environment || {};

    if (!el._refs) {
      el.innerHTML = '';
      el.appendChild(makeTitle('&#9881;', 'Navigation'));
      var r = {};
      r.sog = makeRow('SOG', ' kts'); el.appendChild(r.sog.row);
      r.hdg = makeRow('Heading (M)', '&deg;'); el.appendChild(r.hdg.row);
      r.cog = makeRow('COG', '&deg;'); el.appendChild(r.cog.row);
      r.depth = makeRow('Depth', ' m'); el.appendChild(r.depth.row);
      r.wtemp = makeRow('Water Temp', '&deg;C'); el.appendChild(r.wtemp.row);
      r.baro = makeRow('Baro', ' hPa'); el.appendChild(r.baro.row); r.baro.row.style.display = 'none';
      r.atemp = makeRow('Air Temp', '&deg;C'); el.appendChild(r.atemp.row); r.atemp.row.style.display = 'none';
      r.lat = makeRow('Lat', ''); el.appendChild(r.lat.row); r.lat.row.style.display = 'none';
      r.lon = makeRow('Lon', ''); el.appendChild(r.lon.row); r.lon.row.style.display = 'none';
      var link = document.createElement('a'); link.className = 'pos-link'; link.target = '_blank'; link.rel = 'noopener'; link.innerHTML = 'Google Maps &#8599;'; link.style.display = 'none';
      el.appendChild(link); r.mapLink = link;
      el._refs = r;
    }

    var r = el._refs;
    r.sog.setText(fmt(nav.sog, 1));
    r.hdg.setText(fmt(nav.heading));
    r.cog.setText(fmt(nav.cog));
    setValClass(r.depth.val, fmt(env.depth, 1), env.depth != null && env.depth < DEPTH_WARN ? 'warn' : '');
    r.wtemp.setText(fmt(env.waterTemp, 1));
    r.baro.row.style.display = env.baroPressure != null ? '' : 'none';
    if (env.baroPressure != null) r.baro.setText(fmt(env.baroPressure));
    r.atemp.row.style.display = env.airTemp != null ? '' : 'none';
    if (env.airTemp != null) r.atemp.setText(fmt(env.airTemp, 1));

    var pos = nav.position;
    if (pos) {
      var parts = pos.split(',');
      r.lat.setText(parts[0] ? parts[0].trim() : '--'); r.lat.row.style.display = '';
      r.lon.setText(parts[1] ? parts[1].trim() : '--'); r.lon.row.style.display = '';
      r.mapLink.href = 'https://www.google.com/maps?q=' + (parts[0]||'').trim() + ',' + (parts[1]||'').trim();
      r.mapLink.style.display = '';
    } else {
      r.lat.row.style.display = 'none'; r.lon.row.style.display = 'none'; r.mapLink.style.display = 'none';
    }
  }

  // ── House Battery panel (persistent DOM, VRM style) ──
  // ── Configurable thresholds (extract from inline magic numbers) ──
  var BATT_CAPACITY_AH = 1700;
  var BATT_VOLTAGE_NOM = 24;
  var ENGINE_RPM_MAX = 3500;
  var ENGINE_RPM_HIGH = 2500;
  var ENGINE_RPM_REDLINE = 3000;
  var COOLANT_WARN = 85;
  var COOLANT_CRIT = 95;
  var EXHAUST_WARN = 400;
  var EXHAUST_CRIT = 500;
  var DEPTH_WARN = 3;

  function renderBatteryPanel(el, snap) {
    var batts = snap.batteries || {};
    var b = batts.house;
    var elec = snap.electrical || {};
    if (!b) {
      el._refs = null;
      el.innerHTML = '<div class="telem-panel-title"><span>&#9889;</span> Energy</div><div style="color:var(--slate);font-size:.9rem;text-align:center;padding:12px">No battery detected</div>';
      return;
    }

    if (!el._refs) {
      el.innerHTML = '';
      el.appendChild(makeTitle('&#9889;', 'Energy'));
      var card = document.createElement('div'); card.className = 'vrm-card';
      var hdr = document.createElement('div'); hdr.className = 'vrm-header';
      var badge = document.createElement('span'); badge.className = 'vrm-state-badge';
      var pwrEl = document.createElement('span'); pwrEl.className = 'vrm-power';
      hdr.appendChild(badge); hdr.appendChild(pwrEl); card.appendChild(hdr);
      var socEl = document.createElement('div'); socEl.className = 'vrm-soc';
      var socNum = document.createTextNode(''); socEl.appendChild(socNum);
      var socPct = document.createElement('span'); socPct.textContent = ' %'; socEl.appendChild(socPct);
      card.appendChild(socEl);
      var barWrap = document.createElement('div'); barWrap.className = 'vrm-soc-bar';
      var barFill = document.createElement('div'); barFill.className = 'vrm-soc-fill';
      barWrap.appendChild(barFill); card.appendChild(barWrap);
      var details = document.createElement('div'); details.className = 'vrm-details';
      var vRow = document.createElement('div'); vRow.className = 'vrm-row'; vRow.innerHTML = '<span class="vrm-label">Voltage</span><span class="vrm-val"></span>';
      var cRow = document.createElement('div'); cRow.className = 'vrm-row'; cRow.innerHTML = '<span class="vrm-label">Current</span><span class="vrm-val"></span>';
      var pRow = document.createElement('div'); pRow.className = 'vrm-row'; pRow.innerHTML = '<span class="vrm-label">Power</span><span class="vrm-val"></span>';
      var solarRow = document.createElement('div'); solarRow.className = 'vrm-row'; solarRow.innerHTML = '<span class="vrm-label">Solar</span><span class="vrm-val"></span>';
      var netRow = document.createElement('div'); netRow.className = 'vrm-row'; netRow.innerHTML = '<span class="vrm-label">Net</span><span class="vrm-val"></span>';
      var tRow = document.createElement('div'); tRow.className = 'vrm-row'; tRow.innerHTML = '<span class="vrm-label">Time to go</span><span class="vrm-val"></span>'; tRow.style.display = 'none';
      details.appendChild(vRow); details.appendChild(cRow); details.appendChild(pRow);
      details.appendChild(solarRow); details.appendChild(netRow); details.appendChild(tRow);
      card.appendChild(details); el.appendChild(card);
      el._refs = { badge: badge, pwr: pwrEl, socNum: socNum, barFill: barFill, vVal: vRow.querySelector('.vrm-val'), cVal: cRow.querySelector('.vrm-val'), pVal: pRow.querySelector('.vrm-val'), solarVal: solarRow.querySelector('.vrm-val'), solarRow: solarRow, netVal: netRow.querySelector('.vrm-val'), tRow: tRow, tVal: tRow.querySelector('.vrm-val') };
    }

    var r = el._refs;
    var soc = b.soc != null ? b.soc : 0;
    var voltage = b.voltage != null ? b.voltage : 0;
    var current = b.current != null ? b.current : 0;
    var power = Math.round(voltage * current);
    var absPower = Math.abs(power);
    var charging = current > 0.5;
    var discharging = current < -0.5;
    var stateClass = charging ? 'vrm-charging' : discharging ? 'vrm-discharging' : 'vrm-idle';
    var stateText = charging ? 'Charging' : discharging ? 'Discharging' : 'Idle';
    var stateIcon = charging ? '\u26A1' : '\uD83D\uDD0B';

    r.badge.className = 'vrm-state-badge ' + stateClass;
    r.badge.textContent = stateIcon + ' ' + stateText;
    r.pwr.textContent = (power > 0 ? '+' : '') + power + ' W';
    r.socNum.textContent = fmt(soc);
    r.barFill.className = 'vrm-soc-fill ' + stateClass;
    r.barFill.style.width = Math.max(0, soc) + '%';
    r.vVal.textContent = fmt(voltage, 2) + ' V';
    r.cVal.textContent = fmt(current, 1) + ' A';
    r.pVal.textContent = (power > 0 ? '+' : '') + power + ' W';

    // Solar + net power (from electrical data)
    var solarW = elec.solar ? Math.round(elec.solar.power) : 0;
    var netW = solarW + power; // battery power: pos=charging, neg=discharging. This shows energy balance
    if (solarW > 0 || elec.solar) {
      var hour = new Date().getHours();
      var solarNote = hour < 6 || hour > 18 ? ' (night)' : solarW < 50 && solarW > 0 ? ' (cloudy?)' : '';
      r.solarVal.textContent = solarW > 10 ? solarW + 'W' + solarNote : 'None' + solarNote;
      r.solarRow.style.display = '';
      r.netVal.textContent = (netW > 0 ? '+' : '') + netW + ' W';
      r.netVal.style.color = netW > 0 ? 'var(--emerald)' : 'var(--amber)';
    } else {
      r.solarRow.style.display = 'none';
    }

    if (discharging && absPower > 5) {
      var hoursLeft = Math.round((BATT_CAPACITY_AH * BATT_VOLTAGE_NOM * (soc / 100)) / absPower);
      r.tVal.textContent = hoursLeft > 200 ? '200+ h' : hoursLeft + ' h';
      r.tRow.style.display = '';
    } else {
      r.tRow.style.display = 'none';
    }
  }

  // ── Engine panel (rich gauges + fuel economy) ──
  var ENGINE_RPM_GAUGE_MAX = 3600;
  var ENGINE_SERVICE_INTERVAL = 900;

  function engineOilStatus(psi) {
    if (psi == null) return { text: '--', cls: '', zone: 0 };
    if (psi < 15) return { text: 'ALARM', cls: 'crit', zone: 0 };
    if (psi < 25) return { text: 'LOW', cls: 'warn', zone: 1 };
    if (psi <= 70) return { text: 'NORMAL', cls: 'good', zone: 2 };
    return { text: 'HIGH', cls: 'warn', zone: 3 };
  }

  function engineCoolantStatus(c) {
    if (c == null) return { text: '--', cls: '', zone: 0 };
    if (c < 50) return { text: 'COLD', cls: '', zone: 0 };
    if (c < 75) return { text: 'WARMING', cls: '', zone: 1 };
    if (c <= 90) return { text: 'NORMAL', cls: 'good', zone: 2 };
    if (c <= 95) return { text: 'WATCH', cls: 'warn', zone: 3 };
    return { text: 'OVERHEAT', cls: 'crit', zone: 4 };
  }

  function altVoltageStatus(v) {
    if (v == null) return { text: '--', cls: '' };
    if (v < 12) return { text: 'NOT CHARGING', cls: 'crit' };
    if (v < 13.2) return { text: 'LOW', cls: 'warn' };
    if (v <= 14.8) return { text: 'CHARGING', cls: 'good' };
    return { text: 'HIGH', cls: 'warn' };
  }

  function cToF(c) { return c != null ? (c * 9 / 5 + 32) : null; }
  function lToGal(l) { return l != null ? l * 0.264172 : null; }

  function rangeBar(zones, value, max) {
    var pct = Math.min(100, Math.max(0, (value / max) * 100));
    var html = '<div class="range-bar">';
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      var left = (z.from / max) * 100;
      var width = ((z.to - z.from) / max) * 100;
      html += '<div class="range-zone" style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%;background:' + z.color + '"></div>';
    }
    html += '<div class="range-marker" style="left:' + pct.toFixed(1) + '%"></div>';
    html += '</div>';
    return html;
  }

  function renderEnginePanel(el, snap) {
    var engines = snap.engines || {};
    var keys = Object.keys(engines);
    if (keys.length === 0) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#9881;</span> Engines</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No engines detected</div>';
      return;
    }

    var sog = (snap.navigation || {}).sog || 0;
    var totalFuelRate = 0;
    var runningCount = 0;
    var blocks = '';

    for (var i = 0; i < keys.length; i++) {
      var e = engines[keys[i]];
      var rpm = e.rpm || 0;
      var running = e.running;

      if (running) {
        runningCount++;
        totalFuelRate += (e.fuelRate || 0);
      }

      var rpmPct = Math.min(100, (rpm / ENGINE_RPM_GAUGE_MAX) * 100);
      var rpmBarCls = rpmPct > 85 ? 'redline' : rpmPct > 65 ? 'high' : '';

      var oilPsi = e.oilPressure;
      var oilSt = engineOilStatus(oilPsi);
      var oilBar = rangeBar([
        { from: 0, to: 15, color: '#EF4444' },
        { from: 15, to: 25, color: '#F59E0B' },
        { from: 25, to: 70, color: '#10B981' },
        { from: 70, to: 100, color: '#F59E0B' }
      ], oilPsi || 0, 100);

      var coolC = e.coolantTemp;
      var coolF = cToF(coolC);
      var coolSt = engineCoolantStatus(coolC);
      var coolBar = rangeBar([
        { from: 0, to: 50, color: '#3B82F6' },
        { from: 50, to: 75, color: '#64748B' },
        { from: 75, to: 90, color: '#10B981' },
        { from: 90, to: 95, color: '#F59E0B' },
        { from: 95, to: 120, color: '#EF4444' }
      ], coolC || 0, 120);

      var altV = e.alternatorVoltage;
      var altSt = altVoltageStatus(altV);

      var fuelLhr = e.fuelRate || 0;
      var fuelGhr = lToGal(fuelLhr);
      var fuelLnm = sog > 0.5 ? fuelLhr / sog : null;
      var fuelGnm = fuelLnm != null ? lToGal(fuelLnm) : null;

      var hours = e.hours || 0;
      var nextService = Math.ceil(hours / ENGINE_SERVICE_INTERVAL) * ENGINE_SERVICE_INTERVAL;
      if (nextService === hours) nextService += ENGINE_SERVICE_INTERVAL;
      var hoursToService = nextService - hours;

      var load = e.load;

      if (running) {
        blocks +=
          '<div class="engine-block">' +
          '<div class="engine-id">' + esc(keys[i]) + ' <span class="engine-running">Running</span></div>' +
          '<div class="engine-gauge-section">' +
          '<div class="engine-gauge-header"><span class="telem-label">RPM</span><span class="telem-value" style="font-size:1.15rem">' + fmt(rpm) + '</span></div>' +
          '<div class="rpm-bar-wrap"><div class="rpm-bar"><div class="rpm-bar-fill ' + rpmBarCls + '" style="width:' + rpmPct.toFixed(0) + '%"></div></div></div>' +
          '<div class="rpm-scale"><span>0</span><span>1800</span><span>3600</span></div>' +
          '</div>' +
          '<div class="engine-gauge-section">' +
          '<div class="engine-gauge-header"><span class="telem-label">Oil Pressure</span><span class="telem-value ' + oilSt.cls + '">' + fmt(oilPsi) + ' <span class="telem-unit">PSI</span> <span class="engine-status-tag ' + oilSt.cls + '">' + oilSt.text + '</span></span></div>' +
          oilBar +
          '</div>' +
          '<div class="engine-gauge-section">' +
          '<div class="engine-gauge-header"><span class="telem-label">Coolant</span><span class="telem-value ' + coolSt.cls + '">' + fmt(coolC) + '&deg;C <span class="telem-unit">(' + fmt(coolF) + '&deg;F)</span> <span class="engine-status-tag ' + coolSt.cls + '">' + coolSt.text + '</span></span></div>' +
          coolBar +
          '</div>' +
          '<div class="engine-gauge-section">' +
          '<div class="engine-gauge-header"><span class="telem-label">Fuel Rate</span><span class="telem-value">' + fmt(fuelLhr, 1) + ' <span class="telem-unit">L/hr</span> <span class="telem-unit telem-unit-sep">(' + fmt(fuelGhr, 1) + ' gal/hr)</span></span></div>' +
          (fuelLnm != null ? '<div class="engine-gauge-header" style="margin-top:2px"><span class="telem-label">Efficiency</span><span class="telem-value">' + fmt(fuelLnm, 2) + ' <span class="telem-unit">L/nm</span> <span class="telem-unit telem-unit-sep">(' + fmt(fuelGnm, 2) + ' gal/nm)</span></span></div>' : '') +
          '</div>' +
          '<div class="telem-row"><span class="telem-label">Alternator</span><span class="telem-value ' + altSt.cls + '">' + fmt(altV, 1) + ' <span class="telem-unit">V</span> <span class="engine-status-tag ' + altSt.cls + '">' + altSt.text + '</span></span></div>' +
          (load != null ? '<div class="telem-row"><span class="telem-label">Load</span><span class="telem-value">' + fmt(load) + '<span class="telem-unit">%</span></span></div>' : '') +
          '<div class="telem-row"><span class="telem-label">Hours</span><span class="telem-value">' + fmt(hours) + ' <span class="telem-unit">hrs</span></span></div>' +
          '<div class="telem-row"><span class="telem-label">Next Service</span><span class="telem-value' + (hoursToService < 50 ? ' warn' : '') + '">' + fmt(hoursToService) + ' <span class="telem-unit">hrs (' + nextService + 'h)</span></span></div>' +
          '</div>';
      } else {
        blocks +=
          '<div class="engine-block engine-block-off">' +
          '<div class="engine-id">' + esc(keys[i]) + ' <span class="engine-off">Off</span></div>' +
          '<div class="telem-row"><span class="telem-label">Hours</span><span class="telem-value">' + fmt(hours) + ' <span class="telem-unit">hrs</span></span></div>' +
          '<div class="telem-row"><span class="telem-label">Next Service</span><span class="telem-value' + (hoursToService < 50 ? ' warn' : '') + '">' + fmt(hoursToService) + ' <span class="telem-unit">hrs (' + nextService + 'h)</span></span></div>' +
          (coolC != null && coolC > 40 ?
            '<div class="telem-row"><span class="telem-label">Coolant (cooling)</span><span class="telem-value warn">' + fmt(coolC) + '&deg;C <span class="telem-unit">(' + fmt(coolF) + '&deg;F)</span></span></div>' : '') +
          (altV != null ?
            '<div class="telem-row"><span class="telem-label">Alternator</span><span class="telem-value ' + altSt.cls + '">' + fmt(altV, 1) + ' <span class="telem-unit">V</span></span></div>' : '') +
          '</div>';
      }
    }

    var fuelSummary = '';
    if (runningCount > 0 && totalFuelRate > 0) {
      var totalGhr = lToGal(totalFuelRate);
      var totalLnm = sog > 0.5 ? totalFuelRate / sog : null;
      var totalGnm = totalLnm != null ? lToGal(totalLnm) : null;

      var tankRange = '';
      if (snap.tanks) {
        var fuelKeys = Object.keys(snap.tanks).filter(function(k) {
          var t = snap.tanks[k];
          return (t.type || k.split('_')[0]) === 'fuel';
        });
        if (fuelKeys.length > 0) {
          var totalRemaining = 0;
          for (var fi = 0; fi < fuelKeys.length; fi++) {
            var ft = snap.tanks[fuelKeys[fi]];
            var cap = ft.capacity || 200;
            totalRemaining += (ft.level || 0) / 100 * cap;
          }
          if (totalRemaining > 0 && totalFuelRate > 0) {
            var rangeHrs = totalRemaining / totalFuelRate;
            var rangeNm = sog > 0.5 ? rangeHrs * sog : null;
            tankRange =
              '<div class="telem-row"><span class="telem-label">Est. Range</span><span class="telem-value">' +
              fmt(rangeHrs, 1) + ' <span class="telem-unit">hrs</span>' +
              (rangeNm != null ? ' <span class="telem-unit telem-unit-sep">(' + fmt(rangeNm, 0) + ' nm)</span>' : '') +
              '</span></div>';
          }
        }
      }

      fuelSummary =
        '<div class="engine-fuel-summary">' +
        '<div class="engine-fuel-title">' + runningCount + ' Engine' + (runningCount > 1 ? 's' : '') + ' \u2014 Total Fuel</div>' +
        '<div class="telem-row"><span class="telem-label">Consumption</span><span class="telem-value">' + fmt(totalFuelRate, 1) + ' <span class="telem-unit">L/hr</span> <span class="telem-unit telem-unit-sep">(' + fmt(totalGhr, 1) + ' gal/hr)</span></span></div>' +
        (totalLnm != null ? '<div class="telem-row"><span class="telem-label">Efficiency</span><span class="telem-value">' + fmt(totalLnm, 2) + ' <span class="telem-unit">L/nm</span> <span class="telem-unit telem-unit-sep">(' + fmt(totalGnm, 2) + ' gal/nm)</span></span></div>' : '') +
        tankRange +
        '</div>';
    }

    el.innerHTML = '<div class="telem-panel-title"><span>&#9881;</span> Engines</div>' + blocks + fuelSummary;
  }

  // ── Tanks panel (horizontal bars) ──
  function renderTanksPanel(el, snap) {
    var tanks = snap.tanks || {};
    var keys = Object.keys(tanks);
    if (keys.length === 0) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#9981;</span> Tanks</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No tanks detected</div>';
      return;
    }

    var bars = '';
    for (var i = 0; i < keys.length; i++) {
      var t = tanks[keys[i]];
      var level = t.level != null ? t.level : 0;
      var type = t.type || keys[i].split('_')[0];
      var name = keys[i].replace(/_/g, ' ').replace('freshWater', 'freshwater').replace('wasteWater', 'wastewater');
      var fillClass = type === 'fuel' ? 'fuel' : type === 'freshWater' ? 'freshwater' : 'wastewater';
      var pctColor = level < 15 ? ' crit' : level < 30 ? ' warn' : '';

      bars +=
        '<div class="tank-bar-wrap">' +
        '<div class="tank-bar-header"><span class="tank-bar-name">' + esc(name) + '</span><span class="tank-bar-pct' + pctColor + '">' + fmt(level) + '%</span></div>' +
        '<div class="tank-bar"><div class="tank-bar-fill ' + fillClass + '" style="width:' + Math.max(0, level).toFixed(0) + '%"></div></div>' +
        '</div>';
    }

    // Starter batteries (non-house) shown as compact voltage rows
    var batts = snap.batteries || {};
    var bkeys = Object.keys(batts);
    var starters = '';
    for (var j = 0; j < bkeys.length; j++) {
      if (bkeys[j] === 'house') continue;
      var b = batts[bkeys[j]];
      var label = bkeys[j].replace(/^starter/, '').replace(/([A-Z])/g, ' $1').trim() || bkeys[j];
      var vCls = b.voltage != null && b.voltage < 12.2 ? ' warn' : '';
      starters +=
        '<div class="telem-row"><span class="telem-label">Starter ' + esc(label) + '</span><span class="telem-value' + vCls + '">' + fmt(b.voltage, 1) + '<span class="telem-unit">V</span></span></div>';
    }
    if (starters) {
      starters = '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
        '<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--slate);margin-bottom:6px">Starter Batteries</div>' +
        starters + '</div>';
    }

    el.innerHTML = '<div class="telem-panel-title"><span>&#9981;</span> Tanks</div>' + bars + starters;
  }

  // ── Wind panel (persistent DOM — compass arrow updates via transform) ──
  function updateArrow(line, poly, angleDeg) {
    var rad = angleDeg * Math.PI / 180;
    var ax = 40 + 25 * Math.sin(rad), ay = 40 - 25 * Math.cos(rad);
    var headLen = 6, headAng = 0.4;
    var h1x = ax - headLen * Math.sin(rad - headAng), h1y = ay + headLen * Math.cos(rad - headAng);
    var h2x = ax - headLen * Math.sin(rad + headAng), h2y = ay + headLen * Math.cos(rad + headAng);
    line.setAttribute('x2', ax.toFixed(1)); line.setAttribute('y2', ay.toFixed(1));
    poly.setAttribute('points', ax.toFixed(1)+','+ay.toFixed(1)+' '+h1x.toFixed(1)+','+h1y.toFixed(1)+' '+h2x.toFixed(1)+','+h2y.toFixed(1));
  }

  function renderWindPanel(el, snap) {
    var env = snap.environment || {};
    if (env.windSpeed == null) {
      el._refs = null;
      el.innerHTML = '<div class="telem-panel-title"><span>&#127788;</span> Wind</div><div style="color:var(--slate);font-size:.9rem;text-align:center;padding:12px">No wind instruments</div>';
      return;
    }

    if (!el._refs) {
      el.innerHTML = '';
      el.appendChild(makeTitle('&#127788;', 'Wind'));
      // Build SVG compass
      var compassDiv = document.createElement('div'); compassDiv.className = 'wind-compass';
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 80 80');
      var circle = document.createElementNS(ns, 'circle'); circle.setAttribute('cx','40'); circle.setAttribute('cy','40'); circle.setAttribute('r','35'); circle.setAttribute('fill','none'); circle.setAttribute('stroke',C.border); circle.setAttribute('stroke-width','1.5'); svg.appendChild(circle);
      var dirs = [['40','12','N'],['40','76','S'],['8','43','W'],['72','43','E']];
      for (var d = 0; d < dirs.length; d++) { var t = document.createElementNS(ns,'text'); t.setAttribute('x',dirs[d][0]); t.setAttribute('y',dirs[d][1]); t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','7'); t.setAttribute('font-weight','700'); t.setAttribute('fill',C.slate); t.textContent = dirs[d][2]; svg.appendChild(t); }
      // Apparent arrow
      var aLine = document.createElementNS(ns,'line'); aLine.setAttribute('x1','40'); aLine.setAttribute('y1','40'); aLine.setAttribute('stroke',C.sky); aLine.setAttribute('stroke-width','2.5'); aLine.setAttribute('stroke-linecap','round'); svg.appendChild(aLine);
      var aPoly = document.createElementNS(ns,'polygon'); aPoly.setAttribute('fill',C.sky); svg.appendChild(aPoly);
      // True arrow
      var tLine = document.createElementNS(ns,'line'); tLine.setAttribute('x1','40'); tLine.setAttribute('y1','40'); tLine.setAttribute('stroke',C.emerald); tLine.setAttribute('stroke-width','2.5'); tLine.setAttribute('stroke-linecap','round'); svg.appendChild(tLine);
      var tPoly = document.createElementNS(ns,'polygon'); tPoly.setAttribute('fill',C.emerald); svg.appendChild(tPoly);
      var center = document.createElementNS(ns,'circle'); center.setAttribute('cx','40'); center.setAttribute('cy','40'); center.setAttribute('r','2.5'); center.setAttribute('fill',C.text); svg.appendChild(center);
      compassDiv.appendChild(svg); el.appendChild(compassDiv);
      // Legend
      var legend = document.createElement('div'); legend.className = 'wind-legend';
      legend.innerHTML = '<span class="wind-legend-item"><span style="background:'+C.sky+'"></span>Apparent</span><span class="wind-legend-item" id="wind-true-legend"><span style="background:'+C.emerald+'"></span>True</span>';
      el.appendChild(legend);
      // Value rows
      var r = {};
      r.tws = makeRow('TWS', ' kts'); el.appendChild(r.tws.row); r.tws.row.style.display = 'none';
      r.twa = makeRow('TWA', '&deg;'); el.appendChild(r.twa.row); r.twa.row.style.display = 'none';
      r.aws = makeRow('AWS', ' kts'); el.appendChild(r.aws.row);
      r.awa = makeRow('AWA', '&deg;'); el.appendChild(r.awa.row);
      r.aLine = aLine; r.aPoly = aPoly; r.tLine = tLine; r.tPoly = tPoly; r.trueLegend = legend.querySelector('#wind-true-legend');
      el._refs = r;
    }

    var r = el._refs;
    var aws = env.windSpeed, awa = env.windAngle || 0;
    var tws = env.windSpeedTrue, twa = env.windAngleTrue;
    updateArrow(r.aLine, r.aPoly, awa);
    if (twa != null) {
      updateArrow(r.tLine, r.tPoly, twa);
      r.tLine.style.display = ''; r.tPoly.style.display = '';
      r.trueLegend.style.display = '';
      r.tws.setText(fmt(tws, 1)); r.tws.row.style.display = '';
      r.twa.setText(fmt(twa)); r.twa.row.style.display = '';
    } else {
      r.tLine.style.display = 'none'; r.tPoly.style.display = 'none';
      r.trueLegend.style.display = 'none';
      r.tws.row.style.display = 'none'; r.twa.row.style.display = 'none';
    }
    r.aws.setText(fmt(aws, 1));
    r.awa.setText(fmt(awa));
  }

  // ── Position panel (lat/lon + map link) ──
  function renderPositionPanel(el, snap) {
    var nav = snap.navigation || {};
    var pos = nav.position;

    if (!pos) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#128205;</span> Position</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No GPS fix</div>';
      return;
    }

    // Parse "lat, lon" string
    var parts = pos.split(',');
    var lat = parts[0] ? parts[0].trim() : '--';
    var lon = parts[1] ? parts[1].trim() : '--';
    var mapUrl = 'https://www.google.com/maps?q=' + lat + ',' + lon;

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#128205;</span> Position</div>' +
      '<div class="telem-row"><span class="telem-label">Latitude</span><span class="telem-value">' + esc(lat) + '</span></div>' +
      '<div class="telem-row"><span class="telem-label">Longitude</span><span class="telem-value">' + esc(lon) + '</span></div>' +
      '<a class="pos-link" href="' + esc(mapUrl) + '" target="_blank" rel="noopener">Open in Google Maps &#8599;</a>';
  }

  // ── Scenario control bar (dev mode only) ──
  function renderScenarioControl(el, currentScenario) {
    // Only show scenarios in dev mode (?dev=1) or for demo users
    var isDev = window.location.search.indexOf('dev=1') !== -1;
    var user = null;
    try { user = JSON.parse(localStorage.getItem('mc_user')); } catch(e) {}
    var isDemo = user && user.email && user.email.indexOf('@demo.mc') !== -1;
    if (!isDev && !isDemo) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '';
    var scenarios = ['atAnchor', 'motoring', 'sailing', 'charging', 'shorepower', 'alarm'];
    var intelligenceScenarios = ['windShift', 'weatherBuilding', 'nightPassage', 'approachingPort', 'crossingCurrent', 'heavyWeather', 'manOverboard'];
    var labels = {
      atAnchor: 'At Anchor', motoring: 'Motoring', sailing: 'Sailing', charging: 'Charging', shorepower: 'Shore Power', alarm: 'Alarm',
      windShift: 'Wind Shift', weatherBuilding: 'Weather Build', nightPassage: 'Night Passage',
      approachingPort: 'Port Approach', crossingCurrent: 'Current', heavyWeather: 'Heavy Weather', manOverboard: 'MOB',
    };

    function makeBtn(name, isIntel) {
      var btn = document.createElement('button');
      btn.className = 'scenario-btn' + (name === currentScenario ? ' active' : '') + (isIntel ? ' intel' : '');
      btn.textContent = labels[name] || name;
      btn.setAttribute('data-scenario', name);
      btn.addEventListener('click', function() {
        var n = this.getAttribute('data-scenario');
        fetch('/api/telemetry/scenario/' + n, { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            el.querySelectorAll('.scenario-btn').forEach(function(b) { b.classList.remove('active'); });
            var active = el.querySelector('[data-scenario="' + d.scenario + '"]');
            if (active) active.classList.add('active');
          })
          .catch(function() {});
      });
      return btn;
    }

    var group1 = document.createElement('div');
    group1.className = 'scenario-group';
    for (var i = 0; i < scenarios.length; i++) group1.appendChild(makeBtn(scenarios[i], false));
    el.appendChild(group1);

    var divider = document.createElement('div');
    divider.className = 'scenario-divider';
    divider.textContent = 'Intelligence';
    el.appendChild(divider);

    var group2 = document.createElement('div');
    group2.className = 'scenario-group';
    for (var j = 0; j < intelligenceScenarios.length; j++) group2.appendChild(makeBtn(intelligenceScenarios[j], true));
    el.appendChild(group2);
  }

  // ============================================================
  // INTELLIGENCE PANELS
  // ============================================================

  // ── Advisor panel (recommendations) ──
  var _dismissedRecs = {};
  function renderAdvisorPanel(el, snap) {
    var recs = (snap._advisor || []).filter(function(r) { return !_dismissedRecs[r.id]; });
    var urgencyIcons = { critical: '&#128680;', advisory: '&#9888;&#65039;', suggestion: '&#128161;', info: '&#8505;&#65039;' };
    var urgencyLabels = { critical: 'CRITICAL', advisory: 'ADVISORY', suggestion: 'SUGGESTION', info: 'INFO' };
    var urgencyClasses = { critical: 'rec-critical', advisory: 'rec-advisory', suggestion: 'rec-suggestion', info: 'rec-info' };

    if (recs.length === 0) {
      el.innerHTML =
        '<div class="telem-panel-title"><span>&#129504;</span> Advisor</div>' +
        '<div style="color:var(--slate);font-size:.82rem;text-align:center;padding:20px">All optimal &mdash; no recommendations</div>';
      return;
    }

    var html = '<div class="telem-panel-title"><span>&#129504;</span> Advisor <span class="rec-count">' + recs.length + ' active</span></div>';

    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var cls = urgencyClasses[r.urgency] || 'rec-info';
      var icon = urgencyIcons[r.urgency] || '';
      var label = urgencyLabels[r.urgency] || 'INFO';
      var ago = r.createdAt ? Math.round((Date.now() - r.createdAt) / 60000) : 0;
      var agoStr = ago < 1 ? 'just now' : ago + 'min ago';

      html +=
        '<div class="rec-card ' + cls + '">' +
        '<div class="rec-header">' +
        '<span class="rec-badge ' + cls + '">' + icon + ' ' + esc(label) + '</span>' +
        '<span class="rec-time">' + esc(agoStr) + '</span>' +
        '</div>' +
        '<div class="rec-title">' + esc(r.title) + '</div>' +
        '<div class="rec-reasoning">' + esc(r.reasoning) + '</div>' +
        (r.impact ? '<div class="rec-impact">' + esc(r.impact) + '</div>' : '') +
        '<div class="rec-actions">' +
        '<button class="rec-btn rec-accept" data-rec-id="' + esc(r.id) + '">Agree</button>' +
        '<button class="rec-btn rec-dismiss" data-rec-id="' + esc(r.id) + '">Dismiss</button>' +
        '<button class="rec-btn rec-why" data-rec-id="' + esc(r.id) + '">Why?</button>' +
        '</div></div>';
    }

    el.innerHTML = html;

    // Wire up buttons
    el.onclick = function(e) {
      var btn = e.target.closest('.rec-btn');
      if (!btn) return;
      var id = btn.getAttribute('data-rec-id');
      if (!id) return;
      if (btn.classList.contains('rec-accept')) {
        _dismissedRecs[id] = true;
        fetch('/api/advisor/accept/' + id, { method: 'POST' });
        btn.closest('.rec-card').style.opacity = '0.4';
        btn.closest('.rec-card').innerHTML = '<div style="padding:8px;color:var(--emerald)">&#10003; Accepted — applied</div>';
      } else if (btn.classList.contains('rec-dismiss')) {
        _dismissedRecs[id] = true;
        fetch('/api/advisor/dismiss/' + id, { method: 'POST' });
        btn.closest('.rec-card').remove();
        // Update count
        var countEl = el.querySelector('.rec-count');
        var remaining = el.querySelectorAll('.rec-card').length;
        if (countEl) countEl.textContent = remaining > 0 ? remaining + ' active' : '';
        if (remaining === 0) el.querySelector('.rec-count')?.parentElement?.insertAdjacentHTML('afterend', '<div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">All optimal</div>');
      } else if (btn.classList.contains('rec-why')) {
        fetch('/api/advisor/explain/' + id).then(function(r) { return r.json(); }).then(function(data) {
          var card = btn.closest('.rec-card');
          var existing = card.querySelector('.rec-explain');
          if (existing) { existing.remove(); return; }
          var explain = document.createElement('div');
          explain.className = 'rec-explain';
          explain.innerHTML = '<strong>Full context:</strong><br>' + esc(data.reasoning || 'No additional details.');
          if (data.action) explain.innerHTML += '<br><strong>Action:</strong> ' + esc(JSON.stringify(data.action));
          if (data.alternatives && data.alternatives.length) {
            explain.innerHTML += '<br><strong>Alternatives:</strong>';
            for (var a = 0; a < data.alternatives.length; a++) {
              explain.innerHTML += '<br>&bull; ' + esc(data.alternatives[a].note || '') + ' (' + esc(data.alternatives[a].heading) + '&deg;M, ' + esc(data.alternatives[a].vmg) + 'kts VMG)';
            }
          }
          card.appendChild(explain);
        });
      }
    };
  }

  // ── Performance panel (polar %) ──
  function renderPerformancePanel(el, snap) {
    // Fetch from dedicated endpoint for polar data
    var env = snap.environment || {};
    var nav = snap.navigation || {};
    var tws = env.windSpeedTrue;
    var twa = env.windAngleTrue;
    var sog = nav.sog;

    if (tws == null || twa == null || sog == null || sog < 0.5) {
      el.innerHTML =
        '<div class="telem-panel-title"><span>&#128200;</span> Performance</div>' +
        '<div style="color:var(--slate);font-size:.82rem;text-align:center;padding:20px">Not sailing &mdash; performance N/A</div>';
      return;
    }

    // Use cached performance data if available (set by async fetch)
    var perf = el._perfData || {};
    var pct = perf.performance || '--';
    var target = perf.targetSpeed || '--';
    var pctNum = typeof pct === 'number' ? pct : 0;
    var pctColor = pctNum >= 90 ? 'var(--emerald)' : pctNum >= 70 ? 'var(--amber)' : pctNum > 0 ? 'var(--red)' : 'var(--slate)';

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#128200;</span> Performance</div>' +
      '<div class="perf-big" style="color:' + pctColor + '">' + pct + '<span class="perf-unit">%</span></div>' +
      '<div class="perf-label">of polar</div>' +
      '<div class="perf-details">' +
      '<div class="telem-row"><span class="telem-label">TWA</span><span class="telem-value">' + fmt(twa) + '&deg;' + (perf.optimalBeatAngle ? ' <span class="telem-unit">(beat: ' + perf.optimalBeatAngle + '&deg;)</span>' : '') + '</span></div>' +
      '<div class="telem-row"><span class="telem-label">TWS</span><span class="telem-value">' + fmt(tws, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Target Speed</span><span class="telem-value">' + fmt(target, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Actual Speed</span><span class="telem-value">' + fmt(sog, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '</div>';

    // Async fetch performance data (single-flight guard)
    if (!el._perfInFlight && (!el._perfTimer || Date.now() - el._perfTimer > 5000)) {
      el._perfTimer = Date.now();
      el._perfInFlight = true;
      fetch('/api/performance').then(function(r) { return r.json(); }).then(function(d) {
        el._perfData = d;
      }).catch(function() {}).then(function() { el._perfInFlight = false; });
    }
  }

  // Energy panel removed — merged into Battery panel above.
  // renderEnergyPanel kept as no-op for backwards compat with existing localStorage panel orders.
  function renderEnergyPanel(el, snap) {
    if (el) el.style.display = 'none';
    var wrap = el && el.closest('.telem-drag-box');
    if (wrap) wrap.style.display = 'none';
  }

  // ── Alert ticker ──
  var _dismissedAlerts = {};
  var _silencedAlerts = {};

  function alertKey(a) { return (a.message || '') + '|' + (a.severity || ''); }

  function renderAlertTicker(el, alerts) {
    if (!alerts || alerts.length === 0) {
      el.innerHTML = '<div class="alert-empty">No recent alerts</div>';
      return;
    }

    // Filter out dismissed alerts
    var visible = [];
    for (var i = 0; i < alerts.length; i++) {
      if (!_dismissedAlerts[alertKey(alerts[i])]) visible.push(alerts[i]);
    }
    if (visible.length === 0) {
      el.innerHTML = '<div class="alert-empty">All alerts dismissed</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < visible.length; i++) {
      var a = visible[i];
      var key = alertKey(a);
      var sev = a.severity || 'info';
      var silenced = _silencedAlerts[key];
      var time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      html +=
        '<div class="alert-item ' + esc(sev) + (silenced ? ' silenced' : '') + '" data-alert-key="' + esc(key) + '">' +
        '<div class="alert-actions">' +
        '<button class="alert-btn alert-silence" title="' + (silenced ? 'Unsilence' : 'Silence') + '">' + (silenced ? '&#128276;' : '&#128263;') + '</button>' +
        '<button class="alert-btn alert-dismiss" title="Dismiss">&times;</button>' +
        '</div>' +
        '<div>' + esc(a.message) + '</div>' +
        '<div class="alert-time">' + esc(time) + (silenced ? ' &middot; Silenced' : '') + '</div>' +
        '</div>';
    }
    el.innerHTML = html;

    // Attach handlers via delegation
    el.onclick = function(e) {
      var btn = e.target.closest('.alert-btn');
      if (!btn) return;
      var item = btn.closest('.alert-item');
      var key = item ? item.getAttribute('data-alert-key') : null;
      if (!key) return;
      if (btn.classList.contains('alert-dismiss')) {
        _dismissedAlerts[key] = true;
        delete _silencedAlerts[key];
        if (item) item.remove();
        if (!el.querySelector('.alert-item')) el.innerHTML = '<div class="alert-empty">All alerts dismissed</div>';
      } else if (btn.classList.contains('alert-silence')) {
        if (_silencedAlerts[key]) delete _silencedAlerts[key];
        else _silencedAlerts[key] = true;
      }
    };
  }

  // ============================================================
  // ENERGY FLOW MODAL (Victron VRM–style)
  // ============================================================

  function renderEnergyFlow(el, snap) {
    var batts = snap.batteries || {};
    var b = batts.house || {};
    var elec = snap.electrical || {};

    var soc = b.soc != null ? b.soc : 0;
    var voltage = b.voltage != null ? b.voltage : 0;
    var current = b.current != null ? b.current : 0;
    var battPower = Math.round(voltage * current);
    var charging = current > 0.5;
    var discharging = current < -0.5;

    var shoreConn = elec.shore ? elec.shore.connected : false;
    var shoreV = elec.shore ? Math.round(elec.shore.voltage) : 0;
    var genRunning = elec.generator ? elec.generator.running : false;
    var genV = elec.generator ? Math.round(elec.generator.voltage) : 0;
    var genHrs = elec.generator ? elec.generator.hours : 0;
    var solarW = elec.solar ? Math.round(elec.solar.power) : 0;

    // Estimate loads from available data
    var acLoad = 0, dcLoad = 0;
    if (shoreConn) acLoad = Math.round(shoreV * 5);
    else if (genRunning) acLoad = Math.round(genV * 3);
    if (discharging) {
      var drain = Math.abs(battPower);
      if (!shoreConn && !genRunning) { acLoad = Math.round(drain * 0.3); dcLoad = drain - acLoad; }
      else dcLoad = drain;
    }
    if (charging && solarW > 0) dcLoad = Math.round(solarW * 0.15);

    // Flow direction helpers
    var shoreAct = shoreConn;
    var genAct = genRunning;
    var solarAct = solarW > 5;
    var invDir = charging ? 'in' : discharging ? 'out' : 'idle';

    function card(id, icon, label, val1, val2, active, color) {
      return '<div class="ef-card' + (active ? ' active' : '') + '" data-ef="' + id + '" style="--ef-accent:' + color + '">' +
        '<div class="ef-icon">' + icon + '</div>' +
        '<div class="ef-label">' + label + '</div>' +
        '<div class="ef-val">' + val1 + '</div>' +
        (val2 ? '<div class="ef-val2">' + val2 + '</div>' : '') +
        '</div>';
    }

    function flow(from, to, active, dir) {
      return '<div class="ef-flow ef-flow-' + from + '-' + to + (active ? ' active' : '') + (dir ? ' ' + dir : '') + '"><div class="ef-flow-dot"></div></div>';
    }

    // Battery state text
    var battLabel = charging ? 'Charging' : discharging ? 'Discharging' : 'Idle';
    var battColor = charging ? '#10B981' : discharging ? '#F59E0B' : '#64748B';

    // Time to go
    var ttg = '';
    if (discharging && Math.abs(battPower) > 5) {
      var hrs = Math.round((1700 * 24 * (soc / 100)) / Math.abs(battPower));
      ttg = (hrs > 200 ? '200+' : hrs) + 'h remaining';
    }

    el.innerHTML =
      '<div class="ef-grid">' +
      // Row 1: Shore/Gen → Inverter → AC Loads
      card('shore', '&#9879;', 'Shore Power', shoreAct ? shoreV + ' V' : 'Disconnected', shoreAct ? 'Connected' : '', shoreAct, '#3B82F6') +
      card('inv', '&#9889;', 'Inverter / Charger', (battPower > 0 ? '+' : '') + battPower + ' W', invDir === 'in' ? 'Charging' : invDir === 'out' ? 'Inverting' : 'Standby', invDir !== 'idle', '#0EA5E9') +
      card('ac', '&#9889;', 'AC Loads', acLoad + ' W', '', acLoad > 0, '#8B5CF6') +
      // Row 2: Solar → Battery → DC Loads
      card('solar', '&#9788;', 'Solar', solarAct ? solarW + ' W' : '0 W', solarAct ? 'Harvesting' : 'No output', solarAct, '#EAB308') +
      card('batt', '&#128267;', 'Battery', soc + '%', fmt(voltage, 1) + ' V &middot; ' + fmt(Math.abs(current), 1) + ' A', true, battColor) +
      card('dc', '&#9881;', 'DC Loads', dcLoad + ' W', '', dcLoad > 0, '#F43F5E') +
      '</div>' +
      // Flow connectors
      '<div class="ef-flows">' +
      flow('shore', 'inv', shoreAct, 'right') +
      flow('inv', 'ac', acLoad > 0, 'right') +
      flow('solar', 'batt', solarAct, 'right') +
      flow('batt', 'dc', dcLoad > 0, 'right') +
      flow('inv', 'batt', invDir !== 'idle', invDir === 'in' ? 'down' : 'up') +
      flow('gen', 'inv', genAct, 'right') +
      '</div>' +
      // Battery bar
      '<div class="ef-batt-bar">' +
      '<div class="ef-batt-fill" style="width:' + Math.max(1, soc) + '%;background:' + battColor + '"></div>' +
      '</div>' +
      '<div class="ef-batt-meta">' +
      '<span>' + battLabel + '</span>' +
      (ttg ? '<span>' + ttg + '</span>' : '') +
      '</div>' +
      // Generator row (below main grid)
      '<div class="ef-gen-row">' +
      card('gen', '&#9881;', 'Generator', genAct ? genV + ' V' : 'Off', genAct ? 'Running &middot; ' + genHrs + ' hrs' : genHrs + ' hrs total', genAct, '#F59E0B') +
      '</div>';
  }

  // ── AIS panel (nearby vessels) ──
  function renderAisPanel(el, snap) {
    var ais = snap._ais;
    if (!ais || !Array.isArray(ais) || ais.length === 0) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#128674;</span> AIS Traffic</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No vessels nearby</div>';
      return;
    }

    var sorted = ais.slice().sort(function(a, b) {
      return (a.distance || Infinity) - (b.distance || Infinity);
    });
    sorted = sorted.slice(0, 10);

    var rows = '';
    for (var i = 0; i < sorted.length; i++) {
      var v = sorted[i];
      var name = v.name || v.mmsi || 'Unknown';
      var dist = v.distance != null ? fmt(v.distance, 1) + ' nm' : '--';
      var spd = v.sog != null ? fmt(v.sog, 1) + ' kts' : '--';
      var bearing = v.bearing != null ? fmt(v.bearing) + '\u00B0' : '--';
      var cpa = v.cpa != null ? fmt(v.cpa, 2) + ' nm' : '';
      var tcpa = v.tcpa != null ? fmt(v.tcpa, 0) + ' min' : '';
      var dangerCls = v.cpa != null && v.cpa < 0.5 ? ' ais-danger' : v.cpa != null && v.cpa < 1.0 ? ' ais-caution' : '';

      rows +=
        '<div class="ais-vessel' + dangerCls + '">' +
        '<div class="ais-vessel-header">' +
        '<span class="ais-name">' + esc(name) + '</span>' +
        '<span class="ais-dist">' + dist + '</span>' +
        '</div>' +
        '<div class="ais-vessel-details">' +
        '<span>SOG ' + spd + '</span>' +
        '<span>BRG ' + bearing + '</span>' +
        (cpa ? '<span>CPA ' + cpa + '</span>' : '') +
        (tcpa ? '<span>TCPA ' + tcpa + '</span>' : '') +
        '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#128674;</span> AIS Traffic <span class="ais-count">' + sorted.length + (ais.length > 10 ? '+' : '') + '</span></div>' +
      '<div class="ais-vessel-list">' + rows + '</div>';
  }

  // ============================================================
  // PUBLIC API — used by dashboard.js
  // ============================================================
  window.MCTelemetry = {
    Client: TelemetryClient,
    renderNavPanel: renderNavPanel,
    renderBatteryPanel: renderBatteryPanel,
    renderEnginePanel: renderEnginePanel,
    renderTanksPanel: renderTanksPanel,
    renderWindPanel: renderWindPanel,
    renderPositionPanel: renderPositionPanel,
    renderScenarioControl: renderScenarioControl,
    renderAlertTicker: renderAlertTicker,
    renderEnergyFlow: renderEnergyFlow,
    // Intelligence panels
    renderAdvisorPanel: renderAdvisorPanel,
    renderPerformancePanel: renderPerformancePanel,
    renderEnergyPanel: renderEnergyPanel,
    renderAisPanel: renderAisPanel,
  };

})();
