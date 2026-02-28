(function() {
  'use strict';

  // ── Auth helpers ──
  function getToken() { return localStorage.getItem('mc_token'); }
  function getUser() { try { return JSON.parse(localStorage.getItem('mc_user') || 'null'); } catch { return null; } }
  function authHeaders() {
    var t = getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // ── Auth guard ──
  if (!getToken()) { window.location.href = 'index.html'; return; }

  // ── API ──
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: authHeaders() }, opts || {}));
    if (res.status === 401) { window.mcAuth.logout(); throw new Error('Session expired'); }
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
    currentRoute = path;

    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(function(tab) {
      var route = tab.getAttribute('data-route');
      if (route === 'fleet' && (path === '/' || path.startsWith('/boat/'))) tab.classList.add('active');
      else if (route === 'billing' && path === '/billing') tab.classList.add('active');
      else if (route === 'settings' && path === '/settings') tab.classList.add('active');
      else tab.classList.remove('active');
    });

    // Dispatch
    if (path === '/' || path === '') renderFleet();
    else if (path.match(/^\/boat\/(\d+)$/)) renderBoat(parseInt(path.match(/^\/boat\/(\d+)$/)[1]));
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
      localStorage.removeItem('mc_token');
      localStorage.removeItem('mc_user');
      window.location.href = 'index.html';
    }
  };

  // ── Fleet Overview ──
  async function renderFleet() {
    app.innerHTML = '<div class="fleet-header"><h1>Welcome, ' + esc(user ? user.name.split(' ')[0] : '') + '</h1><button class="btn btn-sky" onclick="window._addBoat()">+ Add Boat</button></div><div id="fleet-grid" class="fleet-grid"><p style="color:var(--slate)">Loading...</p></div>';
    try {
      var data = await api('/api/boats');
      var grid = document.getElementById('fleet-grid');
      if (!data.boats || data.boats.length === 0) {
        grid.innerHTML = '<div class="fleet-empty"><p>No boats registered yet. Add your first boat to get started.</p></div>';
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
          (b.model ? '<span>' + esc(b.model) + (b.year ? ' (' + b.year + ')' : '') + '</span>' : '') +
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
      var photo = b.photo_url
        ? '<img src="' + esc(b.photo_url) + '" alt="' + esc(b.name) + '">'
        : '<span class="placeholder-icon">&#9973;</span>';

      app.innerHTML =
        '<div class="boat-page-header">' +
        '<button class="back-btn" onclick="window.location.hash=\'#/\'">&larr; Fleet</button>' +
        '<h1>' + esc(b.name) + '</h1>' +
        '<div class="boat-page-actions">' +
        '<button class="btn btn-outline btn-sm" id="edit-boat-btn">Edit</button>' +
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" id="delete-boat-btn">Delete</button>' +
        '</div></div>' +
        '<div class="boat-layout">' +

        // Left column — photo + details
        '<div>' +
        '<div class="card">' +
        '<div class="boat-photo-large">' + photo + '</div>' +
        '<div class="detail-grid">' +
        detailRow('Status', '<span class="status-dot ' + esc(statusLabel) + '" style="display:inline-block;margin-right:4px"></span>' + esc(statusLabel), true) +
        detailRow('Model', b.model) +
        detailRow('Year', b.year) +
        detailRow('Boat Type', b.boat_type) +
        detailRow('Length', b.length_ft ? b.length_ft + ' ft' : null) +
        detailRow('Beam', b.beam_ft ? b.beam_ft + ' ft' : null) +
        detailRow('Draft', b.draft_ft ? b.draft_ft + ' ft' : null) +
        detailRow('MMSI', b.mmsi) +
        detailRow('Home Port', b.home_port) +
        detailRow('Registration', b.registration) +
        detailRow('Flag', b.flag) +
        detailRow('Engine', b.engine_type) +
        detailRow('Engines', b.engine_count) +
        detailRow('Fuel Capacity', b.fuel_capacity ? b.fuel_capacity + ' L' : null) +
        detailRow('Water Capacity', b.water_capacity ? b.water_capacity + ' L' : null) +
        (b.notes ? '<div class="detail-item" style="grid-column:1/-1"><div class="detail-label">Notes</div><div class="detail-value">' + esc(b.notes) + '</div></div>' : '') +
        '</div></div></div>' +

        // Right column — commander unit + monitoring
        '<div>' +
        '<div class="card"><h2>Commander Unit</h2>' +
        '<div class="commander-placeholder"><p style="font-size:2rem;margin-bottom:8px">&#128225;</p>' +
        '<p>Not connected yet</p>' +
        '<p style="font-size:.8rem;margin-top:8px">When you install a Commander Unit on <strong>' + esc(b.name) + '</strong>, real-time telemetry will appear here.</p></div></div>' +
        '<div class="card" style="margin-top:20px"><h2>Monitoring</h2>' +
        '<div class="monitor-grid">' +
        monitorCard('&#9881;', 'Engines') +
        monitorCard('&#128267;', 'Battery') +
        monitorCard('&#9981;', 'Tanks') +
        monitorCard('&#128205;', 'Position') +
        '</div></div></div>' +

        // Full width — logbook
        '<div class="boat-layout-full"><div class="card" id="logbook-card">' +
        '<div class="log-header"><h2>Logbook</h2><div style="display:flex;gap:8px;align-items:center">' +
        '<div class="log-filters" id="log-filters">' +
        '<button class="log-filter active" data-type="">All</button>' +
        '<button class="log-filter" data-type="note">Notes</button>' +
        '<button class="log-filter" data-type="maintenance">Maintenance</button>' +
        '<button class="log-filter" data-type="alert">Alerts</button>' +
        '</div>' +
        '<button class="btn btn-sky btn-sm" id="add-log-btn">+ Add Entry</button>' +
        '</div></div>' +
        '<div id="log-feed" class="log-feed"><p style="color:var(--slate)">Loading...</p></div>' +
        '<div id="log-form-area"></div>' +
        '</div></div>' +

        '</div>';

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
    } catch (e) {
      app.innerHTML = '<p style="color:var(--red);padding:40px 0">' + esc(e.message) + '</p>';
    }
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
        var typeLabel = log.log_type === 'maintenance' ? 'Maintenance' : log.log_type === 'alert' ? 'Alert' : 'Note';
        var date = new Date(log.created_at);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        el.innerHTML =
          '<button class="log-entry-delete" title="Delete" data-log-id="' + log.id + '" data-boat-id="' + log.boat_id + '">&times;</button>' +
          '<div class="log-entry-header"><span class="log-entry-title">' + (log.title ? esc(log.title) : esc(typeLabel)) + '</span>' +
          '<span class="log-entry-meta">' + esc(typeLabel) + ' &middot; ' + esc(dateStr) + (log.user_name ? ' &middot; ' + esc(log.user_name) : '') + '</span></div>' +
          (log.body ? '<div class="log-entry-body">' + esc(log.body) + '</div>' : '');
        feed.appendChild(el);
      });

      // Delete handlers
      feed.querySelectorAll('.log-entry-delete').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          if (!confirm('Delete this log entry?')) return;
          try {
            await apiDelete('/api/boats/' + btn.getAttribute('data-boat-id') + '/logs/' + btn.getAttribute('data-log-id'));
            loadLogs(parseInt(btn.getAttribute('data-boat-id')), _logFilter);
          } catch (e) { alert(e.message); }
        });
      });
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
      app.innerHTML = '<div class="fleet-header"><h1>Billing</h1></div><p style="color:var(--red)">' + esc(e.message) + '</p>';
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

  // ── Init ──
  onRoute();

})();
