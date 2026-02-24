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
    { id:'victron',  x:60,  y:165, w:140, h:52, label:'Victron',       icon:'\u26a1', color:'#1e3a5f', detail:'Battery monitors, inverters, solar chargers, and shore power. Reports via VE.Bus or VE.Direct to SignalK.', tags:['VE.Bus','MPPT','BMV'] },
    { id:'sensors',  x:60,  y:250, w:140, h:52, label:'Sensors',       icon:'\ud83c\udf21\ufe0f', color:'#1e3a5f', detail:'Temperature, humidity, bilge pump counters, tank levels, barometric pressure. Anything wired or wireless feeding SignalK.', tags:['OneWire','I2C','WiFi'] },
    { id:'signalk',  x:320, y:165, w:150, h:52, label:'SignalK Server', icon:'\ud83d\udd04', color:'#0e4a2f', detail:'Open-source middleware that translates all marine protocols into a single JSON WebSocket stream. The universal translator.', tags:['WebSocket','JSON','REST API','Open Source'] },
    { id:'commander',x:580, y:165, w:160, h:52, label:'Commander',     icon:'\ud83e\udde0', color:'#7c2d12', detail:'The brain on board. Runs on a Mac Mini at your nav station. Auto-discovers sensors, monitors 24/7, alerts you via WhatsApp.', tags:['Mac Mini','Node.js','24/7','Offline'] },
    { id:'whatsapp', x:850, y:165, w:140, h:52, label:'WhatsApp',      icon:'\ud83d\udcac', color:'#1a5c38', detail:'Your interface. Send commands, get alerts, ask questions in plain English. Nothing to install \u2014 you already have it.', tags:['Baileys','E2E Encrypted'] },
    { id:'phone',    x:1080,y:165, w:130, h:52, label:'Your Phone',    icon:'\ud83d\udcf1', color:'#1e3a5f', detail:'Alerts and reports appear as regular WhatsApp messages. Works anywhere you have signal \u2014 marina WiFi, cellular, Starlink.', tags:['iOS','Android'] },
    // Sub-modules (below Commander)
    { id:'autodiscovery', x:500, y:290, w:135, h:42, label:'Auto-Discovery', icon:'\ud83d\udd0d', color:'#374151', detail:'Commander scans SignalK data paths and learns what sensors YOUR boat has. Twin engines? Two batteries? No config needed.', tags:['Zero Config','Adaptive'], sub:true },
    { id:'alertengine',   x:650, y:290, w:125, h:42, label:'Alert Engine',   icon:'\ud83d\udea8', color:'#374151', detail:'Pure if/else code \u2014 no AI. Monitors thresholds 24/7. Battery low? Engine hot? Bilge pumping? You get a WhatsApp alert.', tags:['Rule-Based','No AI','Reliable'], sub:true },
    { id:'quickcmds',     x:500, y:350, w:125, h:42, label:'Quick Cmds',     icon:'\u26a1', color:'#374151', detail:'Instant responses: status, engines, battery, tanks, wind, anchor, position. Pre-built templates, no AI latency.', tags:['Instant','Templates'], sub:true },
    { id:'aibrain',       x:650, y:350, w:125, h:42, label:'AI Brain',       icon:'\ud83e\udd16', color:'#374151', detail:'Qwen 14B runs locally on the Mac Mini \u2014 fully offline. Or route to Claude via Starlink for deeper analysis.', tags:['Qwen 14B','Claude','Ollama'], sub:true },
    { id:'simulator',     x:320, y:290, w:140, h:42, label:'Simulator',      icon:'\ud83c\udfae', color:'#374151', detail:'Test without a boat. Simulates catamaran, monohull, or powerboat profiles. Switch scenarios on the fly.', tags:['Demo','Testing','3 Profiles'], sub:true },
  ];

  // Connections: [fromId, toId]
  const connections = [
    ['nmea','signalk'],
    ['victron','signalk'],
    ['sensors','signalk'],
    ['signalk','commander'],
    ['commander','whatsapp'],
    ['whatsapp','phone'],
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
      vw = 500; vh = 700;
      scale = 0.4; tx = 10; ty = 20;
    } else {
      vw = 1300; vh = 440;
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
      signalk:  { x:155, y:110, w:180, h:50 },
      commander:{ x:140, y:210, w:200, h:50 },
      whatsapp: { x:155, y:380, w:180, h:50 },
      phone:    { x:170, y:470, w:150, h:50 },
      autodiscovery: { x:50,  y:300, w:130, h:38 },
      alertengine:   { x:200, y:300, w:120, h:38 },
      quickcmds:     { x:340, y:300, w:120, h:38 },
      aibrain:       { x:110, y:350, w:120, h:38 },
      simulator:     { x:340, y:110, w:130, h:42 },
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
