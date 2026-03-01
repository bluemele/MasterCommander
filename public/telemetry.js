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

  // ── Navigation panel (SOG, heading, depth, water temp) ──
  function renderNavPanel(el, snap) {
    var nav = snap.navigation || {};
    var env = snap.environment || {};
    el.innerHTML =
      '<div class="telem-panel-title"><span>&#9881;</span> Navigation</div>' +
      '<div class="telem-row"><span class="telem-label">SOG</span><span class="telem-value">' + fmt(nav.sog, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Heading</span><span class="telem-value">' + fmt(nav.heading) + '<span class="telem-unit">&deg;</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">COG</span><span class="telem-value">' + fmt(nav.cog) + '<span class="telem-unit">&deg;</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Depth</span><span class="telem-value' + (env.depth != null && env.depth < 3 ? ' warn' : '') + '">' + fmt(env.depth, 1) + '<span class="telem-unit">m</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Water Temp</span><span class="telem-value">' + fmt(env.waterTemp, 1) + '<span class="telem-unit">&deg;C</span></span></div>';
  }

  // ── Battery panel (SVG arc gauges) ──
  function renderBatteryPanel(el, snap) {
    var batts = snap.batteries || {};
    var keys = Object.keys(batts);
    if (keys.length === 0) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#128267;</span> Batteries</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No batteries detected</div>';
      return;
    }

    var gauges = '';
    for (var i = 0; i < keys.length; i++) {
      var b = batts[keys[i]];
      var soc = b.soc != null ? b.soc : 0;
      var color = soc > 50 ? C.emerald : soc > 20 ? C.amber : C.red;
      var cls = soc > 50 ? 'good' : soc > 20 ? 'warn' : 'crit';

      // SVG arc: 180deg arc from -90 to +90
      var r = 30, cx = 40, cy = 40;
      var angle = (soc / 100) * Math.PI;
      var x = cx + r * Math.cos(Math.PI - angle);
      var y = cy - r * Math.sin(Math.PI - angle);
      var large = soc > 50 ? 1 : 0;
      var arcPath = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x.toFixed(1) + ' ' + y.toFixed(1);
      var bgPath = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy;

      gauges +=
        '<div class="batt-gauge">' +
        '<svg viewBox="0 0 80 50">' +
        '<path d="' + bgPath + '" fill="none" stroke="' + C.border + '" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="' + arcPath + '" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round"/>' +
        '</svg>' +
        '<div class="batt-gauge-pct ' + cls + '">' + fmt(soc) + '%</div>' +
        '<div class="batt-gauge-label">' + esc(keys[i]) + '</div>' +
        '</div>';
    }

    var details = '';
    for (var j = 0; j < keys.length; j++) {
      var bt = batts[keys[j]];
      details +=
        '<div class="telem-row"><span class="telem-label">' + esc(keys[j]) + ' V</span><span class="telem-value">' + fmt(bt.voltage, 1) + '<span class="telem-unit">V</span></span></div>' +
        '<div class="telem-row"><span class="telem-label">' + esc(keys[j]) + ' A</span><span class="telem-value' + (bt.current > 0 ? ' good' : '') + '">' + (bt.current > 0 ? '+' : '') + fmt(bt.current, 1) + '<span class="telem-unit">A</span></span></div>';
    }

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#128267;</span> Batteries</div>' +
      '<div class="batt-row">' + gauges + '</div>' + details;
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

      blocks +=
        '<div class="engine-block">' +
        '<div class="engine-id">' + esc(keys[i]) + (e.running ? ' &#x25CF;' : '') + '</div>' +
        '<div class="rpm-bar-wrap"><div class="rpm-bar"><div class="rpm-bar-fill ' + barCls + '" style="width:' + pct.toFixed(0) + '%"></div></div></div>' +
        '<div class="telem-row"><span class="telem-label">RPM</span><span class="telem-value">' + fmt(rpm) + '</span></div>' +
        '<div class="telem-row"><span class="telem-label">Oil</span><span class="telem-value' + (e.oilPressure != null && e.running && e.oilPressure < 25 ? ' crit' : '') + '">' + fmt(e.oilPressure) + '<span class="telem-unit">PSI</span></span></div>' +
        '<div class="telem-row"><span class="telem-label">Coolant</span><span class="telem-value' + (e.coolantTemp != null && e.coolantTemp > 95 ? ' crit' : '') + '">' + fmt(e.coolantTemp) + '<span class="telem-unit">&deg;C</span></span></div>' +
        '<div class="telem-row"><span class="telem-label">Exhaust</span><span class="telem-value">' + fmt(e.exhaustTemp) + '<span class="telem-unit">&deg;C</span></span></div>' +
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
      var name = keys[i].replace(/_/g, ' ');
      var fillClass = type === 'fuel' ? 'fuel' : type === 'freshWater' ? 'freshWater' : 'wasteWater';
      var pctColor = level < 15 ? ' crit' : level < 30 ? ' warn' : '';

      bars +=
        '<div class="tank-bar-wrap">' +
        '<div class="tank-bar-header"><span class="tank-bar-name">' + esc(name) + '</span><span class="tank-bar-pct' + pctColor + '">' + fmt(level) + '%</span></div>' +
        '<div class="tank-bar"><div class="tank-bar-fill ' + fillClass + '" style="width:' + Math.max(1, level).toFixed(0) + '%"></div></div>' +
        '</div>';
    }

    el.innerHTML = '<div class="telem-panel-title"><span>&#9981;</span> Tanks</div>' + bars;
  }

  // ── Wind panel (speed + direction) ──
  function renderWindPanel(el, snap) {
    var env = snap.environment || {};
    if (env.windSpeed == null) {
      el.innerHTML = '<div class="telem-panel-title"><span>&#127788;</span> Wind</div><div style="color:var(--slate);font-size:.82rem;text-align:center;padding:12px">No wind instruments</div>';
      return;
    }

    var speed = env.windSpeed;
    var angle = env.windAngle || 0;

    // Simple compass with arrow
    var rad = angle * Math.PI / 180;
    var ax = 40 + 25 * Math.sin(rad);
    var ay = 40 - 25 * Math.cos(rad);
    var compass =
      '<div class="wind-compass"><svg viewBox="0 0 80 80">' +
      '<circle cx="40" cy="40" r="35" fill="none" stroke="' + C.border + '" stroke-width="2"/>' +
      '<text x="40" y="12" text-anchor="middle" font-size="8" font-weight="700" fill="' + C.slate + '">N</text>' +
      '<text x="40" y="76" text-anchor="middle" font-size="8" font-weight="700" fill="' + C.slate + '">S</text>' +
      '<text x="8" y="43" text-anchor="middle" font-size="8" font-weight="700" fill="' + C.slate + '">W</text>' +
      '<text x="72" y="43" text-anchor="middle" font-size="8" font-weight="700" fill="' + C.slate + '">E</text>' +
      '<line x1="40" y1="40" x2="' + ax.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="' + C.sky + '" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="40" cy="40" r="3" fill="' + C.sky + '"/>' +
      '</svg></div>';

    el.innerHTML =
      '<div class="telem-panel-title"><span>&#127788;</span> Wind</div>' +
      compass +
      '<div class="telem-row"><span class="telem-label">Apparent Speed</span><span class="telem-value">' + fmt(speed, 1) + '<span class="telem-unit">kts</span></span></div>' +
      '<div class="telem-row"><span class="telem-label">Apparent Angle</span><span class="telem-value">' + fmt(angle) + '<span class="telem-unit">&deg;</span></span></div>';
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
  function renderAlertTicker(el, alerts) {
    if (!alerts || alerts.length === 0) {
      el.innerHTML = '<div class="alert-empty">No recent alerts</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var sev = a.severity || 'info';
      var time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      html +=
        '<div class="alert-item ' + esc(sev) + '">' +
        '<div>' + esc(a.message) + '</div>' +
        '<div class="alert-time">' + esc(time) + '</div>' +
        '</div>';
    }
    el.innerHTML = html;
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
    renderAlertTicker: renderAlertTicker
  };

})();
