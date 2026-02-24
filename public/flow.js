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

  // =====================================================
  // ARCHITECTURE LOGIC
  // =====================================================
  //
  // CHARTER (Raspberry Pi + Cloud AI):
  //   Sensors → SignalK → Pi → Internet → Master Cloud
  //   Master Cloud → WhatsApp → Phone  (alerts)
  //   Master Cloud → Commander App      (web dashboard)
  //   Master Cloud → FleetMind          (crowdsourced intel)
  //
  // PRIVATE (Mac Mini M4 + Local AI):
  //   Sensors → SignalK → Mac Mini ←→ AI Brain (local, offline)
  //   Mac Mini → Boat WiFi/BLE → Commander App → Phone  (on-board, no internet)
  //   Mac Mini → Internet → Master Cloud (optional)
  //     Master Cloud → Commander App    (remote web access)
  //     Master Cloud → WhatsApp → Phone (alerts)
  //
  // DIAGNOSTIC (Scanner + Service Portal):
  //   Sensors → SignalK → Scanner → Internet → Master Cloud
  //   Master Cloud → Service Portal → Tech's Device
  //
  // =====================================================

  // ---- Shared nodes (all modes) ----
  // Column layout (consistent ~50px gaps):
  // Sources(30-155) → SignalK(205-340) → Commander(390-535) → Internet(585-720) → Master(770-915) → Outputs(965-1110) → Phone(1170-1280)
  const sharedNodes = [
    { id:'nmea',     x:30,  y:50,  w:125, h:44, label:'NMEA 2000',     icon:'\u2693', color:'#1e3a5f', detail:'Industry-standard marine data bus. Connects engines, GPS, depth, wind, tanks, AIS, and more.', tags:['CAN bus','SAE J1939','Plug & Play'] },
    { id:'power',    x:30,  y:112, w:125, h:44, label:'Power Systems', icon:'\u26a1', color:'#1e3a5f', detail:'Battery monitors, inverters, solar chargers, shore power, and charging systems. Reads Victron (VE.Bus/VE.Direct), Mastervolt, Blue Sea, Simarine, and any NMEA 2000 battery data. Full visibility into house banks, starter batteries, and charging sources.', tags:['Victron','Mastervolt','NMEA 2000','Shore Power'] },
    { id:'sensors',  x:30,  y:174, w:125, h:44, label:'Sensors',       icon:'\ud83c\udf21\ufe0f', color:'#1e3a5f', detail:'Temperature, humidity, bilge pump counters, tank levels, barometric pressure. Any sensor on your network is auto-detected.', tags:['OneWire','I2C','WiFi'] },
    { id:'cameras',  x:30,  y:236, w:125, h:44, label:'Cameras',       icon:'\ud83d\udcf7', color:'#1e3a5f', detail:'IP cameras for visual snapshots and security monitoring. Commander captures images on events and forwards to the cloud.', tags:['IP Cameras','Snapshots'] },
    { id:'helm',     x:30,  y:298, w:125, h:44, label:'Helm Controls', icon:'\ud83c\udfa1', color:'#1e3a5f', detail:'Helm systems like ZF MicroCommander, electronic throttle/shift, autopilot, and joystick controllers. Commander monitors helm bus data for diagnostics and fault detection.', tags:['ZF MicroCommander','Autopilot','Throttle/Shift','Joystick'] },
    { id:'signalk',  x:205, y:160, w:135, h:48, label:'SignalK Server', icon:'\ud83d\udd04', color:'#0e4a2f', detail:'Included with every Commander Unit. SignalK translates all marine protocols into a unified data stream — the universal translator for boats.', tags:['Included','Open Source','Universal'] },
    { id:'starlink', x:585, y:182, w:135, h:44, label:'Internet',      icon:'\ud83d\udce1', color:'#1e3a5f', detail:'Starlink, marina WiFi, or hotspot. Commander queues data when offline and syncs when connectivity returns.', tags:['Starlink','Marina WiFi','Hotspot','Store & Forward'] },
    { id:'autodiscovery', x:340, y:280, w:130, h:36, label:'Auto-Discovery', icon:'\ud83d\udd0d', color:'#374151', detail:'Commander scans your network and learns what sensors YOUR boat has. Twin engines? Two batteries? No config needed.', tags:['Zero Config','Adaptive'], sub:true },
  ];

  // Shared connections (data collection — same for all modes)
  const sharedConnections = [
    ['nmea','signalk'],
    ['power','signalk'],
    ['sensors','signalk'],
    ['cameras','signalk'],
    ['helm','signalk'],
    ['signalk','commander'],
    ['commander','starlink'],
    ['commander','autodiscovery'],
  ];

  // ---- Charter-specific ----
  // Pi → Internet → Master Cloud → WhatsApp/Commander App/FleetMind
  const charterNodes = [
    { id:'commander', x:390, y:182, w:145, h:48, label:'Raspberry Pi',    icon:'\ud83e\udde0', color:'#7c2d12', detail:'Compact, always-on Commander Unit for charter fleets. Low power (5W), collects all sensor data and forwards to Master Cloud for AI processing.', tags:['Raspberry Pi 5','5W','24/7','Always-On'] },
    { id:'master',    x:770, y:182, w:145, h:48, label:'Master Cloud',    icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Included with every charter fleet plan. All AI processing happens here — natural language queries, trend analysis, predictive maintenance. Sends alerts via WhatsApp.', tags:['Included','Fleet Mgmt','Cloud AI','OTA'] },
    { id:'whatsapp',  x:965, y:100, w:145, h:42, label:'WhatsApp',        icon:'\ud83d\udcac', color:'#1a5c38', detail:'Master Cloud sends alerts and reports to your WhatsApp. Send commands back in plain English. No app needed — included with every charter plan.', tags:['Included','E2E Encrypted','Two-Way'] },
    { id:'phone',     x:1170,y:100, w:110, h:42, label:'Your Phone',      icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'WhatsApp alerts and commands. Commander App via any browser. Charterers and operators interact through WhatsApp and the web.', tags:['WhatsApp','Commander App'] },
    { id:'cmdapp',    x:965, y:182, w:155, h:42, label:'Commander App',   icon:'\ud83d\udcca', color:'#4c1d95', detail:'Full fleet view from any browser. Live telemetry, historical charts, cross-fleet analytics, camera feeds. Your fleet\'s control room — accessible from any device.', tags:['Web App','Fleet View','Analytics'] },
    { id:'fleetmind', x:965, y:268, w:145, h:38, label:'FleetMind',       icon:'\ud83c\udf10', color:'#4c1d95', detail:'Crowdsourced fleet intelligence. Wind field, depth, anchorage intel, passage conditions, hazard broadcasts. Every connected boat makes the network smarter.', tags:['Crowdsourced','Real-Time'], sub:true },
  ];

  const charterConnections = [
    ['starlink','master'],
    ['master','whatsapp'],
    ['whatsapp','phone'],
    ['master','cmdapp'],
    ['cmdapp','phone'],
    ['master','fleetmind'],
  ];

  // ---- Private-specific ----
  // Two paths: on-board (WiFi/BLE, no internet) and remote (via Master Cloud)
  // ALL alerts go through Master Cloud → WhatsApp — NOT direct from unit
  const privateNodes = [
    { id:'cameras',   x:30,  y:236, w:125, h:44, label:'Cameras / FLIR', icon:'\ud83d\udcf7', color:'#1e3a5f', detail:'Security cameras, FLIR thermal imaging, night vision. AI vision runs locally on the Mac Mini — intrusion detection, thermal anomalies, and deck monitoring processed on device.', tags:['IP Cameras','FLIR','AI Vision','Night Vision'] },
    { id:'commander', x:390, y:182, w:145, h:48, label:'Mac Mini M4',     icon:'\ud83e\udde0', color:'#7c2d12', detail:'Full-power Commander Unit for private yachts. Apple M4 chip runs Qwen 14B AI locally — fully offline capable. AI vision for cameras and FLIR. No internet needed for core functions.', tags:['Mac Mini M4','Local AI','Offline','AI Vision'] },
    { id:'aibrain',   x:510, y:280, w:125, h:36, label:'AI Brain',        icon:'\ud83e\udd16', color:'#0e4a2f', detail:'Qwen 14B language model running locally on the Mac Mini M4. Ask about your boat in plain English. Fully offline — no internet, no cloud, no subscription. AI vision processes camera and FLIR feeds.', tags:['Qwen 14B','Local','Offline','AI Vision'], sub:true },
    { id:'localnet',  x:585, y:70,  w:135, h:44, label:'Boat WiFi / BLE', icon:'\ud83d\udcf6', color:'#1e3a5f', detail:'When you\'re on board, the Commander App connects directly over the boat\'s local WiFi or Bluetooth. No internet needed. Full access to every system.', tags:['Local WiFi','Bluetooth','Zero Latency'] },
    { id:'cmdapp_l',  x:770, y:70,  w:145, h:44, label:'Commander App',   icon:'\ud83d\udcf1', color:'#0e4a2f', detail:'On board: connects directly via WiFi or Bluetooth. Real-time gauges, alerts, camera feeds, and full command interface — no internet required.', tags:['iOS','Android','Real-Time','Offline'] },
    { id:'phone',     x:965, y:70,  w:110, h:44, label:'Your Phone',      icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'On board: Commander App via WiFi (no internet). Away: WhatsApp alerts and Commander App via Master Cloud.', tags:['iOS','Android'] },
    { id:'master',    x:770, y:182, w:145, h:48, label:'Master Cloud',    icon:'\u2601\ufe0f', color:'#374151', detail:'Optional subscription for private yacht owners. Adds remote access, WhatsApp alerts, historical analytics, and Commander App from anywhere. Commander works standalone without it.', tags:['Optional','Dashboard','Analytics','Remote'] },
    { id:'whatsapp',  x:965, y:182, w:145, h:42, label:'WhatsApp',        icon:'\ud83d\udcac', color:'#1a5c38', detail:'With Master Cloud: alerts and reports sent to your WhatsApp when you\'re away from the boat. Send commands back in plain English.', tags:['Optional','E2E Encrypted','Two-Way'] },
    { id:'cmdapp_r',  x:965, y:268, w:155, h:40, label:'Commander App',   icon:'\ud83d\udcca', color:'#374151', detail:'With Master Cloud: access your boat remotely from any browser. Live telemetry, historical charts, camera feeds — same app, works from anywhere.', tags:['Optional','Remote','Any Browser'], sub:true },
    { id:'fleetmind', x:770, y:300, w:145, h:38, label:'FleetMind',       icon:'\ud83c\udf10', color:'#374151', detail:'With Master Cloud: join the FleetMind network. Crowdsourced wind, depth, anchorage intel, hazard alerts, and weather warnings from every connected boat.', tags:['Optional','Crowdsourced','Weather'], sub:true },
  ];

  const privateConnections = [
    ['commander','localnet'],
    ['localnet','cmdapp_l'],
    ['cmdapp_l','phone'],
    ['starlink','master'],
    ['master','whatsapp'],
    ['whatsapp','phone'],
    ['master','cmdapp_r'],
    ['master','fleetmind'],
    ['commander','aibrain'],
  ];

  // ---- Diagnostic-specific ----
  // Scanner → Internet → Master Cloud → Service Portal → Tech's Device
  const diagnosticNodes = [
    { id:'commander', x:390, y:182, w:155, h:48, label:'Diagnostic Scanner', icon:'\ud83e\udde0', color:'#92400e', detail:'Same Raspberry Pi 5 hardware as the Delivery Puck, configured for diagnostic scans. Portable — moves between boats. Plugs into any NMEA 2000 backbone for 24–48 hour deep analysis.', tags:['Raspberry Pi 5','Portable','24-48h Scan'] },
    { id:'master',    x:770, y:182, w:145, h:48, label:'Master Cloud',     icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Cloud processes the raw scan data into actionable diagnostic reports. Network topology mapping, anomaly detection, benchmark comparisons, and maintenance flags.', tags:['AI Analysis','Benchmarks','Reports'] },
    { id:'portal',    x:965, y:182, w:145, h:44, label:'Service Portal',    icon:'\ud83d\udcca', color:'#4c1d95', detail:'Dedicated web portal for marine professionals. View diagnostic reports, network topology maps, anomaly flags, and comparison benchmarks. Share reports with boat owners.', tags:['Reports','Network Map','Share'] },
    { id:'phone',     x:1170,y:182, w:130, h:44, label:"Tech's Device",     icon:'\ud83d\udcf1', color:'#1e3a5f', detail:"Marine technician accesses diagnostic reports via the Service Portal on any device — laptop, tablet, or phone.", tags:['Web Portal','Any Device'] },
    { id:'autodiscovery', x:340, y:280, w:130, h:36, label:'Deep Analysis', icon:'\ud83d\udd0d', color:'#374151', detail:'Extended 24–48 hour scan captures full operating patterns — charging cycles, parasitic draw, intermittent faults, and usage patterns that a short test would miss.', tags:['24-48h','Pattern Analysis','Deep Scan'], sub:true },
  ];

  const diagnosticConnections = [
    ['starlink','master'],
    ['master','portal'],
    ['portal','phone'],
  ];

  // ---- Delivery-specific ----
  // Puck → Internet → Master Cloud → WhatsApp → Captain + Owner
  const deliveryNodes = [
    { id:'commander', x:390, y:182, w:145, h:48, label:'Delivery Puck',    icon:'\ud83e\udde0', color:'#92400e', detail:'Plug-and-play Raspberry Pi 5 unit. Captain plugs into NMEA backbone, connects to internet (Starlink/WiFi/hotspot), and the puck monitors everything throughout the passage.', tags:['Raspberry Pi 5','Portable','Plug & Play'] },
    { id:'master',    x:770, y:182, w:145, h:48, label:'Master Cloud',     icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Cloud receives live telemetry from the puck during delivery. Generates passage reports, monitors for anomalies, and sends alerts to both captain and owner.', tags:['Live Telemetry','Passage Log','Alerts'] },
    { id:'whatsapp',  x:965, y:100, w:145, h:42, label:'WhatsApp',         icon:'\ud83d\udcac', color:'#1a5c38', detail:'Alerts and position reports sent to both the delivery captain and boat owner via WhatsApp. Two-way — captain can query systems in plain English.', tags:['Captain + Owner','Two-Way','Alerts'] },
    { id:'phone',     x:1170,y:100, w:130, h:42, label:"Captain's Phone",  icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'Delivery captain gets real-time alerts, position reports, and can query any system via WhatsApp during the passage.', tags:['WhatsApp','Real-Time'] },
    { id:'cmdapp',    x:965, y:182, w:155, h:42, label:'Commander App',    icon:'\ud83d\udcca', color:'#4c1d95', detail:'Web dashboard showing live passage data — position, engine status, battery levels, weather. Accessible to both captain and boat owner from any browser.', tags:['Live Tracking','Passage Data'] },
    { id:'owner',     x:1170,y:182, w:130, h:42, label:"Owner's Phone",    icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'Boat owner tracks the delivery remotely — live position, system health, and passage progress. Gets alerts if anything goes out of spec.', tags:['Remote Tracking','Peace of Mind'] },
    { id:'report',    x:965, y:268, w:155, h:38, label:'Delivery Report',  icon:'\ud83d\udcc4', color:'#4c1d95', detail:'Automated passage report generated at completion — engine hours, fuel used, route taken, weather encountered, any anomalies flagged. Professional handoff documentation.', tags:['Auto-Generated','PDF','Handoff'], sub:true },
  ];

  const deliveryConnections = [
    ['starlink','master'],
    ['master','whatsapp'],
    ['whatsapp','phone'],
    ['master','cmdapp'],
    ['cmdapp','owner'],
    ['master','report'],
  ];

  // ---- Build functions ----

  function getNodes() {
    const modeNodes = currentMode === 'charter' ? charterNodes : currentMode === 'private' ? privateNodes : currentMode === 'delivery' ? deliveryNodes : diagnosticNodes;
    const merged = new Map();
    sharedNodes.forEach(n => merged.set(n.id, n));
    modeNodes.forEach(n => merged.set(n.id, n));
    return Array.from(merged.values());
  }

  function getConnections() {
    const modeConns = currentMode === 'charter' ? charterConnections : currentMode === 'private' ? privateConnections : currentMode === 'delivery' ? deliveryConnections : diagnosticConnections;
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
      vw = 1380; vh = 380;
      container.style.minHeight = '440px';
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

      // Default: right edge → left edge (horizontal flow)
      let sx1 = a.x + a.w, sy1 = a.y + a.h/2;
      let sx2 = b.x,        sy2 = b.y + b.h/2;

      const toNode = nodes.find(n => n.id === to);

      // Sub nodes below parent: bottom-center → top-center
      if (toNode && toNode.sub && from !== 'master') {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }

      // Master → FleetMind: vertical (below)
      if (from === 'master' && (to === 'fleetmind')) {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }

      // Master → cmdapp_r: right edge → left edge
      if (from === 'master' && to === 'cmdapp_r') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/2;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }

      // Starlink → Master: handle vertical offset in private mode
      if (from === 'starlink' && to === 'master') {
        if (Math.abs(b.y - a.y) < 30) {
          // Same row — horizontal
          sx1 = a.x + a.w; sy1 = a.y + a.h/2;
          sx2 = b.x;        sy2 = b.y + b.h/2;
        } else {
          // Different rows — route down then right
          sx1 = a.x + a.w/2; sy1 = a.y + a.h;
          sx2 = b.x;          sy2 = b.y + b.h/2;
        }
      }

      // Commander → localnet (private): goes up-right
      if (from === 'commander' && to === 'localnet') {
        sx1 = a.x + a.w; sy1 = a.y;
        sx2 = b.x;        sy2 = b.y + b.h;
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
        x: 8, y: p.h/2 + 1, 'dominant-baseline': 'middle', class: 'node-icon', 'font-size': n.sub ? '11px' : '14px'
      });
      icon.textContent = n.icon;
      g.appendChild(icon);

      const label = createSVG('text', {
        x: n.sub ? 28 : 30, y: p.h/2 + 1, 'dominant-baseline': 'middle',
        fill: '#ffffff',
        'font-size': n.sub ? '10px' : '11.5px', 'font-weight': n.sub ? '400' : '600'
      });
      label.textContent = n.label;
      g.appendChild(label);

      g.addEventListener('click', () => showDetail(n));
      svg.appendChild(g);
    });
  }

  function mobileLayout(n) {
    const shared = {
      nmea:     { x:20,  y:20,  w:110, h:40 },
      power:    { x:140, y:20,  w:110, h:40 },
      sensors:  { x:260, y:20,  w:110, h:40 },
      cameras:  { x:60,  y:70,  w:120, h:40 },
      helm:     { x:200, y:70,  w:130, h:40 },
      signalk:  { x:140, y:135, w:170, h:46 },
      commander:{ x:130, y:225, w:190, h:46 },
      autodiscovery: { x:50, y:310, w:125, h:36 },
    };

    const charterMobile = {
      starlink: { x:80,  y:390, w:140, h:40 },
      master:   { x:250, y:390, w:150, h:40 },
      whatsapp: { x:40,  y:470, w:130, h:40 },
      phone:    { x:300, y:470, w:120, h:40 },
      cmdapp:   { x:170, y:470, w:130, h:40 },
      fleetmind:{ x:170, y:545, w:130, h:36 },
    };

    const privateMobile = {
      starlink: { x:40,  y:390, w:140, h:40 },
      localnet: { x:40,  y:470, w:140, h:40 },
      cmdapp_l: { x:200, y:470, w:140, h:40 },
      phone:    { x:170, y:545, w:140, h:42 },
      master:   { x:200, y:390, w:150, h:40 },
      whatsapp: { x:40,  y:545, w:130, h:40 },
      cmdapp_r: { x:40,  y:620, w:140, h:36 },
      fleetmind:{ x:200, y:620, w:140, h:36 },
      aibrain:  { x:210, y:310, w:120, h:36 },
    };

    const diagnosticMobile = {
      starlink: { x:80,  y:390, w:140, h:40 },
      master:   { x:250, y:390, w:150, h:40 },
      portal:   { x:80,  y:470, w:150, h:40 },
      phone:    { x:260, y:470, w:140, h:40 },
    };

    const deliveryMobile = {
      starlink: { x:80,  y:390, w:140, h:40 },
      master:   { x:250, y:390, w:150, h:40 },
      whatsapp: { x:40,  y:470, w:130, h:40 },
      phone:    { x:300, y:470, w:120, h:40 },
      cmdapp:   { x:40,  y:545, w:150, h:40 },
      owner:    { x:220, y:545, w:140, h:40 },
      report:   { x:130, y:620, w:150, h:36 },
    };

    const modeLayouts = currentMode === 'charter' ? charterMobile : currentMode === 'private' ? privateMobile : currentMode === 'delivery' ? deliveryMobile : diagnosticMobile;
    return shared[n.id] || modeLayouts[n.id] || { x: n.x * 0.35, y: n.y, w: n.w * 0.8, h: n.h * 0.85 };
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
