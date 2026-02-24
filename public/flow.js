// Master&Commander — CSS-Based Flow Diagram (4 tabs) with Screen Mockups
(function() {
  let currentMode = 'charter';
  const stepsEl = document.getElementById('flow-steps');
  const outputsEl = document.getElementById('flow-outputs');
  const panel = document.getElementById('detail-panel');
  const panelTitle = document.getElementById('detail-title');
  const panelDesc = document.getElementById('detail-desc');
  const panelTags = document.getElementById('detail-tags');
  const panelMockup = document.getElementById('detail-mockup');

  // =====================================================
  // MOCKUP TEMPLATES — Visual previews of app screens
  // =====================================================

  const mockups = {
    // Commander App — Fleet Dashboard (Charter)
    cmdapp: `
      <div class="mockup-screen">
        <div class="mockup-topbar">
          <span class="mockup-logo">⚓ Commander</span>
          <span class="mockup-nav">Fleet Overview</span>
          <span class="mockup-user">👤 Manager</span>
        </div>
        <div class="mockup-stats-row">
          <div class="mockup-stat"><div class="mockup-stat-num ok">12</div><div class="mockup-stat-label">Boats Online</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num warn">2</div><div class="mockup-stat-label">Alerts Active</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num">8</div><div class="mockup-stat-label">On Charter</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num">4</div><div class="mockup-stat-label">In Marina</div></div>
        </div>
        <div class="mockup-fleet-grid">
          <div class="mockup-boat-card">
            <div class="mockup-boat-header">
              <strong>SV Athena</strong>
              <span class="mockup-status online">● Online</span>
            </div>
            <div class="mockup-boat-gauges">
              <div class="mockup-gauge"><div class="mockup-gauge-bar" style="width:87%"></div><span>Battery 87%</span></div>
              <div class="mockup-gauge"><div class="mockup-gauge-bar engine" style="width:62%"></div><span>Engine 1450 RPM</span></div>
            </div>
            <div class="mockup-boat-meta">📍 Corfu · 🌡 24°C · 💨 12 kts NW</div>
          </div>
          <div class="mockup-boat-card alert">
            <div class="mockup-boat-header">
              <strong>MV Poseidon</strong>
              <span class="mockup-status alert">⚠ Alert</span>
            </div>
            <div class="mockup-boat-gauges">
              <div class="mockup-gauge"><div class="mockup-gauge-bar low" style="width:23%"></div><span>Battery 23% ⚠</span></div>
              <div class="mockup-gauge"><div class="mockup-gauge-bar" style="width:0%"></div><span>Engine Off</span></div>
            </div>
            <div class="mockup-boat-meta">📍 Lefkada · Shore power disconnected</div>
          </div>
          <div class="mockup-boat-card">
            <div class="mockup-boat-header">
              <strong>SV Calypso</strong>
              <span class="mockup-status online">● Online</span>
            </div>
            <div class="mockup-boat-gauges">
              <div class="mockup-gauge"><div class="mockup-gauge-bar" style="width:95%"></div><span>Battery 95%</span></div>
              <div class="mockup-gauge"><div class="mockup-gauge-bar engine" style="width:45%"></div><span>Engine 980 RPM</span></div>
            </div>
            <div class="mockup-boat-meta">📍 Kefalonia · 🌡 26°C · ⚓ Anchored</div>
          </div>
        </div>
      </div>`,

    // WhatsApp Alerts
    whatsapp: `
      <div class="mockup-screen mockup-whatsapp">
        <div class="mockup-wa-header">
          <div class="mockup-wa-avatar">⚓</div>
          <div><strong>Commander</strong><br><span class="mockup-wa-status">online</span></div>
        </div>
        <div class="mockup-wa-chat">
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            ⚠️ <strong>MV Poseidon — Battery Alert</strong><br>
            House bank dropped to 23%. Shore power appears disconnected. Bilge pump ran 3x in last hour.<br>
            <span class="mockup-wa-time">10:34 AM</span>
          </div>
          <div class="mockup-wa-msg sent">
            status poseidon<br>
            <span class="mockup-wa-time">10:35 AM ✓✓</span>
          </div>
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            <strong>MV Poseidon — Full Status</strong><br>
            🔋 House: 23% (discharging)<br>
            🔋 Start: 98%<br>
            ⚡ Shore: Disconnected<br>
            🌡️ Engine room: 31°C<br>
            💧 Bilge: 3 cycles/hr<br>
            📍 38.6328°N, 20.7064°E<br>
            <span class="mockup-wa-time">10:35 AM</span>
          </div>
          <div class="mockup-wa-msg sent">
            tell marina to reconnect shore power<br>
            <span class="mockup-wa-time">10:36 AM ✓✓</span>
          </div>
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            ✅ Message sent to Lefkada Marina: "Please reconnect shore power to MV Poseidon, Berth C-14."<br>
            <span class="mockup-wa-time">10:36 AM</span>
          </div>
        </div>
      </div>`,

    // BigBlue — Crowdsourced intelligence
    fleetmind: `
      <div class="mockup-screen">
        <div class="mockup-topbar">
          <span class="mockup-logo">🌐 BigBlue</span>
          <span class="mockup-nav">Live Intel</span>
          <span class="mockup-user">Ionian Sea</span>
        </div>
        <div class="mockup-map">
          <div class="mockup-map-bg">
            <div class="mockup-map-label" style="top:15%;left:20%">💨 NW 15kts</div>
            <div class="mockup-map-label" style="top:35%;left:55%">⚓ Calm anchorage</div>
            <div class="mockup-map-label alert" style="top:60%;left:30%">⚠ Shallow 1.8m</div>
            <div class="mockup-map-dot" style="top:25%;left:40%"></div>
            <div class="mockup-map-dot" style="top:45%;left:60%"></div>
            <div class="mockup-map-dot" style="top:55%;left:45%"></div>
            <div class="mockup-map-dot" style="top:30%;left:70%"></div>
            <div class="mockup-map-dot" style="top:70%;left:55%"></div>
          </div>
        </div>
        <div class="mockup-intel-feed">
          <div class="mockup-intel-item">🌊 <strong>Passage Report:</strong> Corfu → Paxos — 2.5h, moderate swell from NW</div>
          <div class="mockup-intel-item">⚓ <strong>Anchorage:</strong> Lakka Bay — good holding, 4-6m depth, currently 8 boats</div>
          <div class="mockup-intel-item">⚠️ <strong>Hazard:</strong> Floating debris reported near 39.12°N, 20.05°E</div>
        </div>
      </div>`,

    // On Board — Local WiFi Dashboard (Private)
    localpath: `
      <div class="mockup-screen">
        <div class="mockup-topbar">
          <span class="mockup-logo">⚓ Commander</span>
          <span class="mockup-nav">On Board</span>
          <span class="mockup-user">📶 Local WiFi</span>
        </div>
        <div class="mockup-gauges-grid">
          <div class="mockup-live-gauge">
            <div class="mockup-gauge-ring" style="--pct:87;--color:#10b981">
              <div class="mockup-gauge-center">87%</div>
            </div>
            <div class="mockup-gauge-title">House Bank</div>
            <div class="mockup-gauge-detail">284 Ah · Charging</div>
          </div>
          <div class="mockup-live-gauge">
            <div class="mockup-gauge-ring" style="--pct:98;--color:#10b981">
              <div class="mockup-gauge-center">98%</div>
            </div>
            <div class="mockup-gauge-title">Start Battery</div>
            <div class="mockup-gauge-detail">12.8V · Full</div>
          </div>
          <div class="mockup-live-gauge">
            <div class="mockup-gauge-ring" style="--pct:62;--color:#0ea5e9">
              <div class="mockup-gauge-center">1450</div>
            </div>
            <div class="mockup-gauge-title">Engine RPM</div>
            <div class="mockup-gauge-detail">Port · 182°F</div>
          </div>
          <div class="mockup-live-gauge">
            <div class="mockup-gauge-ring" style="--pct:48;--color:#0ea5e9">
              <div class="mockup-gauge-center">7.2</div>
            </div>
            <div class="mockup-gauge-title">Speed (kts)</div>
            <div class="mockup-gauge-detail">SOG · COG 245°</div>
          </div>
        </div>
        <div class="mockup-bottom-bar">
          <div class="mockup-bottom-item">🌡 Engine Room 32°C</div>
          <div class="mockup-bottom-item">💨 Wind 14 kts NW</div>
          <div class="mockup-bottom-item">🌊 Depth 18.4m</div>
          <div class="mockup-bottom-item">📍 37.62°N, 23.47°E</div>
        </div>
      </div>`,

    // Remote — Master Cloud path (Private)
    remotepath: `
      <div class="mockup-screen mockup-whatsapp">
        <div class="mockup-wa-header">
          <div class="mockup-wa-avatar">⚓</div>
          <div><strong>My Yacht — Commander</strong><br><span class="mockup-wa-status">All systems normal</span></div>
        </div>
        <div class="mockup-wa-chat">
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            📊 <strong>Daily Report — SV Athena</strong><br>
            🔋 House: 94% (solar charging)<br>
            🔋 Start: 100%<br>
            ⚡ Solar: 340W peak today<br>
            🌡️ Cabin: 24°C<br>
            💧 Bilge: Dry (0 cycles)<br>
            🔒 Security: No motion detected<br>
            ✅ All systems nominal<br>
            <span class="mockup-wa-time">8:00 AM</span>
          </div>
          <div class="mockup-wa-msg sent">
            show me the cameras<br>
            <span class="mockup-wa-time">9:15 AM ✓✓</span>
          </div>
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            📸 <strong>Camera Snapshots</strong><br>
            Cockpit: Clear, no activity<br>
            Salon: Normal<br>
            Engine room: No leaks visible<br>
            <em>[3 images attached]</em><br>
            <span class="mockup-wa-time">9:15 AM</span>
          </div>
        </div>
      </div>`,

    // Captain WhatsApp (Delivery)
    captain: `
      <div class="mockup-screen mockup-whatsapp">
        <div class="mockup-wa-header">
          <div class="mockup-wa-avatar">⚓</div>
          <div><strong>Delivery — MV Orion</strong><br><span class="mockup-wa-status">Passage: Gibraltar → Palma</span></div>
        </div>
        <div class="mockup-wa-chat">
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            📍 <strong>Position Update</strong><br>
            37.8°N, 0.5°W · SOG 8.2 kts<br>
            ETA Palma: ~14h (tomorrow 06:00)<br>
            <span class="mockup-wa-time">4:00 PM</span>
          </div>
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            ⚠️ <strong>Weather Ahead</strong><br>
            NE wind building to 25 kts overnight. Seas 1.5-2m. Consider routing south of Ibiza for calmer passage.<br>
            <span class="mockup-wa-time">4:15 PM</span>
          </div>
          <div class="mockup-wa-msg sent">
            engine hours?<br>
            <span class="mockup-wa-time">4:20 PM ✓✓</span>
          </div>
          <div class="mockup-wa-msg recv">
            <div class="mockup-wa-sender">Commander</div>
            🔧 <strong>Engine Status</strong><br>
            Port: 2,847h (this passage: 18.5h)<br>
            Stbd: 2,851h (this passage: 18.5h)<br>
            Fuel: ~65% remaining<br>
            Oil pressure: Normal both<br>
            Coolant temp: 185°F / 187°F<br>
            <span class="mockup-wa-time">4:20 PM</span>
          </div>
        </div>
      </div>`,

    // Owner App (Delivery)
    owner: `
      <div class="mockup-screen">
        <div class="mockup-topbar">
          <span class="mockup-logo">⚓ Commander</span>
          <span class="mockup-nav">Delivery Tracking</span>
          <span class="mockup-user">👤 Owner</span>
        </div>
        <div class="mockup-tracking">
          <div class="mockup-tracking-map">
            <div class="mockup-track-line"></div>
            <div class="mockup-track-start">Gibraltar</div>
            <div class="mockup-track-current">📍</div>
            <div class="mockup-track-end">Palma</div>
          </div>
          <div class="mockup-tracking-info">
            <div class="mockup-track-stat"><span>Distance</span><strong>420 nm (68% complete)</strong></div>
            <div class="mockup-track-stat"><span>ETA</span><strong>Tomorrow 06:00</strong></div>
            <div class="mockup-track-stat"><span>Captain</span><strong>J. Rodriguez</strong></div>
            <div class="mockup-track-stat"><span>Status</span><strong class="ok">✅ All Systems Normal</strong></div>
          </div>
        </div>
        <div class="mockup-stats-row compact">
          <div class="mockup-stat"><div class="mockup-stat-num ok">94%</div><div class="mockup-stat-label">Battery</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num">8.2</div><div class="mockup-stat-label">Speed (kts)</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num">65%</div><div class="mockup-stat-label">Fuel</div></div>
          <div class="mockup-stat"><div class="mockup-stat-num ok">0</div><div class="mockup-stat-label">Alerts</div></div>
        </div>
      </div>`,

    // Delivery Report
    report: `
      <div class="mockup-screen mockup-report">
        <div class="mockup-report-header">
          <div class="mockup-report-logo">⚓ MASTER&COMMANDER</div>
          <div class="mockup-report-title">DELIVERY REPORT</div>
          <div class="mockup-report-sub">MV Orion — Gibraltar → Palma de Mallorca</div>
        </div>
        <div class="mockup-report-section">
          <div class="mockup-report-label">PASSAGE SUMMARY</div>
          <div class="mockup-report-grid">
            <div><span>Departure</span><strong>Feb 22, 14:00 UTC</strong></div>
            <div><span>Arrival</span><strong>Feb 23, 06:12 UTC</strong></div>
            <div><span>Duration</span><strong>16h 12m</strong></div>
            <div><span>Distance</span><strong>418 nm</strong></div>
          </div>
        </div>
        <div class="mockup-report-section">
          <div class="mockup-report-label">ENGINE & SYSTEMS</div>
          <div class="mockup-report-grid">
            <div><span>Engine Hours</span><strong>16.2h (port) / 16.2h (stbd)</strong></div>
            <div><span>Fuel Used</span><strong>~340L (est.)</strong></div>
            <div><span>Max RPM</span><strong>2,200</strong></div>
            <div><span>Anomalies</span><strong class="ok">None detected</strong></div>
          </div>
        </div>
        <div class="mockup-report-section">
          <div class="mockup-report-label">CONDITIONS ENCOUNTERED</div>
          <div class="mockup-report-row">Wind NE 15-25 kts · Seas 1-2m · Max gust 28 kts · No incidents</div>
        </div>
        <div class="mockup-report-footer">Auto-generated by Commander AI · Verified passage data</div>
      </div>`,

    // Service Portal (Diagnostic)
    portal: `
      <div class="mockup-screen">
        <div class="mockup-topbar">
          <span class="mockup-logo">🔧 Service Portal</span>
          <span class="mockup-nav">Diagnostic Report</span>
          <span class="mockup-user">👤 Marine Tech</span>
        </div>
        <div class="mockup-diag-header">
          <strong>SV Meridian — 2019 Beneteau Oceanis 46.1</strong>
          <span class="mockup-diag-date">Scan: Feb 20-22, 2026 (48h)</span>
        </div>
        <div class="mockup-diag-network">
          <div class="mockup-diag-title">NMEA 2000 Network Map</div>
          <div class="mockup-diag-nodes">
            <div class="mockup-diag-node ok">Garmin MFD<br><span>Addr 3 · Active</span></div>
            <div class="mockup-diag-node ok">Garmin GPS<br><span>Addr 5 · Active</span></div>
            <div class="mockup-diag-node warn">Victron BMV<br><span>Addr 12 · Intermittent</span></div>
            <div class="mockup-diag-node ok">B&G Wind<br><span>Addr 7 · Active</span></div>
            <div class="mockup-diag-node ok">Depth Xdcr<br><span>Addr 8 · Active</span></div>
            <div class="mockup-diag-node err">Unknown<br><span>Addr 22 · No Response</span></div>
          </div>
        </div>
        <div class="mockup-diag-findings">
          <div class="mockup-diag-title">Findings</div>
          <div class="mockup-diag-item warn">⚠ Battery monitor (Addr 12) dropping off network intermittently — check wiring/termination</div>
          <div class="mockup-diag-item err">❌ Unknown device at Addr 22 not responding — possible failed sensor or wiring issue</div>
          <div class="mockup-diag-item ok">✅ GPS, MFD, wind, depth all performing within spec</div>
          <div class="mockup-diag-item info">📊 Battery discharge rate 15% above average for this boat class — investigate parasitic draw</div>
        </div>
      </div>`,

    // Tech's Device (Diagnostic) — simplified, shows portal on phone
    tech: `
      <div class="mockup-screen mockup-phone">
        <div class="mockup-phone-notch"></div>
        <div class="mockup-topbar compact">
          <span class="mockup-logo">🔧 Portal</span>
          <span class="mockup-nav">Reports</span>
        </div>
        <div class="mockup-phone-list">
          <div class="mockup-phone-item">
            <div class="mockup-phone-item-icon">🚢</div>
            <div class="mockup-phone-item-text">
              <strong>SV Meridian</strong>
              <span>Beneteau 46.1 · 2 findings</span>
            </div>
            <div class="mockup-phone-item-badge warn">⚠</div>
          </div>
          <div class="mockup-phone-item">
            <div class="mockup-phone-item-icon">🚢</div>
            <div class="mockup-phone-item-text">
              <strong>MV Blue Horizon</strong>
              <span>Lagoon 42 · Scan complete</span>
            </div>
            <div class="mockup-phone-item-badge ok">✅</div>
          </div>
          <div class="mockup-phone-item">
            <div class="mockup-phone-item-icon">🚢</div>
            <div class="mockup-phone-item-text">
              <strong>SV Windchaser</strong>
              <span>Jeanneau 54 · Scanning...</span>
            </div>
            <div class="mockup-phone-item-badge scanning">◌</div>
          </div>
        </div>
        <div class="mockup-phone-action">
          <div class="mockup-btn">Share Report with Owner</div>
        </div>
      </div>`
  };

  // =====================================================
  // DATA: Each mode defines a main flow and outputs
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
          detail:'You buy a Raspberry Pi 5 and Actisense NGX-1, flash our Commander OS image to an SD card, and plug it in. Low power (5W), always on. Auto-discovers every device on your NMEA 2000 network and connects to Master Cloud via secure VPN tunnel. No hardware to ship — you source it, we provide the software.',
          tags:['Raspberry Pi 5','Downloadable Image','5W','Secure VPN'] },
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
          tags:['Included','E2E Encrypted','Two-Way'], mockup:'whatsapp' },
        { id:'cmdapp', icon:'📊', label:'Commander App', sub:'Fleet dashboard · Any browser', color:'#4c1d95',
          detail:'Full fleet view from any browser. Live telemetry, historical charts, cross-fleet analytics, camera feeds. Your fleet\'s control room — accessible from any device.',
          tags:['Web App','Fleet View','Analytics'], mockup:'cmdapp' },
        { id:'fleetmind', icon:'🌐', label:'BigBlue', sub:'Crowdsourced fleet intel', color:'#4c1d95',
          detail:'Crowdsourced fleet intelligence. Wind field, depth, anchorage intel, passage conditions, hazard broadcasts. Every connected boat makes the network smarter.',
          tags:['Crowdsourced','Real-Time'], mockup:'fleetmind' },
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
          detail:'You buy a Mac Mini M4 and Actisense NGX-1, we provide a pre-configured disk image with Qwen 14B AI model, SignalK, and Commander pre-installed. Fully offline capable — AI vision for cameras and FLIR processed on device. No internet needed for core functions. No hardware to ship.',
          tags:['Mac Mini M4','Disk Image','Local AI','Offline'] },
      ],
      outputs: [
        { id:'localpath', icon:'📶', label:'On Board (No Internet)', sub:'WiFi/BLE → Commander App → Phone', color:'#0e4a2f', highlight:true,
          detail:'When you\'re on board, the Commander App connects directly over the boat\'s local WiFi or Bluetooth. Real-time gauges, alerts, camera feeds — no internet required. Full access to every system.',
          tags:['Local WiFi','Bluetooth','Zero Latency','Offline'], mockup:'localpath' },
        { id:'remotepath', icon:'☁️', label:'Remote (Master Cloud)', sub:'Internet → Cloud → WhatsApp + App', color:'#374151', optional:true,
          detail:'Optional subscription. Adds remote access via WhatsApp alerts, Commander App from anywhere, historical analytics, and BigBlue. Commander works fully standalone without it.',
          tags:['Optional','WhatsApp','Remote Access','Analytics','BigBlue'], mockup:'remotepath' },
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
          tags:['WhatsApp','Real-Time','Two-Way'], mockup:'captain' },
        { id:'owner', icon:'📊', label:'Owner (App)', sub:'Live tracking · System health', color:'#4c1d95',
          detail:'Boat owner tracks the delivery remotely — live position, system health, and passage progress via Commander App. Gets alerts if anything goes out of spec.',
          tags:['Remote Tracking','Peace of Mind'], mockup:'owner' },
        { id:'report', icon:'📄', label:'Delivery Report', sub:'Auto-generated at completion', color:'#4c1d95',
          detail:'Automated passage report — engine hours, fuel used, route taken, weather encountered, any anomalies flagged. Professional handoff documentation.',
          tags:['Auto-Generated','PDF','Handoff'], mockup:'report' },
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
          tags:['Reports','Network Map','Share'], mockup:'portal' },
        { id:'tech', icon:'📱', label:"Tech's Device", sub:'Laptop · Tablet · Phone', color:'#1e3a5f',
          detail:'Marine technician accesses diagnostic reports via the Service Portal on any device.',
          tags:['Any Device','Web Portal'], mockup:'tech' },
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
    node.addEventListener('click', (e) => showDetail(data, e));
    return node;
  }

  function showDetail(data, e) {
    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('active'));
    if (e && e.currentTarget) e.currentTarget.classList.add('active');
    panelTitle.innerHTML = `<span>${data.icon}</span> ${data.label}`;
    panelDesc.textContent = data.detail;
    panelTags.innerHTML = (data.tags || []).map(t => `<span class="detail-tag">${t}</span>`).join('');

    // Show mockup if available
    if (panelMockup) {
      if (data.mockup && mockups[data.mockup]) {
        panelMockup.innerHTML = mockups[data.mockup];
        panelMockup.style.display = 'block';
      } else {
        panelMockup.innerHTML = '';
        panelMockup.style.display = 'none';
      }
    }

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
