// Master&Commander — Interactive Flow Diagram
(function() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const container = document.getElementById('flow-container');
  const panel = document.getElementById('detail-panel');
  const panelTitle = document.getElementById('detail-title');
  const panelDesc = document.getElementById('detail-desc');
  const panelTags = document.getElementById('detail-tags');
  let activeNode = null;

  // Node definitions
  const nodes = [
    { id:'nmea',     x:60,  y:80,  w:140, h:52, label:'NMEA 2000',     icon:'\u2693', color:'#1e3a5f', detail:'Industry-standard marine data bus. Connects engines, GPS, depth, wind, tanks, AIS, and more.', tags:['CAN bus','SAE J1939','Plug & Play'] },
    { id:'victron',  x:60,  y:165, w:140, h:52, label:'Victron',       icon:'\u26a1', color:'#1e3a5f', detail:'Battery monitors, inverters, solar chargers, and shore power. Commander reads all Victron devices automatically.', tags:['VE.Bus','MPPT','BMV'] },
    { id:'sensors',  x:60,  y:250, w:140, h:52, label:'Sensors',       icon:'\ud83c\udf21\ufe0f', color:'#1e3a5f', detail:'Temperature, humidity, bilge pump counters, tank levels, barometric pressure. Any sensor on your network is auto-detected.', tags:['OneWire','I2C','WiFi'] },
    { id:'cameras',  x:60,  y:335, w:140, h:52, label:'Cameras / FLIR', icon:'\ud83d\udcf7', color:'#1e3a5f', detail:'Security cameras, FLIR thermal imaging, night vision. Monitor your vessel visually \u2014 on board or from shore. AI vision for intrusion and thermal alerts.', tags:['IP Cameras','FLIR','Night Vision','AI Vision'] },
    { id:'signalk',  x:320, y:165, w:150, h:52, label:'SignalK Server', icon:'\ud83d\udd04', color:'#0e4a2f', detail:'Included with every Commander Unit. SignalK translates all marine protocols into a unified data stream \u2014 the universal translator for boats.', tags:['Included','Open Source','Universal'] },
    { id:'commander',x:500, y:190, w:160, h:52, label:'Commander Unit', icon:'\ud83e\udde0', color:'#7c2d12', detail:'The brain on board. Monitors 24/7 and reaches you three ways: directly on board via app, WhatsApp alerts when you have internet, and the full Master dashboard if you subscribe.', tags:['Compact','24/7','Offline'] },
    // ON-BOARD path (top) — no internet needed
    { id:'localnet', x:730, y:55,  w:155, h:46, label:'Boat WiFi / BLE', icon:'\ud83d\udcf6', color:'#1e3a5f', detail:'When you\u2019re on board, the Commander App connects directly over the boat\u2019s local WiFi or Bluetooth. No internet needed. Full access to every system.', tags:['Local WiFi','Bluetooth','Zero Latency','No Internet'] },
    { id:'app',      x:950, y:55,  w:155, h:46, label:'Commander App',   icon:'\ud83d\udcf1', color:'#0e4a2f', detail:'Native app for iOS and Android. On board: connects directly via WiFi or Bluetooth. Real-time gauges, alerts, camera feeds, and full command interface \u2014 no internet required.', tags:['iOS','Android','Real-Time','Offline'] },
    { id:'phone',    x:1160,y:55,  w:130, h:46, label:'Your Phone',      icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'On board: Commander App connects directly \u2014 no internet. With Starlink: WhatsApp alerts. With Master: full cloud dashboard, push notifications, fleet view.', tags:['iOS','Android'] },
    // INTERNET path (middle) — Commander-only with Starlink
    { id:'starlink', x:730, y:185, w:155, h:46, label:'Starlink / WiFi', icon:'\ud83d\udce1', color:'#1e3a5f', detail:'Starlink, marina WiFi, or cellular. With just Commander + internet, you get WhatsApp alerts directly. Commander queues data when offline and syncs when connectivity returns.', tags:['Starlink','Marina WiFi','Cellular','Store & Forward'] },
    { id:'whatsapp', x:950, y:185, w:155, h:46, label:'WhatsApp',        icon:'\ud83d\udcac', color:'#1a5c38', detail:'Works with just Commander + internet \u2014 no Master subscription needed. Commander sends alerts and reports directly to your WhatsApp. Send commands back in plain English.', tags:['Included','E2E Encrypted','Two-Way'] },
    // MASTER path (bottom) — premium subscription
    { id:'master',   x:730, y:325, w:155, h:46, label:'Master (Cloud)',   icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Optional subscription. Remote provisioning, software updates, historical analytics, owner dashboard, and fleet management. Commander works without it \u2014 Master makes it smarter.', tags:['Subscription','Dashboard','Analytics','Fleet'] },
    { id:'push',     x:950, y:300, w:140, h:40, label:'Push Alerts',     icon:'\ud83d\udd14', color:'#4c1d95', detail:'Critical alerts via push notifications through the Commander App. Battery critical, anchor drag, bilge alarm \u2014 even if WhatsApp is closed.', tags:['Master','Push Notifications'], sub:true },
    { id:'dashboard',x:950, y:355, w:140, h:40, label:'Web Dashboard',   icon:'\ud83d\udcca', color:'#4c1d95', detail:'Full web dashboard accessible from any browser. Historical charts, live telemetry, camera feeds, fleet overview. Your boat\u2019s control room in the cloud.', tags:['Master','Analytics','Live View'], sub:true },
    // Sub-modules (below Commander)
    { id:'autodiscovery', x:420, y:290, w:135, h:42, label:'Auto-Discovery', icon:'\ud83d\udd0d', color:'#374151', detail:'Commander scans your network and learns what sensors YOUR boat has. Twin engines? Two batteries? No config needed.', tags:['Zero Config','Adaptive'], sub:true },
    { id:'alertengine',   x:570, y:290, w:125, h:42, label:'Alert Engine',   icon:'\ud83d\udea8', color:'#374151', detail:'Pure if/else code \u2014 no AI. Monitors thresholds 24/7. Battery low? Engine hot? Bilge pumping? You get alerted via app, WhatsApp, or push notification.', tags:['Rule-Based','No AI','Reliable'], sub:true },
    { id:'quickcmds',     x:420, y:350, w:125, h:42, label:'Quick Cmds',     icon:'\u26a1', color:'#374151', detail:'Instant responses: status, engines, battery, tanks, wind, anchor, position. Pre-built templates, no AI latency.', tags:['Instant','Templates'], sub:true },
    { id:'aibrain',       x:570, y:350, w:125, h:42, label:'AI Brain',       icon:'\ud83e\udd16', color:'#374151', detail:'Local AI runs directly on the Commander Unit \u2014 fully offline. With internet, taps cloud AI for deeper analysis.', tags:['On-Device','Offline','Cloud Optional'], sub:true },
  ];

  // Connections: [fromId, toId]
  const connections = [
    ['nmea','signalk'],
    ['victron','signalk'],
    ['sensors','signalk'],
    ['cameras','signalk'],
    ['signalk','commander'],
    // On-board path (no internet)
    ['commander','localnet'],
    ['localnet','app'],
    ['app','phone'],
    // Internet path (Commander + Starlink)
    ['commander','starlink'],
    ['starlink','whatsapp'],
    ['whatsapp','phone'],
    // Master path (subscription)
    ['starlink','master'],
    ['master','push'],
    ['master','dashboard'],
    ['commander','autodiscovery'],
    ['commander','alertengine'],
    ['commander','quickcmds'],
    ['commander','aibrain'],
  ];

  function build() {
    const isMobile = window.innerWidth < 768;
    const svg = document.getElementById('flow-svg');
    svg.innerHTML = '';

    // Scale for viewport
    let scale, tx, ty, vw, vh;
    if (isMobile) {
      vw = 500; vh = 700;
      container.style.minHeight = '600px';
      scale = 0.4; tx = 10; ty = 20;
    } else {
      vw = 1340; vh = 440;
      // increase container min-height
      container.style.minHeight = '500px';
      scale = 1; tx = 0; ty = 0;
    }
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

    // Position adjustments for mobile (vertical stack)
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
      const x1 = a.x + a.w, y1 = a.y + a.h/2;
      const x2 = b.x,       y2 = b.y + b.h/2;
      // special: sub-nodes connect from commander bottom
      let sx1=x1, sy1=y1, sx2=x2, sy2=y2;
      const toNode = nodes.find(n=>n.id===to);
      if (toNode && toNode.sub) {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }
      // starlink → master goes down
      if (from === 'starlink' && to === 'master') {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }
      // commander → localnet goes up-right
      if (from === 'commander' && to === 'localnet') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/4;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }
      // commander → starlink goes right
      if (from === 'commander' && to === 'starlink') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/2;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }
      // whatsapp → phone goes up-right
      if (from === 'whatsapp' && to === 'phone') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/2;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }

      const pathId = `path-${from}-${to}`;
      const mx = (sx1+sx2)/2;
      const d = `M${sx1},${sy1} C${mx},${sy1} ${mx},${sy2} ${sx2},${sy2}`;
      const path = createSVG('path', { d, id: pathId, class:'flow-line' });
      svg.appendChild(path);

      // Animated pulse circle along path
      const circle = createSVG('circle', { r: 3.5, class:'flow-pulse active' });
      const anim = createSVG('animateMotion', {
        dur: (2.5 + i*0.3) + 's',
        repeatCount: 'indefinite',
        begin: (i*0.4) + 's'
      });
      const mpath = createSVG('mpath');
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#'+pathId);
      anim.appendChild(mpath);
      circle.appendChild(anim);
      svg.appendChild(circle);
    });

    // Draw nodes
    nodes.forEach(n => {
      const p = pos[n.id];
      const g = createSVG('g', { class:'flow-node', 'data-id': n.id, transform:`translate(${p.x},${p.y})` });

      // Background rect
      const rect = createSVG('rect', {
        width: p.w, height: p.h, fill: n.color,
        stroke: n.sub ? '#4b5563' : '#334155', 'stroke-width': n.sub ? 1 : 1.5,
        rx: 8, ry: 8, class: 'node-bg'
      });
      g.appendChild(rect);

      // Icon
      const icon = createSVG('text', {
        x: 12, y: p.h/2 + 1, 'dominant-baseline':'middle', class:'node-icon', 'font-size': n.sub ? '14px' : '18px'
      });
      icon.textContent = n.icon;
      g.appendChild(icon);

      // Label
      const label = createSVG('text', {
        x: n.sub ? 32 : 38, y: p.h/2 + 1, 'dominant-baseline':'middle',
        'font-size': n.sub ? '11px' : '13px', 'font-weight': n.sub ? '400' : '600'
      });
      label.textContent = n.label;
      g.appendChild(label);

      g.addEventListener('click', () => showDetail(n));
      svg.appendChild(g);
    });
  }

  function mobileLayout(n) {
    // Vertical stack layout for mobile
    const layouts = {
      nmea:     { x:30,  y:20,  w:130, h:45 },
      victron:  { x:180, y:20,  w:130, h:45 },
      sensors:  { x:330, y:20,  w:130, h:45 },
      cameras:  { x:105, y:70,  w:140, h:45 },
      signalk:  { x:155, y:140, w:180, h:50 },
      commander:{ x:140, y:240, w:200, h:50 },
      // On-board path
      localnet: { x:50,  y:440, w:150, h:42 },
      app:      { x:220, y:440, w:150, h:42 },
      phone:    { x:155, y:500, w:170, h:46 },
      // Internet path
      starlink: { x:50,  y:570, w:150, h:42 },
      whatsapp: { x:220, y:570, w:150, h:42 },
      // Master path
      master:   { x:50,  y:640, w:150, h:42 },
      push:     { x:220, y:630, w:120, h:36 },
      dashboard:{ x:350, y:630, w:120, h:36 },
      // Sub-modules
      autodiscovery: { x:50,  y:330, w:130, h:38 },
      alertengine:   { x:200, y:330, w:120, h:38 },
      quickcmds:     { x:340, y:330, w:120, h:38 },
      aibrain:       { x:110, y:380, w:120, h:38 },
    };
    return layouts[n.id] || { x:n.x*0.4, y:n.y, w:n.w*0.8, h:n.h*0.85 };
  }

  function showDetail(n) {
    // Clear active
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
    const el = document.querySelector(`.flow-node[data-id="${n.id}"]`);
    if (el) el.classList.add('active');

    panelTitle.innerHTML = `<span>${n.icon}</span> ${n.label}`;
    panelDesc.textContent = n.detail;
    panelTags.innerHTML = (n.tags||[]).map(t => `<span class="detail-tag">${t}</span>`).join('');
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
    if (attrs) Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    return el;
  }

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
