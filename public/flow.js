// Master&Commander — CSS-Based Flow Diagram (4 tabs)
(function() {
  let currentMode = 'charter';
  const stepsEl = document.getElementById('flow-steps');
  const outputsEl = document.getElementById('flow-outputs');
  const panel = document.getElementById('detail-panel');
  const panelTitle = document.getElementById('detail-title');
  const panelDesc = document.getElementById('detail-desc');
  const panelTags = document.getElementById('detail-tags');

  // =====================================================
  // DATA: Each mode defines a main flow (left→right) and outputs (branching from cloud)
  // =====================================================

  const modes = {
    charter: {
      label: 'Charter Fleet — Raspberry Pi + Cloud AI',
      steps: [
        { id:'sensors', icon:'⚓', label:'Marine Data', sub:'NMEA 2000 · Power Systems · Sensors · Cameras · Helm', color:'#1e3a5f',
          detail:'All your marine electronics — NMEA 2000 backbone, battery/power systems (Victron, Mastervolt, etc.), temperature sensors, IP cameras, and helm controls (ZF MicroCommander, autopilot). Auto-discovered, zero config.',
          tags:['NMEA 2000','Power Systems','Sensors','Cameras','Helm'] },
        { id:'signalk', icon:'🔄', label:'SignalK', sub:'Universal translator', color:'#0e4a2f',
          detail:'Included with every Commander Unit. SignalK translates all marine protocols into a unified data stream — the universal translator for boats.',
          tags:['Included','Open Source','Universal'] },
        { id:'commander', icon:'🧠', label:'Raspberry Pi', sub:'5W · Always-on · Auto-Discovery', color:'#7c2d12',
          detail:'Compact, always-on Commander Unit for charter fleets. Low power (5W), collects all sensor data and forwards to Master Cloud for AI processing. Runs Auto-Discovery to map every device on your network.',
          tags:['Raspberry Pi 5','5W','24/7','Always-On'] },
        { id:'internet', icon:'📡', label:'Internet', sub:'Starlink · WiFi · Hotspot', color:'#1e3a5f',
          detail:'Starlink, marina WiFi, or hotspot. Commander queues data when offline and syncs when connectivity returns.',
          tags:['Starlink','Marina WiFi','Store & Forward'] },
        { id:'master', icon:'☁️', label:'Master Cloud', sub:'AI processing · Fleet analytics', color:'#4c1d95',
          detail:'Included with every charter fleet plan. All AI processing happens here — natural language queries, trend analysis, predictive maintenance. Sends alerts via WhatsApp.',
          tags:['Included','Fleet Mgmt','Cloud AI','OTA'] },
      ],
      outputs: [
        { id:'whatsapp', icon:'💬', label:'WhatsApp Alerts', sub:'Two-way · Plain English', color:'#1a5c38',
          detail:'Master Cloud sends alerts and reports to your WhatsApp. Send commands back in plain English. No app needed — included with every charter plan.',
          tags:['Included','E2E Encrypted','Two-Way'] },
        { id:'cmdapp', icon:'📊', label:'Commander App', sub:'Fleet dashboard · Any browser', color:'#4c1d95',
          detail:'Full fleet view from any browser. Live telemetry, historical charts, cross-fleet analytics, camera feeds. Your fleet\'s control room — accessible from any device.',
          tags:['Web App','Fleet View','Analytics'] },
        { id:'fleetmind', icon:'🌐', label:'FleetMind', sub:'Crowdsourced fleet intel', color:'#4c1d95',
          detail:'Crowdsourced fleet intelligence. Wind field, depth, anchorage intel, passage conditions, hazard broadcasts. Every connected boat makes the network smarter.',
          tags:['Crowdsourced','Real-Time'] },
      ]
    },

    private: {
      label: 'Private Yacht — Mac Mini M4 + Local AI',
      steps: [
        { id:'sensors', icon:'⚓', label:'Marine Data', sub:'NMEA 2000 · Power · Sensors · Cameras/FLIR · Helm', color:'#1e3a5f',
          detail:'All your marine electronics plus FLIR thermal imaging. AI vision runs locally on the Mac Mini — intrusion detection, thermal anomalies, and deck monitoring processed on device.',
          tags:['NMEA 2000','Power Systems','Cameras','FLIR','Helm'] },
        { id:'signalk', icon:'🔄', label:'SignalK', sub:'Universal translator', color:'#0e4a2f',
          detail:'Included with every Commander Unit. SignalK translates all marine protocols into a unified data stream.',
          tags:['Included','Open Source'] },
        { id:'commander', icon:'🧠', label:'Mac Mini M4', sub:'Local AI · Qwen 14B · Offline capable', color:'#7c2d12',
          detail:'Full-power Commander Unit for private yachts. Apple M4 chip runs Qwen 14B AI locally — fully offline capable. AI vision for cameras and FLIR. No internet needed for core functions.',
          tags:['Mac Mini M4','Local AI','Offline','AI Vision'] },
      ],
      outputs: [
        { id:'localpath', icon:'📶', label:'On Board (No Internet)', sub:'WiFi/BLE → Commander App → Phone', color:'#0e4a2f', highlight:true,
          detail:'When you\'re on board, the Commander App connects directly over the boat\'s local WiFi or Bluetooth. Real-time gauges, alerts, camera feeds — no internet required. Full access to every system.',
          tags:['Local WiFi','Bluetooth','Zero Latency','Offline'] },
        { id:'remotepath', icon:'☁️', label:'Remote (Master Cloud)', sub:'Internet → Cloud → WhatsApp + App', color:'#374151', optional:true,
          detail:'Optional subscription. Adds remote access via WhatsApp alerts, Commander App from anywhere, historical analytics, and FleetMind. Commander works fully standalone without it.',
          tags:['Optional','WhatsApp','Remote Access','Analytics','FleetMind'] },
      ]
    },

    delivery: {
      label: 'Delivery Captain — Puck + WhatsApp',
      steps: [
        { id:'sensors', icon:'⚓', label:'Marine Data', sub:'NMEA 2000 · Power · Sensors · Helm', color:'#1e3a5f',
          detail:'The Delivery Puck reads everything on the NMEA backbone — engines, batteries, GPS, depth, wind. Monitors the boat throughout the entire passage.',
          tags:['NMEA 2000','Power Systems','GPS','Engines'] },
        { id:'signalk', icon:'🔄', label:'SignalK', sub:'Universal translator', color:'#0e4a2f',
          detail:'Built into the Delivery Puck. Translates all marine protocols automatically.',
          tags:['Included','Auto-Start'] },
        { id:'commander', icon:'🧠', label:'Delivery Puck', sub:'Plug & play · 60s setup', color:'#92400e',
          detail:'Plug-and-play Raspberry Pi 5 unit. Captain plugs into NMEA backbone, connects to internet (Starlink/WiFi/hotspot), and the puck monitors everything throughout the passage.',
          tags:['Raspberry Pi 5','Portable','Plug & Play'] },
        { id:'internet', icon:'📡', label:'Internet', sub:'Starlink · WiFi · Hotspot', color:'#1e3a5f',
          detail:'Any internet source — Starlink, marina WiFi, or mobile hotspot. Data queued when offline, synced when back online.',
          tags:['Starlink','WiFi','Store & Forward'] },
        { id:'master', icon:'☁️', label:'Master Cloud', sub:'Live telemetry · Passage log', color:'#4c1d95',
          detail:'Cloud receives live telemetry during delivery. Generates passage reports, monitors for anomalies, and sends alerts to both captain and owner.',
          tags:['Live Telemetry','Passage Log','Alerts'] },
      ],
      outputs: [
        { id:'captain', icon:'💬', label:'Captain (WhatsApp)', sub:'Alerts · Position · Commands', color:'#1a5c38',
          detail:'Delivery captain gets real-time alerts, position reports, and can query any system via WhatsApp during the passage. Two-way — ask in plain English.',
          tags:['WhatsApp','Real-Time','Two-Way'] },
        { id:'owner', icon:'📊', label:'Owner (App)', sub:'Live tracking · System health', color:'#4c1d95',
          detail:'Boat owner tracks the delivery remotely — live position, system health, and passage progress via Commander App. Gets alerts if anything goes out of spec.',
          tags:['Remote Tracking','Peace of Mind'] },
        { id:'report', icon:'📄', label:'Delivery Report', sub:'Auto-generated at completion', color:'#4c1d95',
          detail:'Automated passage report — engine hours, fuel used, route taken, weather encountered, any anomalies flagged. Professional handoff documentation.',
          tags:['Auto-Generated','PDF','Handoff'] },
      ]
    },

    diagnostic: {
      label: 'Diagnostic — Scanner + Service Portal',
      steps: [
        { id:'sensors', icon:'⚓', label:'Marine Data', sub:'Full NMEA backbone scan', color:'#1e3a5f',
          detail:'The Diagnostic Scanner reads every device on the NMEA 2000 backbone — every address, every PGN. Deep 24-48 hour analysis captures patterns a short test would miss.',
          tags:['NMEA 2000','Full Scan','24-48h'] },
        { id:'signalk', icon:'🔄', label:'SignalK', sub:'Universal translator', color:'#0e4a2f',
          detail:'Built into the scanner. Auto-discovers and translates all marine protocols.',
          tags:['Included','Auto-Discovery'] },
        { id:'commander', icon:'🧠', label:'Diagnostic Scanner', sub:'Portable · 24-48h deep scan', color:'#92400e',
          detail:'Same Raspberry Pi 5 hardware as the Delivery Puck. Portable — moves between boats. Plugs into any NMEA 2000 backbone for deep analysis.',
          tags:['Raspberry Pi 5','Portable','24-48h Scan'] },
        { id:'internet', icon:'📡', label:'Internet', sub:'Upload scan data', color:'#1e3a5f',
          detail:'Scan data uploads to Master Cloud for AI analysis when internet is available.',
          tags:['WiFi','Upload'] },
        { id:'master', icon:'☁️', label:'Master Cloud', sub:'AI analysis · Benchmarks', color:'#4c1d95',
          detail:'Cloud processes raw scan data into actionable diagnostic reports. Network topology mapping, anomaly detection, benchmark comparisons, and maintenance flags.',
          tags:['AI Analysis','Benchmarks','Reports'] },
      ],
      outputs: [
        { id:'portal', icon:'📊', label:'Service Portal', sub:'Reports · Network maps · Share', color:'#4c1d95',
          detail:'Dedicated web portal for marine professionals. View diagnostic reports, network topology maps, anomaly flags, and comparison benchmarks. Share reports with boat owners.',
          tags:['Reports','Network Map','Share'] },
        { id:'tech', icon:'📱', label:"Tech's Device", sub:'Laptop · Tablet · Phone', color:'#1e3a5f',
          detail:'Marine technician accesses diagnostic reports via the Service Portal on any device.',
          tags:['Any Device','Web Portal'] },
      ]
    }
  };

  function build() {
    const mode = modes[currentMode];
    stepsEl.innerHTML = '';
    outputsEl.innerHTML = '';

    // Build main flow steps
    mode.steps.forEach((step, i) => {
      if (i > 0) {
        const arrow = document.createElement('div');
        arrow.className = 'flow-arrow';
        arrow.innerHTML = '→';
        stepsEl.appendChild(arrow);
      }
      stepsEl.appendChild(createNode(step));
    });

    // Build output branches
    if (mode.outputs.length > 0) {
      const branchLabel = document.createElement('div');
      branchLabel.className = 'flow-branch-label';
      branchLabel.textContent = currentMode === 'private' ? 'Two paths to your phone:' : 'Delivers to:';
      outputsEl.appendChild(branchLabel);

      const outputGrid = document.createElement('div');
      outputGrid.className = 'flow-output-grid';
      mode.outputs.forEach(out => {
        const node = createNode(out);
        if (out.optional) node.classList.add('flow-optional');
        if (out.highlight) node.classList.add('flow-highlight');
        outputGrid.appendChild(node);
      });
      outputsEl.appendChild(outputGrid);
    }
  }

  function createNode(data) {
    const node = document.createElement('div');
    node.className = 'flow-node';
    node.style.setProperty('--node-color', data.color);
    node.innerHTML = `
      <div class="flow-node-icon">${data.icon}</div>
      <div class="flow-node-label">${data.label}</div>
      <div class="flow-node-sub">${data.sub}</div>
    `;
    node.addEventListener('click', () => showDetail(data));
    return node;
  }

  function showDetail(data) {
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    panelTitle.innerHTML = `<span>${data.icon}</span> ${data.label}`;
    panelDesc.textContent = data.detail;
    panelTags.innerHTML = (data.tags || []).map(t => `<span class="detail-tag">${t}</span>`).join('');
    panel.classList.add('visible');
  }

  // Tab switching
  window.setFlowMode = function(mode) {
    currentMode = mode;
    document.querySelectorAll('.flow-tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.flow-tab-btn[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    panel.classList.remove('visible');
    build();
  };

  // Close detail panel
  document.getElementById('detail-close').addEventListener('click', () => {
    panel.classList.remove('visible');
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
  });

  build();
})();
