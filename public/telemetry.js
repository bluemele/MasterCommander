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
  }

  TelemetryClient.prototype.connect = function() {
    var self = this;
    this.es = new EventSource('/api/telemetry/live');

    this.es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        self.connected = true;
        self.lastSnapshot = data;
        if (self._cb) self._cb(data);
        if (self._statusCb) self._statusCb(true);
      } catch(err) {}
    };

    this.es.addEventListener('status', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (!data.connected) {
          self.connected = false;
          if (self._statusCb) self._statusCb(false);
        }
      } catch(err) {}
    });

    this.es.onerror = function() {
      self.connected = false;
      if (self._statusCb) self._statusCb(false);
    };
  };

  TelemetryClient.prototype.onUpdate = function(cb) { this._cb = cb; };
  TelemetryClient.prototype.onStatus = function(cb) { this._statusCb = cb; };

  TelemetryClient.prototype.disconnect = function() {
    if (this.es) { this.es.close(); this.es = null; }
    this.connected = false;
  };

  // ============================================================
  // GAUGE RENDERERS
  // ============================================================

  // ── Navigation panel (SOG, heading, depth, water temp, position) ──
  function renderNavPanel(el, snap) {
    var nav = snap.navigation || {};
    var env = snap.environment || {};
    var pos = nav.position;
    var posHtml = '';
    if (pos) {
      var parts = pos.split(',');
      var lat = parts[0] ? parts[0].trim() : '--';
      var lon = parts[1] ? parts[1].trim() : '--';
      var mapUrl = 'https://www.google.com/maps?q=' + lat + ',' + lon;
      posHtml =
        '<div class="telem-row"><span class="telem-label">Lat</span><span class="telem-value">' + esc(lat) + '</span></div>' +
        '<div class="telem-row"><span class="telem-label">Lon</span><span class="telem-value">' + esc(lon) + '</span></div>' +
        '<a class="pos-link" href="' + esc(mapUrl) + '" target="_blank" rel="noopener">Google Maps &#8599;</a>';
    }
    el.innerHTML =
      '<div class="telem-panel-title"><span>&#9881;</span> Navigation</div>' +
      '<div class="telem-row"><span class="telem-label">SOG</span><span class="telem-value">' + fmt(nav.sog, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Heading</span><span class="telem-value">' + fmt(nav.heading) + '<span class="telem-unit">&deg;</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">COG</span><span class="telem-value">' + fmt(nav.cog) + '<span class="telem-unit">&deg;</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Depth</span><span class="telem-value' + (env.depth != null && env.depth < 3 ? ' warn' : '') + '">' + fmt(env.depth, 1) + '<span class="telem-unit">m</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Water Temp</span><span class="telem-value">' + fmt(env.waterTemp, 1) + '<span class="telem-unit">&deg;C</span></span></div>' +
      posHtml;
  }

  // ── House Battery panel (Victron VRM style) ──
  function renderBatteryPanel(el, snap) {
    var batts = snap.batteries || {};
    var b = batts.house;
    if (!b) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#128267;</span> House Battery</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No house battery detected</div>';
      return;
    }

    var soc = b.soc != null ? b.soc : 0;
    var voltage = b.voltage != null ? b.voltage : 0;
    var current = b.current != null ? b.current : 0;
    var power = Math.round(voltage * current);
    var absPower = Math.abs(power);
    var charging = current > 0.5;
    var discharging = current < -0.5;
    var stateText = charging ? 'Charging' : discharging ? 'Discharging' : 'Idle';
    var stateIcon = charging ? '&#9889;' : discharging ? '&#128267;' : '&#128267;';
    var stateClass = charging ? 'vrm-charging' : discharging ? 'vrm-discharging' : 'vrm-idle';

    // Time to go estimate (rough: capacity_Ah * voltage * soc / load_watts)
    // Using 1700Ah 24V nominal as default
    var ttg = '';
    if (discharging && absPower > 5) {
      var hoursLeft = Math.round((1700 * 24 * (soc / 100)) / absPower);
      ttg = hoursLeft > 200 ? '200+ h' : hoursLeft + ' h';
    }

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#128267;</span> House Battery</div>' +
      '<div class="vrm-card">' +
      '<div class="vrm-header">' +
      '<span class="vrm-state-badge ' + stateClass + '">' + stateIcon + ' ' + stateText + '</span>' +
      '<span class="vrm-power">' + (power > 0 ? '+' : '') + power + ' W</span>' +
      '</div>' +
      '<div class="vrm-soc">' + fmt(soc) + ' <span>%</span></div>' +
      '<div class="vrm-soc-bar"><div class="vrm-soc-fill ' + stateClass + '" style="width:' + Math.max(1, soc) + '%"></div></div>' +
      '<div class="vrm-details">' +
      '<div class="vrm-row"><span class="vrm-label">Voltage</span><span class="vrm-val">' + fmt(voltage, 2) + ' V</span></div>' +
      '<div class="vrm-row"><span class="vrm-label">Current</span><span class="vrm-val">' + fmt(current, 1) + ' A</span></div>' +
      '<div class="vrm-row"><span class="vrm-label">Power</span><span class="vrm-val">' + (power > 0 ? '+' : '') + power + ' W</span></div>' +
      (ttg ? '<div class="vrm-row"><span class="vrm-label">Time to go</span><span class="vrm-val">' + ttg + '</span></div>' : '') +
      '</div></div>';
  }

  // ── Engine panel (RPM bars + temps) ──
  function renderEnginePanel(el, snap) {
    var engines = snap.engines || {};
    var keys = Object.keys(engines);
    if (keys.length === 0) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#9881;</span> Engines</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No engines detected</div>';
      return;
    }

    var blocks = '';
    for (var i = 0; i < keys.length; i++) {
      var e = engines[keys[i]];
      var rpm = e.rpm || 0;
      var pct = Math.min(100, (rpm / 3500) * 100);
      var barCls = rpm > 3000 ? 'redline' : rpm > 2500 ? 'high' : '';

      // Temperature bar helpers: coolant 0-120°C, exhaust 0-700°C
      var coolant = e.coolantTemp || 0;
      var exhaust = e.exhaustTemp || 0;
      var coolPct = Math.min(100, (coolant / 120) * 100);
      var exhPct = Math.min(100, (exhaust / 700) * 100);
      var coolCls = coolant > 95 ? 'temp-red' : coolant > 85 ? 'temp-amber' : coolant > 40 ? 'temp-green' : '';
      var exhCls = exhaust > 500 ? 'temp-red' : exhaust > 400 ? 'temp-amber' : exhaust > 100 ? 'temp-green' : '';

      blocks +=
        '<div class="engine-block">' +
        '<div class="engine-id">' + esc(keys[i]) + (e.running ? ' <span class="engine-running">Running</span>' : ' <span class="engine-off">Off</span>') + '</div>' +
        '<div class="rpm-bar-wrap"><div class="rpm-bar"><div class="rpm-bar-fill ' + barCls + '" style="width:' + pct.toFixed(0) + '%"></div></div></div>' +
        '<div class="telem-row"><span class="telem-label">RPM</span><span class="telem-value">' + fmt(rpm) + '</span></div>' +
        '<div class="engine-temps">' +
        '<div class="engine-temp-gauge"><div class="engine-temp-header"><span class="telem-label">Coolant</span><span class="telem-value ' + (coolant > 95 ? 'crit' : '') + '">' + fmt(coolant) + '<span class="telem-unit">&deg;C</span></span></div>' +
        '<div class="temp-bar"><div class="temp-bar-fill ' + coolCls + '" style="width:' + coolPct.toFixed(0) + '%"></div></div></div>' +
        '<div class="engine-temp-gauge"><div class="engine-temp-header"><span class="telem-label">Exhaust</span><span class="telem-value ' + (exhaust > 500 ? 'crit' : '') + '">' + fmt(exhaust) + '<span class="telem-unit">&deg;C</span></span></div>' +
        '<div class="temp-bar"><div class="temp-bar-fill ' + exhCls + '" style="width:' + exhPct.toFixed(0) + '%"></div></div></div>' +
        '</div>' +
        '<div class="telem-row"><span class="telem-label">Oil Pressure</span><span class="telem-value' + (e.oilPressure != null && e.running && e.oilPressure < 25 ? ' crit' : '') + '">' + fmt(e.oilPressure) + '<span class="telem-unit">PSI</span></span></div>' +
        '<div class="telem-row"><span class="telem-label">Hours</span><span class="telem-value">' + fmt(e.hours) + '<span class="telem-unit">hrs</span></span></div>' +
        '</div>';
    }

    el.innerHTML = '<div class="telem-panel-title"><span>&#9881;</span> Engines</div>' + blocks;
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
        '<div class="tank-bar"><div class="tank-bar-fill ' + fillClass + '" style="width:' + Math.max(1, level).toFixed(0) + '%"></div></div>' +
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

  // ── Wind panel (apparent + true) ──
  function renderWindPanel(el, snap) {
    var env = snap.environment || {};
    if (env.windSpeed == null) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#127788;</span> Wind</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No wind instruments</div>';
      return;
    }

    var aws = env.windSpeed;
    var awa = env.windAngle || 0;
    var tws = env.windSpeedTrue;
    var twa = env.windAngleTrue;

    // Compass with both apparent (sky) and true (emerald) arrows
    function windArrow(angleDeg, color, label) {
      var rad = angleDeg * Math.PI / 180;
      var ax = 40 + 25 * Math.sin(rad);
      var ay = 40 - 25 * Math.cos(rad);
      // Arrowhead
      var headLen = 6;
      var headAng = 0.4;
      var h1x = ax - headLen * Math.sin(rad - headAng);
      var h1y = ay + headLen * Math.cos(rad - headAng);
      var h2x = ax - headLen * Math.sin(rad + headAng);
      var h2y = ay + headLen * Math.cos(rad + headAng);
      return '<line x1="40" y1="40" x2="' + ax.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '<polygon points="' + ax.toFixed(1) + ',' + ay.toFixed(1) + ' ' + h1x.toFixed(1) + ',' + h1y.toFixed(1) + ' ' + h2x.toFixed(1) + ',' + h2y.toFixed(1) + '" fill="' + color + '"/>';
    }

    var compass =
      '<div class="wind-compass"><svg viewBox="0 0 80 80">' +
      '<circle cx="40" cy="40" r="35" fill="none" stroke="' + C.border + '" stroke-width="1.5"/>' +
      '<text x="40" y="12" text-anchor="middle" font-size="7" font-weight="700" fill="' + C.slate + '">N</text>' +
      '<text x="40" y="76" text-anchor="middle" font-size="7" font-weight="700" fill="' + C.slate + '">S</text>' +
      '<text x="8" y="43" text-anchor="middle" font-size="7" font-weight="700" fill="' + C.slate + '">W</text>' +
      '<text x="72" y="43" text-anchor="middle" font-size="7" font-weight="700" fill="' + C.slate + '">E</text>' +
      windArrow(awa, C.sky, 'A') +
      (twa != null ? windArrow(twa, C.emerald, 'T') : '') +
      '<circle cx="40" cy="40" r="2.5" fill="' + C.text + '"/>' +
      '</svg></div>' +
      '<div class="wind-legend">' +
      '<span class="wind-legend-item"><span style="background:' + C.sky + '"></span>Apparent</span>' +
      (twa != null ? '<span class="wind-legend-item"><span style="background:' + C.emerald + '"></span>True</span>' : '') +
      '</div>';

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#127788;</span> Wind</div>' +
      compass +
      (tws != null ? '<div class="telem-row"><span class="telem-label">True Wind Speed (TWS)</span><span class="telem-value">' + fmt(tws, 1) + '<span class="telem-unit">kts</span></span></div>' : '') +
      (twa != null ? '<div class="telem-row"><span class="telem-label">True Wind Angle (TWA)</span><span class="telem-value">' + fmt(twa) + '<span class="telem-unit">&deg;</span></span></div>' : '') +
      '<div class="telem-row"><span class="telem-label">Apparent Wind Speed (AWS)</span><span class="telem-value">' + fmt(aws, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Apparent Wind Angle (AWA)</span><span class="telem-value">' + fmt(awa) + '<span class="telem-unit">&deg;</span></span></div>';
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

  // ── Scenario control bar ──
  function renderScenarioControl(el, currentScenario) {
    el.innerHTML = '';
    var scenarios = ['atAnchor', 'motoring', 'sailing', 'charging', 'shorepower', 'alarm'];
    var labels = { atAnchor: 'At Anchor', motoring: 'Motoring', sailing: 'Sailing', charging: 'Charging', shorepower: 'Shore Power', alarm: 'Alarm' };

    for (var i = 0; i < scenarios.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'scenario-btn' + (scenarios[i] === currentScenario ? ' active' : '');
      btn.textContent = labels[scenarios[i]] || scenarios[i];
      btn.setAttribute('data-scenario', scenarios[i]);
      btn.addEventListener('click', function() {
        var name = this.getAttribute('data-scenario');
        fetch('/api/telemetry/scenario/' + name, { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            // Update active state
            el.querySelectorAll('.scenario-btn').forEach(function(b) { b.classList.remove('active'); });
            el.querySelector('[data-scenario="' + d.scenario + '"]').classList.add('active');
          })
          .catch(function() {});
      });
      el.appendChild(btn);
    }
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
    renderEnergyFlow: renderEnergyFlow
  };

})();
