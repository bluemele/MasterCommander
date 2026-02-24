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
    { id:'commander',x:500, y:165, w:160, h:52, label:'Commander Unit', icon:'\ud83e\udde0', color:'#7c2d12', detail:'The brain on board. A compact unit at your nav station that auto-discovers sensors, monitors 24/7, and sends telemetry to Master via Starlink or marina WiFi. Runs offline when there\u2019s no connection.', tags:['Compact','24/7','Offline'] },
    { id:'starlink', x:720, y:165, w:150, h:52, label:'Starlink / WiFi', icon:'\ud83d\udce1', color:'#1e3a5f', detail:'Starlink, marina WiFi, or cellular \u2014 any internet connection. Commander queues data when offline and syncs when connectivity returns.', tags:['Starlink','Marina WiFi','Cellular','Store & Forward'] },
    { id:'master',   x:930, y:80,  w:160, h:52, label:'Master (Cloud)', icon:'\u2601\ufe0f', color:'#4c1d95', detail:'Master provisions and manages every Commander Unit remotely. Software updates, alert tuning, owner dashboard, fleet management, and historical analytics. Delivers your alerts via WhatsApp.', tags:['Provisioning','Updates','Dashboard','Subscription'] },
    { id:'whatsapp', x:930, y:250, w:140, h:52, label:'WhatsApp',      icon:'\ud83d\udcac', color:'#1a5c38', detail:'Your interface. Master delivers alerts and reports to your WhatsApp. Send commands back in plain English. Nothing to install \u2014 you already have it.', tags:['E2E Encrypted','Free'] },
    { id:'phone',    x:1140,y:165, w:130, h:52, label:'Your Phone',    icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'Alerts and reports appear as regular WhatsApp messages. Access the Master dashboard from any browser for deeper insights.', tags:['iOS','Android','Dashboard'] },
    // Sub-modules (below Commander)
    { id:'autodiscovery', x:420, y:290, w:135, h:42, label:'Auto-Discovery', icon:'\ud83d\udd0d', color:'#374151', detail:'Commander scans your network and learns what sensors YOUR boat has. Twin engines? Two batteries? No config needed.', tags:['Zero Config','Adaptive'], sub:true },
    { id:'alertengine',   x:570, y:290, w:125, h:42, label:'Alert Engine',   icon:'\ud83d\udea8', color:'#374151', detail:'Pure if/else code \u2014 no AI. Monitors thresholds 24/7. Battery low? Engine hot? Bilge pumping? You get a WhatsApp alert.', tags:['Rule-Based','No AI','Reliable'], sub:true },
    { id:'quickcmds',     x:420, y:350, w:125, h:42, label:'Quick Cmds',     icon:'\u26a1', color:'#374151', detail:'Instant responses: status, engines, battery, tanks, wind, anchor, position. Pre-built templates, no AI latency.', tags:['Instant','Templates'], sub:true },
    { id:'aibrain',       x:570, y:350, w:125, h:42, label:'AI Brain',       icon:'\ud83e\udd16', color:'#374151', detail:'Local AI runs directly on the Commander Unit \u2014 fully offline. With internet, taps cloud AI for deeper analysis.', tags:['On-Device','Offline','Cloud Optional'], sub:true },
    { id:'simulator',     x:320, y:290, w:140, h:42, label:'Demo Mode',      icon:'\ud83c\udfae', color:'#374151', detail:'See Commander in action with simulated boat data. Choose your boat type and watch real alerts and reports.', tags:['Live Demo','3 Boat Types'], sub:true },
  ];

  // Connections: [fromId, toId]
  const connections = [
    ['nmea','signalk'],
    ['victron','signalk'],
    ['sensors','signalk'],
    ['cameras','signalk'],
    ['signalk','commander'],
    ['commander','starlink'],
    ['starlink','master'],
    ['master','whatsapp'],
    ['whatsapp','phone'],
    ['master','phone'],
    ['signalk','simulator'],
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
      vw = 500; vh = 660;
      scale = 0.4; tx = 10; ty = 20;
    } else {
      vw = 1340; vh = 440;
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
      // master → whatsapp goes down
      if (from === 'master' && to === 'whatsapp') {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
      }
      // starlink → master goes up-right
      if (from === 'starlink' && to === 'master') {
        sx1 = a.x + a.w; sy1 = a.y + a.h/2;
        sx2 = b.x;        sy2 = b.y + b.h/2;
      }
      // simulator connects from signalk bottom
      if (to === 'simulator') {
        sx1 = a.x + a.w/2; sy1 = a.y + a.h;
        sx2 = b.x + b.w/2; sy2 = b.y;
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
      starlink: { x:155, y:440, w:180, h:50 },
      master:   { x:155, y:510, w:180, h:50 },
      whatsapp: { x:55,  y:580, w:160, h:50 },
      phone:    { x:260, y:580, w:150, h:50 },
      autodiscovery: { x:50,  y:330, w:130, h:38 },
      alertengine:   { x:200, y:330, w:120, h:38 },
      quickcmds:     { x:340, y:330, w:120, h:38 },
      aibrain:       { x:110, y:380, w:120, h:38 },
      simulator:     { x:340, y:140, w:130, h:42 },
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
