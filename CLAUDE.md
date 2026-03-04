# MasterCommander — AI Boat Monitor

Talk to your boat via WhatsApp. Connects marine electronics (SignalK) to WhatsApp with AI.

## Stack
- Frontend: Static SPA served by nginx (dashboard, flow visualizer, gate)
- Backend: Node.js in /digestion/ (SignalK client, alert engine, LLM router, WhatsApp bot)
- Database: PostgreSQL 16 (mastercommander-db)
- Container: Multi-stage Docker (nginx + Node.js), port 80 internally, mapped to 3010

## Structure
```
public/              # Frontend SPA (dashboard, flow viz, gate)
  index.html         # Main landing page (133KB)
  dashboard.html/js  # Boat monitoring dashboard
  flow.js            # Data flow visualization
  gate.js/css        # Authentication gate
digestion/           # Backend Node.js application
  commander.js       # Main orchestrator (entry point)
  signalk-client.js  # Auto-discovering boat data connector
  alert-engine.js    # Rule-based monitoring (no LLM needed)
  llm-router.js      # Routes between local/cloud LLM
  status-builder.js  # Builds readable status reports
  whatsapp.js        # WhatsApp bot (Baileys)
  simulator.js       # Virtual boat with configurable profiles
  setup-wizard.js    # Interactive configuration wizard
  boat-config.json   # Boat-specific configuration
nginx.conf           # SPA routing + security blocks
start.sh             # Container startup (nginx + node)
```

## Key Patterns
- SignalK WebSocket auto-discovers boat equipment and sensors
- Alert engine is rule-based (works offline, no AI required)
- LLM router supports local Ollama (Qwen 14B) and cloud Claude
- Simulator generates realistic marine telemetry for testing
- Designed for Mac Mini M4 aboard the vessel (local-first)

## Deploy
Docker Compose:
```bash
cd /projects/MasterCommander && docker-compose build && docker-compose up -d
```

## Database
- Container: mastercommander-db (postgres:16-alpine)
- User: mastercommander, DB: mastercommander
- Volume: mc_pgdata

## Dependencies (digestion/)
- @whiskeysockets/baileys (WhatsApp)
- pino (logging — required by Baileys)
- ws (WebSocket for SignalK)
