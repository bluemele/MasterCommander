# ⚓ COMMANDER

**Talk to your boat via WhatsApp.**

Commander is an AI boat monitor that runs on a Mac Mini aboard your vessel. It connects to your existing marine electronics via SignalK, monitors every system 24/7, sends you WhatsApp alerts when something needs attention, and lets you ask questions about your boat in plain English.

No cloud required. No internet required. Works at anchor, mid-ocean, or on the hard.

## How It Works

```
Your Marine Electronics (NMEA 2000 / Victron / etc.)
         ↓
   SignalK Server (translates everything to JSON)
         ↓ WebSocket
   Commander (Mac Mini)
    ├── Auto-Discovery (learns what sensors YOUR boat has)
    ├── Alert Engine (rule-based, no AI, runs forever)
    ├── Quick Commands (status, engines, battery, tanks...)
    └── AI Brain (Qwen 14B local or Claude via internet)
         ↓
   WhatsApp → Your Phone 📱
```

**Commander auto-discovers your boat.** It doesn't need to know what brand your chartplotter is, how many engines you have, or what batteries are installed. It connects to SignalK, sees what data paths exist, and adapts. A catamaran with twin diesels gets engine alerts for both. A monohull with one gets alerts for one. A boat on the hard with just a battery monitor gets battery alerts only.

## Quick Start

```bash
npm install
node setup-wizard.js       # Answer questions about your boat
node simulator.js           # Terminal 1 — simulated boat data
node test.js                # Terminal 2 — verify it works
node commander.js           # Terminal 2 — start for real (scan QR code)
```

## WhatsApp Commands

| Command | Response |
|---------|----------|
| `status` | Full overview — position, engines, battery, tanks, wind |
| `engines` | Per-engine detail — RPM, oil, coolant, exhaust, fuel rate, hours |
| `battery` | Per-bank detail — SOC, voltage, current, solar, generator, shore |
| `position` | GPS coordinates + Google Maps link |
| `tanks` | All tank levels — fuel, water, holding |
| `wind` | Wind speed/angle, depth, water temp |
| `anchor` | Anchor watch — swing radius, drift distance |
| `help` | List all commands |

**Or ask in plain English:**
- "How is my boat doing?"
- "Anything I should worry about?"
- "Are the engines running hot?"
- "What's the battery situation?"

## Automatic Alerts

Alerts fire automatically via WhatsApp. No need to ask.

| Alert | Trigger | Requires |
|-------|---------|----------|
| 🔋 Battery Low | SOC < 20% | Any battery on SignalK |
| 🔋 Battery Critical | SOC < 10% | Any battery on SignalK |
| 🌡️ Engine Overheat | Coolant > 95°C | Engine on NMEA 2000 |
| 🛢️ Low Oil Pressure | < 25 PSI while running | Engine on NMEA 2000 |
| 🚰 Bilge Pump | > 6 cycles in 30 min | Bilge pump counter |
| ⚓ Anchor Drag | GPS drift > set radius | GPS + anchor watch |
| 🌊 Shallow Water | Depth < configured min | Depth sounder |
| ⛽ Low Fuel | < 15% | Tank sensors |
| 💧 Low Water | < 15% | Tank sensors |

All thresholds are configurable in `boat-config.json`.

## Configuration

### LLM Modes

Set `llm.provider` in `boat-config.json`:

| Mode | Behavior | When to Use |
|------|----------|-------------|
| `local` | Always uses Qwen 14B via Ollama | Default. Works offline. No internet needed. |
| `cloud` | Always uses Claude CLI | When you have reliable Starlink |
| `auto` | Tries Claude, falls back to Qwen | Best of both worlds |

Quick commands (`status`, `engines`, etc.) never use the LLM — they're instant.

### WhatsApp Modes

Set `whatsapp.mode` in `boat-config.json`:

| Mode | How It Works |
|------|-------------|
| `dedicated` | Commander has its own phone number. Anyone allowed can text it. |
| `bridge` | Runs on your existing WhatsApp. Only responds to boat-related messages. |

### Simulator Profiles

Test with different boat types:

```bash
node simulator.js --profile cat58    # Catamaran 58ft (twin engines, 24V lithium)
node simulator.js --profile mono40   # Monohull 40ft (single engine, 12V, no AIS)
node simulator.js --profile power    # Powerboat 45ft (twin engines, no wind)
```

Switch scenarios while running:
```bash
curl -X POST http://localhost:3858/scenario/motoring
curl -X POST http://localhost:3858/scenario/sailing
curl -X POST http://localhost:3858/scenario/alarm      # triggers bilge alert
curl -X POST http://localhost:3858/scenario/atAnchor
curl -X POST http://localhost:3858/scenario/charging
curl -X POST http://localhost:3858/scenario/shorepower
```

## File Structure

```
commander/
├── commander.js              # Main orchestrator
├── setup-wizard.js           # Interactive setup
├── simulator.js              # SignalK simulator (testing)
├── test.js                   # Verification script
├── boat-config.json          # YOUR boat's configuration
├── boat-config.template.json # Blank template
├── package.json
├── lib/
│   ├── signalk-client.js     # Auto-discovering SignalK connector
│   ├── alert-engine.js       # Rule-based monitoring (no AI)
│   ├── llm-router.js         # Ollama / Claude routing
│   ├── status-builder.js     # WhatsApp-formatted reports
│   └── whatsapp.js           # Baileys bot (both modes)
└── data/                     # Telemetry logs + alerts
    ├── telemetry-2026-02-24.jsonl
    └── discovered.json
```

## Production: Real Boat Hardware

When installing on the actual boat:

1. **Mac Mini M4 (24GB)** at nav station — runs everything
2. **Actisense NGX-1-USB** — NMEA 2000 → USB gateway
3. **SignalK Server** — replaces the simulator
4. **Ollama + Qwen 14B** — local AI, fully offline
5. Update `boat-config.json`: set `signalk.port` to `3000`

Commander auto-discovers your real equipment the same way it discovers the simulator. No code changes needed.

## Boats on the Hard

Commander works for unattended boats too. Even without NMEA 2000:

- **Battery monitor only** → battery alerts via marina WiFi
- **Battery + humidity sensor** → mold prevention alerts
- **Battery + camera** → security alerts (future: AI vision)
- **Battery + bilge pump** → leak detection

Minimal sensor → minimal hardware → still get WhatsApp alerts.

## Master (Fleet Management)

**Commander** is the on-boat system. **Master** is the optional cloud service for fleet operators (charter companies, marinas, management firms).

Master runs on a managed server (not on the boat). Multiple Commanders report telemetry to Master when they have internet. Master provides: fleet dashboard, maintenance scheduling, cross-boat analytics, insurance compliance data.

This is a service we operate — fleet clients don't set up servers.

## Architecture Decisions

- **Auto-discovery over configuration** — Commander adapts to whatever SignalK provides
- **Alerts are pure code, not AI** — The alert engine is `if/else` logic. It runs on anything, never hallucinates, never fails because a model is loading
- **LLM is the interface, not the brain** — AI answers your questions. Code monitors your boat.
- **Local-first** — Designed to work with zero internet. Cloud is an enhancement, not a dependency
- **WhatsApp over custom app** — Everyone already has WhatsApp. Zero friction for crew, family, fleet captains
