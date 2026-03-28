(function() {
  'use strict';

  // ── Auth helpers (cookie-based) ──
  function getUser() {
    try { return JSON.parse(localStorage.getItem('mc_user')); } catch(e) { return null; }
  }
  function authHeaders() {
    return { 'Content-Type': 'application/json' };
  }
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // ── API (credentials: include sends httpOnly cookie) ──
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: authHeaders(), credentials: 'include' }, opts || {}));
    if (res.status === 401) throw new Error('Not authenticated');
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('json') === -1) throw new Error('API unavailable');
    if (res.status === 403) {
      var errData = await res.json();
      if (errData.error && errData.error.indexOf('subscription') !== -1) {
        navigate('#/billing');
      }
      throw new Error(errData.error || 'Access denied');
    }
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  async function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
  async function apiPut(path, body) { return api(path, { method: 'PUT', body: JSON.stringify(body) }); }
  async function apiDelete(path) { return api(path, { method: 'DELETE' }); }

  // ── Router ──
  var app = document.getElementById('app');
  var currentRoute = '';

  function navigate(hash) {
    if (hash !== window.location.hash) window.location.hash = hash;
  }

  function getRoute() {
    var h = window.location.hash || '#/';
    return h.replace(/^#/, '') || '/';
  }

  function onRoute() {
    var path = getRoute();
    if (path === currentRoute) return;
    // Cleanup telemetry when leaving boat page
    if (currentRoute && currentRoute.match(/^\/boat\//) && !path.match(/^\/boat\//)) {
      cleanupTelemetry();
    }
    // Cleanup weather map when leaving weather page
    if (currentRoute === '/weather' && path !== '/weather') {
      if (window.MCWeatherUI) window.MCWeatherUI.cleanup();
    }
    currentRoute = path;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
      var route = tab.getAttribute('data-route');
      if (route === 'fleet' && (path === '/' || path.startsWith('/boat/'))) tab.classList.add('active');
      else if (route === 'weather' && path === '/weather') tab.classList.add('active');
      else if (route === 'billing' && path === '/billing') tab.classList.add('active');
      else if (route === 'settings' && path === '/settings') tab.classList.add('active');
      else tab.classList.remove('active');
    });

    // Dispatch
    if (path === '/' || path === '') renderFleet();
    else if (path.match(/^\/boat\/(-?\d+)$/)) renderBoat(parseInt(path.match(/^\/boat\/(-?\d+)$/)[1]));
    else if (path === '/weather') { if (window.MCWeatherUI) window.MCWeatherUI.init(); }
    else if (path === '/billing') renderBilling();
    else if (path === '/settings') renderSettings();
    else renderFleet();
  }

  window.addEventListener('hashchange', onRoute);

  // ── Set user name in nav ──
  var user = getUser();
  if (user) document.getElementById('nav-user-name').textContent = user.name ? user.name.split(' ')[0] : '';

  // ── Auth (logout) ──
  window.mcAuth = {
    logout: function() {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(function(){});
      window.location.href = 'index.html';
    }
  };

  // ── Fleet Overview ──
  async function renderFleet() {
    app.innerHTML = '<div class="fleet-header"><h1 id="fleet-title">Loading...</h1><div id="fleet-actions"></div></div><div id="fleet-grid" class="fleet-grid"><p style="color:var(--slate)">Loading...</p></div>';
    try {
      var data;
      try {
        data = await api('/api/boats');
      } catch (e) {
        // API unavailable or not authenticated — show demo prompt
        var grid = document.getElementById('fleet-grid');
        var title = document.getElementById('fleet-title');
        if (title) title.textContent = 'Welcome to MasterCommander';
        if (grid) grid.innerHTML =
          '<div style="text-align:center;padding:40px 20px">' +
          '<div style="font-size:2.5rem;margin-bottom:12px">&#9973;</div>' +
          '<h2 style="margin-bottom:8px">Your Fleet</h2>' +
          '<p style="color:var(--slate);margin-bottom:20px">Sign in to see your boats, or try the demo to explore.</p>' +
          '<button class="btn btn-sky" onclick="document.getElementById(\'demo-btn\').click()" style="font-size:.9rem;padding:10px 24px">Try Demo Mode</button>' +
          '</div>';
        return;
      }
      var sub = data.subscription || {};
      var grid = document.getElementById('fleet-grid');
      var title = document.getElementById('fleet-title');
      var actions = document.getElementById('fleet-actions');

      // Paywall — no active plan
      if (sub.requiresPlan) {
        title.textContent = 'Get Started';
        actions.innerHTML = '';
        var plans = data.planOptions || [];
        grid.innerHTML =
          '<div class="paywall-card"><div class="paywall-icon">&#9875;</div>' +
          '<h2>Subscribe to start monitoring your boat</h2>' +
          '<p>Choose a plan to unlock real-time telemetry, alerts, and AI-powered diagnostics.</p>' +
          '<div class="paywall-plans">' + plans.map(function(p) {
            return '<div class="paywall-plan"><div class="paywall-plan-name">' + esc(p.name) + '</div>' +
              '<div class="paywall-plan-price">$' + (p.amount / 100).toFixed(0) + '<span>/' + esc(p.interval) + '</span></div>' +
              '<div class="paywall-plan-desc">' + esc(p.description) + '</div></div>';
          }).join('') + '</div>' +
          '<button class="btn btn-sky" onclick="window.location.hash=\'#/billing\'">View Plans &amp; Subscribe</button>' +
          '</div>';
        return;
      }

      // Active plan — show header + badge
      var headerText = sub.header || 'My Boat';
      var planName = sub.plan ? (sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)) : '';
      title.innerHTML = esc(headerText) + (planName ? ' <span class="plan-badge">' + esc(planName) + '</span>' : '');

      // Add Boat button (disabled at limit)
      var atLimit = sub.boatCount >= sub.maxBoats;
      actions.innerHTML = '<button class="btn btn-sky' + (atLimit ? ' disabled' : '') + '" ' +
        (atLimit ? 'disabled title="Plan limit reached (' + esc(String(sub.maxBoats)) + ' boats)"' : 'onclick="window._addBoat()"') +
        '>+ Add Boat</button>' +
        '<span class="fleet-count">' + esc(String(sub.boatCount || 0)) + '/' + esc(String(sub.maxBoats || 0)) + ' boats</span>';

      if (!data.boats || data.boats.length === 0) {
        grid.innerHTML = '<div class="fleet-empty"><p>No boats registered yet. Add your first boat to get started.</p></div>';
        return;
      }
      // Single boat — go straight to boat page
      if (data.boats.length === 1) {
        navigate('#/boat/' + data.boats[0].id);
        return;
      }
      grid.innerHTML = '';
      data.boats.forEach(function(b) {
        var card = document.createElement('div');
        card.className = 'boat-card';
        card.onclick = function() { navigate('#/boat/' + b.id); };
        var statusLabel = b.status || 'inactive';
        var photo = b.photo_url
          ? '<img src="' + esc(b.photo_url) + '" alt="' + esc(b.name) + '">'
          : '<span class="placeholder-icon">&#9973;</span>';
        card.innerHTML =
          '<div class="boat-card-photo">' + photo +
          '<div class="boat-card-status"><span class="status-dot ' + esc(statusLabel) + '"></span>' + esc(statusLabel) + '</div></div>' +
          '<div class="boat-card-body"><h3>' + esc(b.name) + '</h3><div class="boat-meta">' +
          (b.model ? '<span>' + esc(b.model) + (b.year ? ' (' + esc(b.year) + ')' : '') + '</span>' : '') +
          (b.home_port ? '<span>' + esc(b.home_port) + '</span>' : '') +
          '</div></div>';
        grid.appendChild(card);
      });
    } catch (e) {
      document.getElementById('fleet-grid').innerHTML = '<p style="color:var(--red)">' + esc(e.message) + '</p>';
    }
  }

  // ── Add/Edit Boat Modal ──
  window._addBoat = function() { showBoatModal(null); };

  function showBoatModal(boat) {
    var existing = document.getElementById('boat-modal');
    if (existing) existing.remove();

    var isEdit = !!boat;
    var m = document.createElement('div');
    m.id = 'boat-modal';
    m.className = 'modal-overlay open';
    m.innerHTML =
      '<div class="modal"><button class="modal-close" onclick="document.getElementById(\'boat-modal\').remove()">&times;</button>' +
      '<h2>' + (isEdit ? 'Edit Boat' : 'Add Boat') + '</h2>' +
      '<div class="modal-form" id="boat-form">' +
      '<label>Boat Name *<input id="bf-name" value="' + esc(boat ? boat.name : '') + '"></label>' +
      '<label>Model<input id="bf-model" value="' + esc(boat ? boat.model : '') + '"></label>' +
      '<label>Year<input type="number" id="bf-year" min="1900" max="2099" value="' + esc(boat ? boat.year : '') + '"></label>' +
      '<label>Boat Type<select id="bf-type"><option value="">Select...</option>' +
      ['Sailing Catamaran','Sailing Monohull','Motor Yacht','Trawler','Center Console','Sport Fisher','Cruiser','Pontoon','Other'].map(function(t) {
        return '<option' + (boat && boat.boat_type === t ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></label>' +
      '<label>Length (ft)<input type="number" step="0.1" id="bf-length" value="' + esc(boat ? boat.length_ft : '') + '"></label>' +
      '<label>Beam (ft)<input type="number" step="0.1" id="bf-beam" value="' + esc(boat ? boat.beam_ft : '') + '"></label>' +
      '<label>Draft (ft)<input type="number" step="0.1" id="bf-draft" value="' + esc(boat ? boat.draft_ft : '') + '"></label>' +
      '<label>MMSI<input id="bf-mmsi" value="' + esc(boat ? boat.mmsi : '') + '"></label>' +
      '<label>Home Port<input id="bf-port" value="' + esc(boat ? boat.home_port : '') + '"></label>' +
      '<label>Registration<input id="bf-reg" value="' + esc(boat ? boat.registration : '') + '"></label>' +
      '<label>Flag<input id="bf-flag" value="' + esc(boat ? boat.flag : '') + '"></label>' +
      '<label>Engine Type<input id="bf-engine" placeholder="e.g. 2x Yanmar 110hp" value="' + esc(boat ? boat.engine_type : '') + '"></label>' +
      '<label>Engine Count<input type="number" id="bf-engines" min="0" max="10" value="' + esc(boat ? boat.engine_count : '1') + '"></label>' +
      '<label>Fuel Capacity (L)<input type="number" id="bf-fuel" value="' + esc(boat ? boat.fuel_capacity : '') + '"></label>' +
      '<label>Water Capacity (L)<input type="number" id="bf-water" value="' + esc(boat ? boat.water_capacity : '') + '"></label>' +
      '<label class="full">Photo URL<input id="bf-photo" placeholder="https://..." value="' + esc(boat ? boat.photo_url : '') + '"></label>' +
      '<label class="full">Notes<textarea id="bf-notes">' + esc(boat ? boat.notes : '') + '</textarea></label>' +
      '<div class="modal-error" id="bf-error"></div>' +
      '<div class="modal-btns"><button class="btn btn-sky" id="bf-save">' + (isEdit ? 'Save Changes' : 'Add Boat') + '</button><button class="btn btn-outline" onclick="document.getElementById(\'boat-modal\').remove()">Cancel</button></div>' +
      '</div></div>';

    document.body.appendChild(m);
    m.querySelector('.modal').addEventListener('click', function(e) { e.stopPropagation(); });
    m.addEventListener('click', function() { m.remove(); });

    document.getElementById('bf-save').addEventListener('click', async function() {
      var err = document.getElementById('bf-error');
      var name = document.getElementById('bf-name').value.trim();
      if (!name) { err.textContent = 'Boat name is required.'; return; }
      err.textContent = '';
      var body = {
        name: name,
        model: document.getElementById('bf-model').value,
        year: document.getElementById('bf-year').value || null,
        boat_type: document.getElementById('bf-type').value,
        length_ft: document.getElementById('bf-length').value || null,
        beam_ft: document.getElementById('bf-beam').value || null,
        draft_ft: document.getElementById('bf-draft').value || null,
        mmsi: document.getElementById('bf-mmsi').value,
        home_port: document.getElementById('bf-port').value,
        registration: document.getElementById('bf-reg').value,
        flag: document.getElementById('bf-flag').value,
        engine_type: document.getElementById('bf-engine').value,
        engine_count: document.getElementById('bf-engines').value || 1,
        fuel_capacity: document.getElementById('bf-fuel').value || null,
        water_capacity: document.getElementById('bf-water').value || null,
        photo_url: document.getElementById('bf-photo').value,
        notes: document.getElementById('bf-notes').value
      };
      try {
        if (isEdit) await apiPut('/api/boats/' + boat.id, body);
        else await apiPost('/api/boats', body);
        m.remove();
        var path = getRoute();
        if (path.startsWith('/boat/')) renderBoat(parseInt(path.split('/')[2]));
        else renderFleet();
      } catch (e) { err.textContent = e.message; }
    });
  }

  // ── Boat Page ──
  async function renderBoat(id) {
    app.innerHTML = '<p style="color:var(--slate);padding:40px 0">Loading...</p>';
    try {
      var data = await api('/api/boats/' + id);
      var b = data.boat;
      var statusLabel = b.status || 'inactive';

      // Build compact detail chips (only non-empty values)
      var chips = '';
      var chipData = [
        ['Status', '<span class="status-dot ' + esc(statusLabel) + '" style="display:inline-block;margin-right:3px"></span>' + esc(statusLabel), true],
        ['Model', b.model], ['Year', b.year], ['Type', b.boat_type],
        ['Length', b.length_ft ? b.length_ft + ' ft' : null],
        ['Beam', b.beam_ft ? b.beam_ft + ' ft' : null],
        ['Draft', b.draft_ft ? b.draft_ft + ' ft' : null],
        ['MMSI', b.mmsi], ['Home Port', b.home_port],
        ['Engines', (b.engine_type || '') + (b.engine_count > 1 ? ' x' + b.engine_count : '')],
        ['Fuel', b.fuel_capacity ? b.fuel_capacity + 'L' : null],
        ['Water', b.water_capacity ? b.water_capacity + 'L' : null],
      ];
      for (var ci = 0; ci < chipData.length; ci++) {
        var cd = chipData[ci];
        var cv = cd[2] ? cd[1] : (cd[1] != null && cd[1] !== '' ? esc(String(cd[1])) : null);
        if (!cv) continue;
        chips += '<div class="boat-chip"><span class="boat-chip-label">' + esc(cd[0]) + '</span>' + (cd[2] ? cv : '<span class="boat-chip-val">' + cv + '</span>') + '</div>';
      }

      // ── Section content ──
      var sections = {};

      sections.info =
        '<div class="boat-info-bar">' +
        (b.photo_url ? '<div class="boat-thumb"><img src="' + esc(b.photo_url) + '" alt="' + esc(b.name) + '"></div>' : '') +
        '<div class="boat-chips">' + chips + '</div>' +
        (b.notes ? '<div class="boat-notes-line">' + esc(b.notes) + '</div>' : '') +
        '</div>';

      sections.alerts =
        '<div class="alert-ticker" id="telem-alerts"><div class="alert-empty">Connecting...</div></div>';

      // ── Telem panel order ──
      var defaultPanelOrder = ['advisor', 'perf', 'energy', 'batt', 'nav', 'engines', 'tanks', 'wind'];
      var panelOrder = defaultPanelOrder;
      try {
        var savedPanels = JSON.parse(localStorage.getItem('mc_telem_' + id));
        if (Array.isArray(savedPanels) && savedPanels.length === defaultPanelOrder.length) {
          var validP = true;
          for (var pi = 0; pi < defaultPanelOrder.length; pi++) {
            if (savedPanels.indexOf(defaultPanelOrder[pi]) === -1) { validP = false; break; }
          }
          if (validP) panelOrder = savedPanels;
        }
      } catch(e) {}
      var panelHtml = '';
      for (var pi = 0; pi < panelOrder.length; pi++) {
        var pk = panelOrder[pi];
        panelHtml += '<div class="telem-drag-box" data-panel="' + pk + '"><div class="telem-panel" id="telem-' + pk + '"></div></div>';
      }

      sections.telemetry =
        '<div class="telem-grid telem-grid-wide" id="telem-panels">' + panelHtml + '</div>' +
        '<div class="scenario-bar" id="telem-scenarios"></div>';

      sections.logbook =
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
        '<div class="log-filters" id="log-filters">' +
        '<button class="log-filter active" data-type="">All</button>' +
        '<button class="log-filter" data-type="note">Notes</button>' +
        '<button class="log-filter" data-type="maintenance">Maintenance</button>' +
        '<button class="log-filter" data-type="alert">Alerts</button>' +
        '</div>' +
        '<button class="btn btn-sky btn-sm" id="add-log-btn">+ Add Entry</button>' +
        '</div>' +
        '<div id="log-feed" class="log-feed"><p style="color:var(--slate)">Loading...</p></div>' +
        '<div id="log-form-area"></div>';

      var sectionLabels = { info: 'Boat Info', alerts: 'Alerts', telemetry: 'Commander Unit', logbook: 'Logbook' };
      var sectionHandleExtra = {
        telemetry: ' <span class="telem-status disconnected" id="telem-badge">CONNECTING</span>'
      };

      // ── Saved layout order ──
      var defaultOrder = ['info', 'alerts', 'telemetry', 'logbook'];
      var order = defaultOrder;
      try {
        var saved = JSON.parse(localStorage.getItem('mc_layout_' + id));
        if (Array.isArray(saved) && saved.length === defaultOrder.length) {
          var valid = true;
          for (var oi = 0; oi < defaultOrder.length; oi++) {
            if (saved.indexOf(defaultOrder[oi]) === -1) { valid = false; break; }
          }
          if (valid) order = saved;
        }
      } catch(e) {}

      // ── Build drag boxes ──
      var boxesHtml = '';
      for (var si = 0; si < order.length; si++) {
        var key = order[si];
        boxesHtml +=
          '<div class="drag-box" data-section="' + key + '">' +
          '<div class="drag-handle"><span class="drag-grip">\u283F</span> ' + sectionLabels[key] + (sectionHandleExtra[key] || '') + '</div>' +
          '<div class="drag-content">' + sections[key] + '</div></div>';
      }

      app.innerHTML =
        '<div class="boat-page-header">' +
        '<button class="back-btn" onclick="window.location.hash=\'#/\'">&larr; Fleet</button>' +
        '<h1>' + esc(b.name) + '</h1>' +
        '<div class="boat-page-actions">' +
        '<button class="btn btn-outline btn-sm" id="edit-boat-btn">Edit</button>' +
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" id="delete-boat-btn">Delete</button>' +
        '</div></div>' +
        '<div id="boat-sections" class="boat-sections">' + boxesHtml + '</div>';

      // Event listeners
      document.getElementById('edit-boat-btn').addEventListener('click', function() { showBoatModal(b); });
      document.getElementById('delete-boat-btn').addEventListener('click', async function() {
        if (!confirm('Delete "' + b.name + '"? This cannot be undone.')) return;
        try { await apiDelete('/api/boats/' + b.id); navigate('#/'); } catch (e) { alert(e.message); }
      });
      document.getElementById('add-log-btn').addEventListener('click', function() { showLogForm(b.id); });

      // Log filters
      document.getElementById('log-filters').addEventListener('click', function(e) {
        var btn = e.target.closest('.log-filter');
        if (!btn) return;
        document.querySelectorAll('.log-filter').forEach(function(f) { f.classList.remove('active'); });
        btn.classList.add('active');
        loadLogs(b.id, btn.getAttribute('data-type'));
      });

      loadLogs(b.id, '');
      setupDragDrop({
        containerId: 'boat-sections', boxClass: 'drag-box',
        handleSel: '.drag-handle', dataAttr: 'data-section',
        storageKey: 'mc_layout_' + id
      });
      setupDragDrop({
        containerId: 'telem-panels', boxClass: 'telem-drag-box',
        handleSel: '.telem-panel-title', dataAttr: 'data-panel',
        storageKey: 'mc_telem_' + id, grid: true
      });
      initTelemetry(id);
    } catch (e) {
      app.innerHTML = '<p style="color:var(--red);padding:40px 0">' + esc(e.message) + '</p>';
    }
  }

  // ── Drag & drop (shared for sections + telem panels) ──
  function setupDragDrop(opts) {
    var container = document.getElementById(opts.containerId);
    if (!container) return;
    var boxSel = '.' + opts.boxClass;
    var isGrid = opts.grid || false;
    var dragEl = null;

    function saveOrder() {
      var order = [];
      container.querySelectorAll(boxSel).forEach(function(box) {
        order.push(box.getAttribute(opts.dataAttr));
      });
      localStorage.setItem(opts.storageKey, JSON.stringify(order));
    }

    // Enable dragging only from handle
    container.addEventListener('mousedown', function(e) {
      if (!e.target.closest(opts.handleSel)) return;
      var box = e.target.closest(boxSel);
      if (box) box.draggable = true;
    });

    container.addEventListener('dragstart', function(e) {
      var box = e.target.closest(boxSel);
      if (!box) return;
      dragEl = box;
      box.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });

    container.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var box = e.target.closest(boxSel);
      if (!box || box === dragEl) return;
      if (isGrid) {
        // Live swap for grid layout
        var all = Array.from(container.querySelectorAll(boxSel));
        var di = all.indexOf(dragEl), ti = all.indexOf(box);
        if (di !== -1 && ti !== -1 && di !== ti) {
          if (di < ti) container.insertBefore(dragEl, box.nextSibling);
          else container.insertBefore(dragEl, box);
        }
      } else {
        // Border indicators for list layout
        container.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function(el) {
          el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        var rect = box.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) box.classList.add('drag-over-top');
        else box.classList.add('drag-over-bottom');
      }
    });

    if (!isGrid) {
      container.addEventListener('dragleave', function(e) {
        if (!container.contains(e.relatedTarget)) {
          container.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function(el) {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
          });
        }
      });
    }

    container.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!isGrid) {
        var box = e.target.closest(boxSel);
        if (!box || !dragEl || box === dragEl) return;
        var rect = box.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) container.insertBefore(dragEl, box);
        else container.insertBefore(dragEl, box.nextSibling);
      }
      saveOrder();
    });

    container.addEventListener('dragend', function() {
      if (isGrid) saveOrder();
      container.querySelectorAll(boxSel).forEach(function(box) {
        box.draggable = false;
        box.classList.remove('dragging');
      });
      dragEl = null;
      container.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function(el) {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    // Touch drag support
    var touchEl = null, touchClone = null, touchOffsetY = 0;

    container.addEventListener('touchstart', function(e) {
      var handle = e.target.closest(opts.handleSel);
      if (!handle) return;
      var box = handle.closest(boxSel);
      if (!box) return;
      touchEl = box;
      var rect = box.getBoundingClientRect();
      touchOffsetY = e.touches[0].clientY - rect.top;
      touchClone = box.cloneNode(true);
      touchClone.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;opacity:.85;z-index:1000;pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,.18);';
      document.body.appendChild(touchClone);
      box.classList.add('dragging');
    }, { passive: true });

    container.addEventListener('touchmove', function(e) {
      if (!touchEl) return;
      e.preventDefault();
      var y = e.touches[0].clientY;
      touchClone.style.top = (y - touchOffsetY) + 'px';
      var boxes = container.querySelectorAll(boxSel + ':not(.dragging)');
      if (isGrid) {
        for (var i = 0; i < boxes.length; i++) {
          var r = boxes[i].getBoundingClientRect();
          var x = e.touches[0].clientX;
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            var all = Array.from(container.querySelectorAll(boxSel));
            var di = all.indexOf(touchEl), ti = all.indexOf(boxes[i]);
            if (di !== -1 && ti !== -1 && di !== ti) {
              if (di < ti) container.insertBefore(touchEl, boxes[i].nextSibling);
              else container.insertBefore(touchEl, boxes[i]);
            }
            break;
          }
        }
      } else {
        container.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function(el) {
          el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        for (var i = 0; i < boxes.length; i++) {
          var r = boxes[i].getBoundingClientRect();
          if (y >= r.top && y <= r.bottom) {
            if (y < r.top + r.height / 2) boxes[i].classList.add('drag-over-top');
            else boxes[i].classList.add('drag-over-bottom');
            break;
          }
        }
      }
    }, { passive: false });

    container.addEventListener('touchend', function() {
      if (!touchEl) return;
      if (!isGrid) {
        var target = container.querySelector('.drag-over-top,.drag-over-bottom');
        if (target && target !== touchEl) {
          if (target.classList.contains('drag-over-top')) container.insertBefore(touchEl, target);
          else container.insertBefore(touchEl, target.nextSibling);
        }
      }
      saveOrder();
      touchEl.classList.remove('dragging');
      if (touchClone) touchClone.remove();
      touchEl = null; touchClone = null;
      container.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(function(el) {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });
  }

  // ── Alert auto-logging ──
  var _loggedAlerts = null;
  var _logBoatId = null;

  function autoLogAlerts(boatId, alerts) {
    if (!alerts || !alerts.length) return;
    if (!_loggedAlerts || _logBoatId !== boatId) {
      _logBoatId = boatId;
      try { _loggedAlerts = JSON.parse(localStorage.getItem('mc_alert_log_' + boatId)) || {}; }
      catch(e) { _loggedAlerts = {}; }
      // Prune entries older than 2 hours
      var now = Date.now();
      var keys = Object.keys(_loggedAlerts);
      for (var i = 0; i < keys.length; i++) {
        if (now - _loggedAlerts[keys[i]] > 7200000) delete _loggedAlerts[keys[i]];
      }
    }
    var changed = false;
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var key = (a.id || a.message) + '|' + a.timestamp;
      if (_loggedAlerts[key]) continue;
      _loggedAlerts[key] = Date.now();
      changed = true;
      apiPost('/api/boats/' + boatId + '/logs', {
        log_type: 'alert',
        title: (a.severity || 'info').toUpperCase() + ': ' + (a.id || 'Alert'),
        body: a.message
      }).catch(function() {});
    }
    if (changed) localStorage.setItem('mc_alert_log_' + boatId, JSON.stringify(_loggedAlerts));
  }

  // ── Telemetry lifecycle ──
  var _telemClient = null;
  var _scenarioLoaded = false;

  function initTelemetry(boatId) {
    cleanupTelemetry();
    if (!window.MCTelemetry) return;

    _telemClient = new window.MCTelemetry.Client();
    _scenarioLoaded = false;

    _telemClient.onStatus(function(connected) {
      var badge = document.getElementById('telem-badge');
      if (!badge) return;
      if (connected) {
        badge.className = 'telem-status live';
        badge.textContent = 'LIVE';
      } else {
        badge.className = 'telem-status disconnected';
        badge.textContent = 'DISCONNECTED';
      }
    });

    _telemClient.onUpdate(function(snap) {
      var T = window.MCTelemetry;
      var el;
      el = document.getElementById('telem-advisor');  if (el && T.renderAdvisorPanel) T.renderAdvisorPanel(el, snap);
      el = document.getElementById('telem-perf');    if (el && T.renderPerformancePanel) T.renderPerformancePanel(el, snap);
      el = document.getElementById('telem-energy');  if (el && T.renderEnergyPanel) T.renderEnergyPanel(el, snap);
      el = document.getElementById('telem-nav');     if (el) T.renderNavPanel(el, snap);
      el = document.getElementById('telem-batt');    if (el) T.renderBatteryPanel(el, snap);
      el = document.getElementById('telem-engines'); if (el) T.renderEnginePanel(el, snap);
      el = document.getElementById('telem-tanks');   if (el) T.renderTanksPanel(el, snap);
      el = document.getElementById('telem-wind');    if (el) T.renderWindPanel(el, snap);

      // Alerts
      el = document.getElementById('telem-alerts');
      if (el && snap._alerts) T.renderAlertTicker(el, snap._alerts);

      // Auto-log new alerts
      if (boatId && snap._alerts) autoLogAlerts(boatId, snap._alerts);

      // Live-update energy flow modal if open
      var efBody = document.getElementById('ef-body');
      if (efBody && T.renderEnergyFlow) T.renderEnergyFlow(efBody, snap);

      // Load scenario buttons once
      if (!_scenarioLoaded) {
        _scenarioLoaded = true;
        loadScenarios();
      }
    });

    _telemClient.connect();

    // ── Battery panel click → energy flow modal ──
    setTimeout(function() {
      var battPanel = document.getElementById('telem-batt');
      if (battPanel) {
        battPanel.style.cursor = 'pointer';
        battPanel.addEventListener('click', function(e) {
          if (e.target.closest('.drag-handle,.telem-panel-title')) return; // don't trigger on grip drag
          openEnergyFlow();
        });
      }
    }, 500);
  }

  function openEnergyFlow() {
    if (document.getElementById('ef-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'ef-overlay';
    overlay.className = 'ef-overlay';
    overlay.innerHTML =
      '<div class="ef-modal">' +
      '<div class="ef-modal-header">' +
      '<div class="ef-modal-title"><span>&#9889;</span> Energy Flow</div>' +
      '<button class="ef-close" id="ef-close">&times;</button>' +
      '</div>' +
      '<div id="ef-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Render immediately if we have data
    var T = window.MCTelemetry;
    if (_telemClient && _telemClient.lastSnapshot && T && T.renderEnergyFlow) {
      T.renderEnergyFlow(document.getElementById('ef-body'), _telemClient.lastSnapshot);
    }

    // Close handlers
    document.getElementById('ef-close').addEventListener('click', closeEnergyFlow);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeEnergyFlow();
    });
    document.addEventListener('keydown', _efEscHandler);
  }

  function _efEscHandler(e) { if (e.key === 'Escape') closeEnergyFlow(); }

  function closeEnergyFlow() {
    var overlay = document.getElementById('ef-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', _efEscHandler);
  }

  function loadScenarios() {
    var el = document.getElementById('telem-scenarios');
    if (!el) return;
    fetch('/api/telemetry/scenarios')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (window.MCTelemetry && el) {
          window.MCTelemetry.renderScenarioControl(el, data.current);
        }
      })
      .catch(function() {});
  }

  function cleanupTelemetry() {
    if (_telemClient) {
      _telemClient.disconnect();
      _telemClient = null;
    }
    _scenarioLoaded = false;
  }

  function detailRow(label, value, raw) {
    if (raw) return '<div class="detail-item"><div class="detail-label">' + esc(label) + '</div><div class="detail-value">' + value + '</div></div>';
    var v = value != null && value !== '' ? esc(String(value)) : null;
    if (!v) return '';
    return '<div class="detail-item"><div class="detail-label">' + esc(label) + '</div><div class="detail-value">' + v + '</div></div>';
  }

  function monitorCard(icon, label) {
    return '<div class="monitor-card"><div class="monitor-card-icon">' + icon + '</div><div class="monitor-card-label">' + esc(label) + '</div></div>';
  }

  // ── Logbook ──
  var _logFilter = '';
  async function loadLogs(boatId, typeFilter) {
    _logFilter = typeFilter || '';
    var feed = document.getElementById('log-feed');
    if (!feed) return;
    try {
      var url = '/api/boats/' + boatId + '/logs?limit=50';
      if (typeFilter) url += '&type=' + typeFilter;
      var data = await api(url);
      if (!data.logs || data.logs.length === 0) {
        feed.innerHTML = '<div class="log-empty">No log entries yet. Add your first note or maintenance record.</div>';
        return;
      }
      feed.innerHTML = '';
      data.logs.forEach(function(log) {
        var el = document.createElement('div');
        el.className = 'log-entry ' + (log.log_type || 'note');
        el.id = 'log-entry-' + log.id;
        var typeLabel = log.log_type === 'maintenance' ? 'Maintenance' : log.log_type === 'alert' ? 'Alert' : 'Note';
        var date = new Date(log.created_at);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        el.innerHTML =
          '<div class="log-entry-actions">' +
          '<button class="log-action-btn log-entry-edit" title="Edit" data-log-id="' + log.id + '" data-boat-id="' + log.boat_id + '" data-type="' + esc(log.log_type || 'note') + '" data-title="' + esc(log.title || '') + '" data-body="' + esc(log.body || '') + '">&#9998;</button>' +
          '<button class="log-action-btn log-entry-delete" title="Delete" data-log-id="' + log.id + '" data-boat-id="' + log.boat_id + '">&times;</button>' +
          '</div>' +
          '<div class="log-entry-header"><span class="log-entry-title">' + (log.title ? esc(log.title) : esc(typeLabel)) + '</span>' +
          '<span class="log-entry-meta">' + esc(typeLabel) + ' &middot; ' + esc(dateStr) + (log.user_name ? ' &middot; ' + esc(log.user_name) : '') + '</span></div>' +
          (log.body ? '<div class="log-entry-body">' + esc(log.body) + '</div>' : '');
        feed.appendChild(el);
      });

      // Delete + Edit handlers via delegation
      feed.onclick = function(e) {
        var btn = e.target.closest('.log-action-btn');
        if (!btn) return;
        var boatIdAttr = btn.getAttribute('data-boat-id');
        var logId = btn.getAttribute('data-log-id');
        if (btn.classList.contains('log-entry-delete')) {
          if (!confirm('Delete this log entry?')) return;
          apiDelete('/api/boats/' + boatIdAttr + '/logs/' + logId)
            .then(function() { loadLogs(parseInt(boatIdAttr), _logFilter); })
            .catch(function(err) { alert(err.message); });
        } else if (btn.classList.contains('log-entry-edit')) {
          showEditLog(btn);
        }
      };
    } catch (e) {
      feed.innerHTML = '<p style="color:var(--red)">' + esc(e.message) + '</p>';
    }
  }

  function showLogForm(boatId) {
    var area = document.getElementById('log-form-area');
    if (!area || area.querySelector('.log-form')) return;
    area.innerHTML =
      '<div class="log-form">' +
      '<div class="log-form-row">' +
      '<select id="lf-type"><option value="note">Note</option><option value="maintenance">Maintenance</option><option value="alert">Alert</option></select>' +
      '<input id="lf-title" placeholder="Title (optional)">' +
      '</div>' +
      '<textarea id="lf-body" placeholder="Details..."></textarea>' +
      '<div class="log-form-btns">' +
      '<button class="btn btn-sky btn-sm" id="lf-save">Save Entry</button>' +
      '<button class="btn btn-outline btn-sm" onclick="document.getElementById(\'log-form-area\').innerHTML=\'\'">Cancel</button>' +
      '</div></div>';

    document.getElementById('lf-save').addEventListener('click', async function() {
      var title = document.getElementById('lf-title').value.trim();
      var body = document.getElementById('lf-body').value.trim();
      if (!title && !body) { alert('Title or details required.'); return; }
      try {
        await apiPost('/api/boats/' + boatId + '/logs', {
          log_type: document.getElementById('lf-type').value,
          title: title || null,
          body: body || null
        });
        document.getElementById('log-form-area').innerHTML = '';
        loadLogs(boatId, _logFilter);
      } catch (e) { alert(e.message); }
    });
  }

  function showEditLog(btn) {
    var logId = btn.getAttribute('data-log-id');
    var boatId = btn.getAttribute('data-boat-id');
    var entry = document.getElementById('log-entry-' + logId);
    if (!entry || entry.querySelector('.log-edit-form')) return;
    var curType = btn.getAttribute('data-type') || 'note';
    var curTitle = btn.getAttribute('data-title') || '';
    var curBody = btn.getAttribute('data-body') || '';

    entry.innerHTML =
      '<div class="log-edit-form">' +
      '<div class="log-form-row">' +
      '<select class="le-type">' +
      '<option value="note"' + (curType === 'note' ? ' selected' : '') + '>Note</option>' +
      '<option value="maintenance"' + (curType === 'maintenance' ? ' selected' : '') + '>Maintenance</option>' +
      '<option value="alert"' + (curType === 'alert' ? ' selected' : '') + '>Alert</option>' +
      '</select>' +
      '<input class="le-title" value="' + esc(curTitle) + '" placeholder="Title">' +
      '</div>' +
      '<textarea class="le-body" placeholder="Details...">' + esc(curBody) + '</textarea>' +
      '<div class="log-form-btns">' +
      '<button class="btn btn-sky btn-sm le-save">Save</button>' +
      '<button class="btn btn-outline btn-sm le-cancel">Cancel</button>' +
      '</div></div>';

    entry.querySelector('.le-save').addEventListener('click', async function() {
      var title = entry.querySelector('.le-title').value.trim();
      var body = entry.querySelector('.le-body').value.trim();
      if (!title && !body) { alert('Title or details required.'); return; }
      try {
        await apiPut('/api/boats/' + boatId + '/logs/' + logId, {
          log_type: entry.querySelector('.le-type').value,
          title: title || null,
          body: body || null
        });
        loadLogs(parseInt(boatId), _logFilter);
      } catch (e) { alert(e.message); }
    });

    entry.querySelector('.le-cancel').addEventListener('click', function() {
      loadLogs(parseInt(boatId), _logFilter);
    });
  }

  // ── Billing Page ──
  async function renderBilling() {
    app.innerHTML = '<div class="fleet-header"><h1>Billing</h1></div><p style="color:var(--slate)">Loading...</p>';
    try {
      var data = await api('/api/billing/status');

      // Check for checkout result in URL params
      var params = new URLSearchParams(window.location.search);
      var checkoutResult = params.get('checkout');
      var bannerHtml = '';
      if (checkoutResult === 'success') {
        bannerHtml = '<div class="billing-banner success"><p>Payment successful! Your subscription is now active.</p></div>';
        // Clean URL
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      } else if (checkoutResult === 'canceled') {
        bannerHtml = '<div class="billing-banner canceled"><p>Checkout was canceled. No charges were made.</p></div>';
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }

      if (!data.stripeConfigured) {
        app.innerHTML =
          '<div class="fleet-header"><h1>Billing</h1></div>' +
          '<div class="billing-banner"><p>Billing is coming soon. Contact us to discuss pricing and plans.</p></div>' +
          '<div class="billing-plans-grid">' + buildPlanCards(data.plans, data.currentPlan, false) + '</div>';
        return;
      }

      // Current plan section
      var currentHtml = '';
      if (data.currentPlan && data.status !== 'none') {
        var planInfo = data.plans.find(function(p) { return p.id === data.currentPlan; });
        var planName = planInfo ? planInfo.name : data.currentPlan;
        var periodEnd = data.currentPeriodEnd ? new Date(data.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
        var cancelNote = data.cancelAtPeriodEnd ? ' (cancels ' + periodEnd + ')' : (periodEnd ? ' &middot; Renews ' + periodEnd : '');
        currentHtml =
          '<div class="billing-current"><div class="card">' +
          '<div><div class="billing-plan-name">' + esc(planName) + '</div>' +
          '<div class="billing-plan-detail"><span class="billing-status-badge ' + esc(data.status) + '">' + esc(data.status) + '</span>' + cancelNote + '</div></div>' +
          '<button class="btn btn-outline btn-sm" id="manage-billing-btn">Manage Billing</button>' +
          '</div></div>';
      }

      app.innerHTML =
        '<div class="fleet-header"><h1>Billing</h1></div>' +
        bannerHtml + currentHtml +
        '<div class="card"><h2>Available Plans</h2>' +
        '<div class="billing-plans-grid">' + buildPlanCards(data.plans, data.currentPlan, data.stripeConfigured) + '</div></div>';

      // Manage billing button
      var manageBtn = document.getElementById('manage-billing-btn');
      if (manageBtn) {
        manageBtn.addEventListener('click', async function() {
          manageBtn.disabled = true;
          manageBtn.textContent = 'Loading...';
          try {
            var portal = await apiPost('/api/billing/portal', {});
            window.location.href = portal.url;
          } catch (e) {
            alert(e.message);
            manageBtn.disabled = false;
            manageBtn.textContent = 'Manage Billing';
          }
        });
      }

      // Subscribe buttons
      document.querySelectorAll('.billing-subscribe-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var planId = btn.getAttribute('data-plan');
          btn.disabled = true;
          btn.textContent = 'Loading...';
          try {
            var checkout = await apiPost('/api/billing/checkout', { plan: planId });
            window.location.href = checkout.url;
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
            btn.textContent = 'Subscribe';
          }
        });
      });
    } catch (e) {
      app.innerHTML = '<div class="fleet-header"><h1>Billing</h1></div>' +
        '<div style="text-align:center;padding:40px 20px">' +
        '<p style="color:var(--slate);margin-bottom:16px">Billing requires an active account. Try demo mode to explore the platform.</p>' +
        '<button class="btn btn-sky" onclick="document.getElementById(\'demo-btn\').click()">Try Demo Mode</button></div>';
    }
  }

  function buildPlanCards(plans, currentPlan, stripeReady) {
    return plans.map(function(p) {
      var price = '$' + (p.amount / 100).toFixed(0);
      var isCurrent = currentPlan === p.id;
      var btnHtml;
      if (isCurrent) {
        btnHtml = '<button class="btn btn-outline btn-sm" disabled>Current Plan</button>';
      } else if (!stripeReady || !p.hasPrice) {
        btnHtml = '<button class="btn btn-outline btn-sm" disabled>Coming Soon</button>';
      } else {
        btnHtml = '<button class="btn btn-sky btn-sm billing-subscribe-btn" data-plan="' + esc(p.id) + '">Subscribe</button>';
      }
      return '<div class="billing-plan-item">' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="plan-price">' + price + '<span>/' + esc(p.interval) + '</span></div>' +
        '<div class="plan-desc">' + esc(p.description) + '</div>' +
        btnHtml + '</div>';
    }).join('');
  }

  // ── Settings Page ──
  async function renderSettings() {
    app.innerHTML =
      '<div class="fleet-header"><h1>Settings</h1></div>' +
      '<div class="settings-grid">' +
      '<div class="card"><h2>Profile</h2>' +
      '<div class="settings-form" id="profile-form">' +
      '<label>Name<input id="sf-name" value=""></label>' +
      '<label>Email<input id="sf-email" readonly value=""></label>' +
      '<label>Phone<input id="sf-phone" value=""></label>' +
      '<label>Company<input id="sf-company" value=""></label>' +
      '<button class="btn btn-sky btn-sm" id="save-profile">Save Profile</button>' +
      '<div class="settings-msg" id="profile-msg"></div>' +
      '</div></div>' +
      '<div class="card"><h2>Change Password</h2>' +
      '<div class="settings-form" id="password-form">' +
      '<label>Current Password<input type="password" id="sf-pw-current"></label>' +
      '<label>New Password<input type="password" id="sf-pw-new" minlength="8"></label>' +
      '<label>Confirm Password<input type="password" id="sf-pw-confirm"></label>' +
      '<button class="btn btn-sky btn-sm" id="save-password">Change Password</button>' +
      '<div class="settings-msg" id="password-msg"></div>' +
      '</div></div>' +
      '</div>';

    // Load profile
    try {
      var data = await api('/api/user/profile');
      document.getElementById('sf-name').value = data.name || '';
      document.getElementById('sf-email').value = data.email || '';
      document.getElementById('sf-phone').value = data.phone || '';
      document.getElementById('sf-company').value = data.company || '';
    } catch (e) {}

    document.getElementById('save-profile').addEventListener('click', async function() {
      var msg = document.getElementById('profile-msg');
      msg.textContent = ''; msg.className = 'settings-msg';
      try {
        await apiPut('/api/user/profile', {
          name: document.getElementById('sf-name').value,
          phone: document.getElementById('sf-phone').value,
          company: document.getElementById('sf-company').value
        });
        msg.textContent = 'Profile saved.'; msg.className = 'settings-msg success';
        var u = getUser();
        if (u) { u.name = document.getElementById('sf-name').value; localStorage.setItem('mc_user', JSON.stringify(u)); }
        document.getElementById('nav-user-name').textContent = document.getElementById('sf-name').value.split(' ')[0];
      } catch (e) { msg.textContent = e.message; msg.className = 'settings-msg error'; }
    });

    document.getElementById('save-password').addEventListener('click', async function() {
      var msg = document.getElementById('password-msg');
      msg.textContent = ''; msg.className = 'settings-msg';
      var pw = document.getElementById('sf-pw-new').value;
      if (pw !== document.getElementById('sf-pw-confirm').value) {
        msg.textContent = 'Passwords do not match.'; msg.className = 'settings-msg error'; return;
      }
      try {
        await apiPut('/api/user/password', {
          current_password: document.getElementById('sf-pw-current').value,
          new_password: pw
        });
        msg.textContent = 'Password changed.'; msg.className = 'settings-msg success';
        document.getElementById('sf-pw-current').value = '';
        document.getElementById('sf-pw-new').value = '';
        document.getElementById('sf-pw-confirm').value = '';
      } catch (e) { msg.textContent = e.message; msg.className = 'settings-msg error'; }
    });
  }

  // ── PERSONA SWITCHER (bottom-right) ─────────────────────
  var PERSONAS = [
    { email: 'charter@demo.mc', name: 'Sarah Mitchell', role: 'Charter Fleet Manager', desc: '10 boats, BVI & Eastern Caribbean', icon: '&#9973;', boats: 10 },
    { email: 'marina@demo.mc', name: 'James Kowalski', role: 'Marina Owner', desc: '15 boats, Coconut Palm Marina, Fort Lauderdale', icon: '&#9875;', boats: 15 },
    { email: 'owner@demo.mc', name: 'Gil Barden', role: 'Individual Owner', desc: '1 boat — Catana 581, Trinidad', icon: '&#9973;', boats: 1 },
    { email: 'captain@demo.mc', name: 'Mike Torres', role: 'Delivery Captain', desc: '4 boats — 1 active delivery, 3 queued', icon: '&#129517;', boats: 4 },
    { email: 'surveyor@demo.mc', name: 'Linda Chen', role: 'Marine Surveyor', desc: '6 boats — 2 active surveys, San Diego', icon: '&#128203;', boats: 6 },
  ];

  function initPersonaSwitcher() {
    var el = document.createElement('div');
    el.id = 'demo-toggle';
    el.className = 'demo-toggle';
    var itemsHtml = PERSONAS.map(function(p) {
      return '<div class="demo-persona-item" data-email="' + esc(p.email) + '">' +
        '<span class="demo-persona-icon">' + p.icon + '</span>' +
        '<div class="demo-persona-info"><div class="demo-persona-name">' + esc(p.name) + '</div>' +
        '<div class="demo-persona-role">' + esc(p.role) + '</div>' +
        '<div class="demo-persona-desc">' + esc(p.desc) + '</div></div>' +
        '<span class="demo-persona-count">' + p.boats + '</span></div>';
    }).join('');

    el.innerHTML =
      '<button class="demo-toggle-btn" id="demo-btn"><span class="demo-icon">&#128100;</span> Switch User</button>' +
      '<div class="demo-dropdown" id="demo-dropdown" style="display:none">' +
      '<div class="demo-dropdown-header">Switch Persona</div>' +
      '<div id="demo-persona-list">' + itemsHtml + '</div></div>';
    document.body.appendChild(el);

    document.getElementById('demo-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      var dd = document.getElementById('demo-dropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#demo-toggle')) document.getElementById('demo-dropdown').style.display = 'none';
    });

    document.getElementById('demo-persona-list').addEventListener('click', function(e) {
      var item = e.target.closest('.demo-persona-item');
      if (!item) return;
      var email = item.getAttribute('data-email');
      item.style.opacity = '0.5';
      item.querySelector('.demo-persona-name').textContent = 'Switching...';
      // Login as this persona
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email, password: 'demo2026' }),
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.user) {
          localStorage.setItem('mc_user', JSON.stringify(data.user));
          localStorage.removeItem('mc_demo_active');
          window.location.href = 'dashboard.html#/';
          window.location.reload();
        } else {
          item.style.opacity = '1';
          item.querySelector('.demo-persona-name').textContent = 'Login failed';
        }
      }).catch(function() {
        item.style.opacity = '1';
        item.querySelector('.demo-persona-name').textContent = 'Error';
      });
    });
  }

  // ── Init ──
  initPersonaSwitcher();
  onRoute();

})();
