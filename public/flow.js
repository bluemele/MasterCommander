// Master&Commander — Interactive Flow Diagram (Charter / Private / Diagnostic tabs)
(function() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const container = document.getElementById('flow-container');
  const panel = document.getElementById('detail-panel');
  const panelTitle = document.getElementById('detail-title');
  const panelDesc = document.getElementById('detail-desc');
  const panelTags = document.getElementById('detail-tags');
  let activeNode = null;
  let currentMode = 'charter';

  // ---- Shared nodes (all modes) ----
  const sharedNodes = [
    { id:'nmea',     x:60,  y:80,  w:140, h:52, label:'NMEA 2000',     icon:'\u2693', color:'#1e3a5f', detail:'Industry-standard marine data bus. Connects engines, GPS, depth, wind, tanks, AIS, and more.', tags:['CAN bus','SAE J1939','Plug & Play'] },
    { id:'victron',  x:60,  y:165, w:140, h:52, label:'Victron',       icon:'\u26a1', color:'#1e3a5f', detail:'Battery monitors, inverters, solar chargers, and shore power. Commander reads all Victron devices automatically.', tags:['VE.Bus','MPPT','BMV'] },
    { id:'sensors',  x:60,  y:250, w:140, h:52, label:'Sensors',       icon:'\ud83c\udf21\ufe0f', color:'#1e3a5f', detail:'Temperature, humidity, bilge pump counters, tank levels, barometric pressure. Any sensor on your network is auto-detected.', tags:['OneWire','I2C','WiFi'] },
    { id:'cameras',  x:60,  y:335, w:140, h:52, label:'Cameras',       icon:'\ud83d\udcf7', color:'#1e3a5f', detail:'IP cameras for visual snapshots and security monitoring. Commander captures images on events and forwards to the cloud.', tags:['IP Cameras','Snapshots'] },
    { id:'signalk',  x:320, y:165, w:150, h:52, label:'SignalK Server', icon:'\ud83d\udd04', color:'#0e4a2f', detail:'Included with every Commander Unit. SignalK translates all marine protocols into a unified data stream \u2014 the universal translator for boats.', tags:['Included','Open Source','Universal'] },
    { id:'starlink', x:730, y:185, w:155, h:46, label:'Internet',      icon:'\ud83d\udce1', color:'#1e3a5f', detail:'Starlink, marina WiFi, or hotspot. Commander queues data when offline and syncs when connectivity returns.', tags:['Starlink','Marina WiFi','Hotspot','Store & Forward'] },
    { id:'autodiscovery', x:420, y:290, w:135, h:42, label:'Auto-Discovery', icon:'\ud83d\udd0d', color:'#374151', detail:'Commander scans your network and learns what sensors YOUR boat has. Twin engines? Two batteries? No config needed.', tags:['Zero Config','Adaptive'], sub:true },
  ];

  // Shared connections (data collection — same for all modes)
  const sharedConnections = [
    ['nmea','signalk'],
    ['victron','signalk'],
    ['sensors','signalk'],
    ['cameras','signalk'],
    ['signalk','commander'],
    ['commander','starlink'],
    ['commander','autodiscovery'],
  ];

  // ---- Charter-specific ----
  // Flow: Pi → Internet → Master Cloud → WhatsApp → Phone
  // Master Cloud also → Push Alerts, Fleet Dashboard, FleetMind
  const charterNodes = [
    { id:'commander', x:500, y:190, w:160, h:52, label:'Raspberry Pi',    icon:'\ud83e\udde0', color:'#7c2d12', detail:'Compact, always-on Commander Unit for charter fleets. Low power (5W), collects all sensor data and forwards to Master Cloud for AI processing.', tags:['Raspberry Pi 5','5W','24/7','Always-On'] },
    { id:'master',    x:920, y:185, w:155, h:50, label:'Master (Cloud)',   icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Included with every charter fleet plan. All AI processing happens here \u2014 natural language queries, trend analysis, predictive maintenance. Sends alerts via WhatsApp and push notifications.', tags:['Included','Fleet Mgmt','Cloud AI','OTA'] },
    { id:'whatsapp',  x:1100,y:95,  w:145, h:44, label:'WhatsApp',        icon:'\ud83d\udcac', color:'#1a5c38', detail:'Master Cloud sends alerts and reports to your WhatsApp. Send commands back in plain English. No subscription needed \u2014 included with every charter plan.', tags:['Included','E2E Encrypted','Two-Way'] },
    { id:'phone',     x:1260,y:95,  w:120, h:44, label:'Your Phone',      icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'WhatsApp alerts and commands. Fleet dashboard via any browser. No dedicated app needed \u2014 charterers and operators interact through WhatsApp and the web.', tags:['WhatsApp','Web Dashboard'] },
    { id:'push',      x:1100,y:270, w:140, h:38, label:'Push Alerts',     icon:'\ud83d\udd14', color:'#4c1d95', detail:'Critical alerts via push notifications from Master Cloud. Battery critical, anchor drag, bilge alarm \u2014 even if WhatsApp is closed.', tags:['Master','Push Notifications'], sub:true },
    { id:'dashboard', x:1100,y:320, w:150, h:38, label:'Fleet Dashboard', icon:'\ud83d\udcca', color:'#4c1d95', detail:'Full fleet dashboard from any browser. Live telemetry, historical charts, cross-fleet analytics, camera feeds. Your fleet\u2019s control room.', tags:['Master','Fleet View','Analytics'], sub:true },
    { id:'fleetmind', x:920, y:320, w:140, h:38, label:'FleetMind',       icon:'\ud83c\udf10', color:'#4c1d95', detail:'Crowdsourced fleet intelligence. Wind field, depth, anchorage intel, passage conditions, hazard broadcasts. Every connected boat makes the network smarter.', tags:['Master','Crowdsourced','Real-Time'], sub:true },
  ];

  const charterConnections = [
    ['starlink','master'],
    ['master','whatsapp'],
    ['whatsapp','phone'],
    ['master','push'],
    ['master','dashboard'],
    ['master','fleetmind'],
  ];

  // ---- Private-specific ----
  // Two paths: Local (no internet) and Remote (WhatsApp direct, no Master needed)
  // Optional: Internet → Master Cloud for dashboard/push/FleetMind
  const privateNodes = [
    { id:'cameras',   x:60,  y:335, w:140, h:52, label:'Cameras / FLIR', icon:'\ud83d\udcf7', color:'#1e3a5f', detail:'Security cameras, FLIR thermal imaging, night vision. AI vision runs locally on the Mac Mini \u2014 intrusion detection, thermal anomalies, and deck monitoring processed on device.', tags:['IP Cameras','FLIR','AI Vision','Night Vision'] },
    { id:'commander', x:500, y:190, w:160, h:52, label:'Mac Mini M4',     icon:'\ud83e\udde0', color:'#7c2d12', detail:'Full-power Commander Unit for private yachts. Apple M4 chip runs Qwen 14B AI locally \u2014 fully offline capable. AI vision for cameras and FLIR. No internet needed for core functions.', tags:['Mac Mini M4','Local AI','Offline','AI Vision'] },
    { id:'localnet',  x:730, y:55,  w:155, h:46, label:'Boat WiFi / BLE', icon:'\ud83d\udcf6', color:'#1e3a5f', detail:'When you\u2019re on board, the Commander App connects directly over the boat\u2019s local WiFi or Bluetooth. No internet needed. Full access to every system.', tags:['Local WiFi','Bluetooth','Zero Latency','No Internet'] },
    { id:'app',       x:950, y:55,  w:155, h:46, label:'Commander App',   icon:'\ud83d\udcf1', color:'#0e4a2f', detail:'Native app for iOS and Android. On board: connects directly via WiFi or Bluetooth. Real-time gauges, alerts, camera feeds, and full command interface \u2014 no internet required.', tags:['iOS','Android','Real-Time','Offline'] },
    { id:'phone',     x:1160,y:55,  w:130, h:46, label:'Your Phone',      icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'On board: Commander App connects directly \u2014 no internet. Away: WhatsApp alerts. With Master: cloud dashboard and push notifications.', tags:['iOS','Android'] },
    { id:'whatsapp',  x:950, y:185, w:155, h:46, label:'WhatsApp',        icon:'\ud83d\udcac', color:'#1a5c38', detail:'Commander sends alerts and reports directly to your WhatsApp via internet \u2014 no Master Cloud subscription required. Send commands back in plain English.', tags:['Included','E2E Encrypted','Two-Way','No Subscription'] },
    { id:'master',    x:730, y:325, w:155, h:46, label:'Master (Cloud)',   icon:'\u2601\ufe0f', color:'#374151', detail:'Optional subscription for private yacht owners. Adds cloud dashboard, push notifications, historical analytics, and remote access. Commander works fully standalone without it.', tags:['Optional','Dashboard','Analytics','Remote'] },
    { id:'push',      x:950, y:300, w:140, h:40, label:'Push Alerts',     icon:'\ud83d\udd14', color:'#374151', detail:'With Master subscription: critical alerts via push notifications through the Commander App.', tags:['Optional','Push Notifications'], sub:true },
    { id:'dashboard', x:950, y:355, w:140, h:40, label:'Web Dashboard',   icon:'\ud83d\udcca', color:'#374151', detail:'With Master subscription: full web dashboard. Historical charts, live telemetry, camera feeds. Access your boat from any browser.', tags:['Optional','Analytics','Live View'], sub:true },
    { id:'aibrain',   x:570, y:350, w:125, h:42, label:'AI Brain',        icon:'\ud83e\udd16', color:'#0e4a2f', detail:'Qwen 14B language model running locally on the Mac Mini M4. Ask about your boat in plain English. Fully offline \u2014 no internet, no cloud, no subscription. AI vision processes camera and FLIR feeds on device.', tags:['Qwen 14B','Local','Offline','AI Vision'], sub:true },
    { id:'fleetmind', x:730, y:400, w:140, h:40, label:'FleetMind',       icon:'\ud83c\udf10', color:'#374151', detail:'With Master subscription: join the FleetMind network. Crowdsourced wind, depth, anchorage intel, hazard alerts, and weather warnings from every connected boat.', tags:['Optional','Crowdsourced','Weather','Hazards'], sub:true },
  ];

  const privateConnections = [
    ['commander','localnet'],
    ['localnet','app'],
    ['app','phone'],
    ['starlink','whatsapp'],
    ['whatsapp','phone'],
    ['starlink','master'],
    ['master','push'],
    ['master','dashboard'],
    ['master','fleetmind'],
    ['commander','aibrain'],
  ];

  // ---- Diagnostic-specific ----
  // Flow: Scanner → Internet → Master Cloud → Service Portal → Tech's Device
  // No WhatsApp — reports delivered via portal only
  const diagnosticNodes = [
    { id:'commander', x:500, y:190, w:170, h:52, label:'Diagnostic Scanner', icon:'\ud83e\udde0', color:'#92400e', detail:'Same Raspberry Pi 5 hardware as the Delivery Puck, configured for diagnostic scans. Portable \u2014 moves between boats. Plugs into any NMEA 2000 backbone for 24\u201348 hour deep analysis.', tags:['Raspberry Pi 5','Portable','24-48h Scan'] },
    { id:'master',    x:920, y:185, w:155, h:50, label:'Master (Cloud)',     icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Cloud processes the raw scan data into actionable diagnostic reports. Network topology mapping, anomaly detection, benchmark comparisons, and maintenance flags.', tags:['AI Analysis','Benchmarks','Reports'] },
    { id:'portal',    x:1100,y:185, w:145, h:46, label:'Service Portal',    icon:'\ud83d\udcca', color:'#4c1d95', detail:'Dedicated web portal for marine professionals. View diagnostic reports, network topology maps, anomaly flags, and comparison benchmarks. Share reports with boat owners.', tags:['Reports','Network Map','Share'] },
    { id:'phone',     x:1260,y:185, w:120, h:46, label:"Tech's Device",     icon:'\ud83d\udcf1', color:'#1e3a5f', detail:"Marine technician accesses diagnostic reports via the Service Portal on any device \u2014 laptop, tablet, or phone.", tags:['Web Portal','Any Device'] },
    { id:'autodiscovery', x:420, y:290, w:135, h:42, label:'Deep Analysis', icon:'\ud83d\udd0d', color:'#374151', detail:'Extended 24\u201348 hour scan captures full operating patterns \u2014 charging cycles, parasitic draw, intermittent faults, and usage patterns that a short test would miss.', tags:['24-48h','Pattern Analysis','Deep Scan'], sub:true },
  ];

  const diagnosticConnections = [
    ['starlink','master'],
    ['master','portal'],
    ['portal','phone'],
  ];

  // ---- Build functions ----

  function getNodes() {
    const modeNodes = currentMode === 'charter' ? charterNodes : currentMode === 'private' ? privateNodes : diagnosticNodes;
    const merged = new Map();
    sharedNodes.forEach(n => merged.set(n.id, n));
    modeNodes.forEach(n => merged.set(n.id, n));
    return Array.from(merged.values());
  }

  function getConnections() {
    const modeConns = currentMode === 'charter' ? charterConnections : currentMode === 'private' ? privateConnections : diagnosticConnections;
    return [...sharedConnections, ...modeConns];
  }

  function build() {
    const isMobile = window.innerWidth < 768;
    const svg = document.getElementById('flow-svg');
    svg.innerHTML = '';
    hideDetail();

    const nodes = getNodes();
    const connections = getConnections();

    let vw, vh;
    if (isMobile) {
      vw = 500; vh = 750;
      container.style.minHeight = '650px';
    } else {
      vw = 1400; vh = 460;
      container.style.minHeight = '520px';
    }
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

    // Position adjustments for mobile
    const pos = {};
    nodes.forEach(n => {
      if (isMobile) {
        pos[n.id] = mobileLayout(n);
      } else {
        pos[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h };
      }
    });

    // Draw connections first (behind nodes)
    const defs = createSVG('defs');
    svg.appendChild(defs);

    connections.forEach(([from, to], i) => {
      const a = pos[from], b = pos[to];
      if (!a || !b) return;

      // Default: right edge of 'from' to left edge of 'to'
      let sx1 = a.x + a.w, sy1 = a.y + a.h/2;
      let sx2 = b.x,        sy2 = b.y + b.h/2;

      const toNode = nodes.find(n => n.id === to);
      const fromNode = nodes.find(n => n.id === from);

      // Sub nodes (below parent): connect bottom-center to top-center
      if (toNode && toNode.sub) {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }

      // Starlink → Master: vertical when Master is below (private), horizontal otherwise
      if (from === 'starlink' && to === 'master') {
        if (Math.abs(b.y - a.y) > 60) {
          sx1 = a.x + a.w/2; sy1 = a.y + a.h;
          sx2 = b.x + b.w/2; sy2 = b.y;
        }
      }

      // Master → FleetMind: always vertical (FleetMind below Master in all modes)
      if (from === 'master' && to === 'fleetmind') {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }

      // Master → outputs (WhatsApp, Push, Dashboard, Portal): right edge to left edge
      if (from === 'master' && (to === 'whatsapp' || to === 'push' || to === 'dashboard' || to === 'portal')) {
        sx1 = a.x + a.w; sy1 = a.y + a.h/2;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }

      // Commander → local network (private): top-right to left
      if (from === 'commander' && to === 'localnet') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/4;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }

      const pathId = `path-${from}-${to}`;
      const mx = (sx1 + sx2) / 2;
      const d = `M${sx1},${sy1} C${mx},${sy1} ${mx},${sy2} ${sx2},${sy2}`;
      const path = createSVG('path', { d, id: pathId, class: 'flow-line' });
      svg.appendChild(path);

      const circle = createSVG('circle', { r: 3.5, class: 'flow-pulse active' });
      const anim = createSVG('animateMotion', {
        dur: (2.5 + i * 0.3) + 's',
        repeatCount: 'indefinite',
        begin: (i * 0.4) + 's'
      });
      const mpath = createSVG('mpath');
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + pathId);
      anim.appendChild(mpath);
      circle.appendChild(anim);
      svg.appendChild(circle);
    });

    // Draw nodes
    nodes.forEach(n => {
      const p = pos[n.id];
      if (!p) return;
      const g = createSVG('g', { class: 'flow-node', 'data-id': n.id, transform: `translate(${p.x},${p.y})` });

      const rect = createSVG('rect', {
        width: p.w, height: p.h, fill: n.color,
        stroke: n.sub ? '#4b5563' : '#334155', 'stroke-width': n.sub ? 1 : 1.5,
        rx: 8, ry: 8, class: 'node-bg'
      });
      g.appendChild(rect);

      const icon = createSVG('text', {
        x: 12, y: p.h/2 + 1, 'dominant-baseline': 'middle', class: 'node-icon', 'font-size': n.sub ? '14px' : '18px'
      });
      icon.textContent = n.icon;
      g.appendChild(icon);

      const label = createSVG('text', {
        x: n.sub ? 32 : 38, y: p.h/2 + 1, 'dominant-baseline': 'middle',
        'font-size': n.sub ? '11px' : '13px', 'font-weight': n.sub ? '400' : '600'
      });
      label.textContent = n.label;
      g.appendChild(label);

      g.addEventListener('click', () => showDetail(n));
      svg.appendChild(g);
    });
  }

  function mobileLayout(n) {
    // Mode-aware mobile positions
    const shared = {
      nmea:     { x:30,  y:20,  w:130, h:45 },
      victron:  { x:180, y:20,  w:130, h:45 },
      sensors:  { x:330, y:20,  w:130, h:45 },
      cameras:  { x:105, y:70,  w:140, h:45 },
      signalk:  { x:155, y:140, w:180, h:50 },
      commander:{ x:140, y:240, w:200, h:50 },
      autodiscovery: { x:50, y:330, w:130, h:38 },
    };

    const charterMobile = {
      starlink: { x:100, y:420, w:150, h:42 },
      master:   { x:270, y:420, w:150, h:42 },
      whatsapp: { x:50,  y:500, w:150, h:42 },
      phone:    { x:220, y:500, w:150, h:42 },
      push:     { x:50,  y:580, w:130, h:36 },
      dashboard:{ x:200, y:580, w:140, h:36 },
      fleetmind:{ x:360, y:580, w:130, h:36 },
    };

    const privateMobile = {
      starlink: { x:50,  y:420, w:150, h:42 },
      localnet: { x:50,  y:500, w:150, h:42 },
      app:      { x:220, y:500, w:150, h:42 },
      phone:    { x:155, y:570, w:170, h:46 },
      whatsapp: { x:220, y:420, w:150, h:42 },
      master:   { x:50,  y:650, w:150, h:42 },
      push:     { x:220, y:640, w:120, h:36 },
      dashboard:{ x:350, y:640, w:120, h:36 },
      fleetmind:{ x:220, y:690, w:140, h:36 },
      aibrain:  { x:220, y:330, w:120, h:38 },
    };

    const diagnosticMobile = {
      starlink: { x:100, y:420, w:150, h:42 },
      master:   { x:270, y:420, w:150, h:42 },
      portal:   { x:100, y:510, w:155, h:42 },
      phone:    { x:270, y:510, w:150, h:42 },
    };

    const modeLayouts = currentMode === 'charter' ? charterMobile : currentMode === 'private' ? privateMobile : diagnosticMobile;
    return shared[n.id] || modeLayouts[n.id] || { x: n.x * 0.4, y: n.y, w: n.w * 0.8, h: n.h * 0.85 };
  }

  function showDetail(n) {
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.flow-node[data-id="${n.id}"]`);
    if (el) el.classList.add('active');

    panelTitle.innerHTML = `<span>${n.icon}</span> ${n.label}`;
    panelDesc.textContent = n.detail;
    panelTags.innerHTML = (n.tags || []).map(t => `<span class="detail-tag">${t}</span>`).join('');
    panel.classList.add('visible');
    activeNode = n.id;
  }

  function hideDetail() {
    panel.classList.remove('visible');
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
    activeNode = null;
  }

  function createSVG(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  // Expose mode switcher for tab buttons
  window.setFlowMode = function(mode) {
    currentMode = mode;
    document.querySelectorAll('.flow-tab-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.flow-tab-btn[data-mode="${mode}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    build();
  };

  // Init
  document.getElementById('detail-close').addEventListener('click', hideDetail);
  container.addEventListener('click', e => {
    if (e.target === container || e.target.id === 'flow-svg') hideDetail();
  });

  build();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 200);
  });
})();
