# Commander Hardware Guide

Two hardware tiers for the Commander Unit — choose based on your needs and budget.

---

## Essential Tier: Raspberry Pi 5 (~$250)

Best for: Charter fleets, delivery captains, marine technicians, budget-conscious yacht owners.

### What to Buy

| Component | Model | Price | Notes |
|-----------|-------|-------|-------|
| **Computer** | Raspberry Pi 5 (16GB) | ~$100 | 16GB recommended for local AI. 8GB works but limits model options |
| **NMEA Adapter** | PICAN-M HAT | ~$80 | Plugs onto Pi GPIO. Provides NMEA 2000 + NMEA 0183 + **powers the Pi from the NMEA 2000 bus** |
| **Storage** | NVMe SSD (256GB+) | ~$35 | Via official M.2 HAT+ ($12). 10x faster than microSD. Essential for AI model loading |
| **Case** | Any Pi 5 case with HAT support | ~$15 | Needs ventilation. Aluminum cases double as heatsink |
| **Screen** (optional) | Official Touch Display 2 (5") | ~$40 | 1280x720, DSI ribbon cable. Useful for setup/diagnostics at nav station |

**Total: ~$230-270** (without screen)

### Why PICAN-M over Actisense?

The PICAN-M HAT is a game-changer for marine Pi installations:
- **Powers the Pi directly from the NMEA 2000 bus** — no separate 5V supply needed
- Provides CAN bus (NMEA 2000) AND NMEA 0183 serial on the same board
- Plugs directly onto the Pi's GPIO header — no USB cables
- ~$80 vs ~$250 for Actisense NGT-1 USB

### Local AI on the Pi

The Pi 5 runs Ollama with quantized models via llama.cpp:

| Model | RAM Used | Speed | Quality |
|-------|----------|-------|---------|
| **qwen2.5:3b** (default) | ~2GB | 4-7 tok/s | Good for Q&A about boat systems |
| gemma3:1b | ~700MB | 7+ tok/s | Fast but basic |
| llama3.2:3b | ~2GB | 4-6 tok/s | Good alternative |
| phi-4-mini:3.8b | ~2.5GB | 3-5 tok/s | Better reasoning, slower |
| mistral:7b (Q4) | ~4GB | 1-3 tok/s | Better quality, borderline speed |

**Key insight:** The LLM is the *interface*, not the *brain*. Alert monitoring, threshold checks, and system analysis are all pure code (`alert-engine.js`). The LLM only handles natural language questions like "How's the battery?" — a 3B model handles this well.

### Power

- Pi 5 draws **5-10W** from 5V DC
- PICAN-M powers it from the NMEA 2000 bus (LEN 2-3, ~200-300mA at 12V)
- Can also power via USB-C from any 5V source (powerbank, boat USB, solar controller)
- **No inverter needed** — unlike the Mac Mini, which requires 120/240V AC

### NVMe Storage

The Pi 5 exposes PCIe 2.0 x1 via the official M.2 HAT+:
- Supports M.2 2230/2242 NVMe SSDs
- Can force PCIe Gen 3 mode for ~2x speed (add `dtparam=pciex1_gen=3` to `/boot/config.txt`)
- Boot directly from NVMe — no microSD needed
- 10x faster reads/writes than microSD — critical for model loading and telemetry

---

## Pro Tier: Mac Mini M4 (~$850)

Best for: Private yachts, superyachts, boats with camera systems.

### What to Buy

| Component | Model | Price | Notes |
|-----------|-------|-------|-------|
| **Computer** | Mac Mini M4 (24GB) | ~$599 | 24GB unified memory. Runs Qwen 14B at 15-25 tok/s |
| **NMEA Adapter** | Actisense NGT-1 USB | ~$250 | USB-to-NMEA 2000 gateway |

**Total: ~$850**

### Why Mac Mini?

- Runs **Qwen 14B** at 15-25 tokens/sec — conversational speed
- Apple Silicon unified memory = efficient LLM inference
- Supports **AI Vision** for PoE cameras and FLIR thermal
- Can handle video recording/analysis locally
- Reliable macOS with automatic updates

### Power

- Draws ~30W under AI load
- Requires 120/240V AC — needs inverter or shore power
- Not ideal for boats without reliable AC, but standard on yachts 40ft+

### Local AI on Mac Mini

| Model | Speed | Use Case |
|-------|-------|----------|
| **qwen2.5:14b** (default) | 15-25 tok/s | Full conversational AI, detailed analysis |
| llama3:8b | 20-30 tok/s | Fast alternative |
| qwen2.5:32b (Q4) | 5-10 tok/s | Maximum capability on 24GB |

---

## Comparison Table

| | Essential (Pi 5) | Pro (Mac Mini M4) |
|---|---|---|
| **Hardware Cost** | ~$250 | ~$850 |
| **AI Model** | Qwen 3B (4-7 tok/s) | Qwen 14B (15-25 tok/s) |
| **Power** | 5-10W, 5V DC | 30W, needs AC |
| **NMEA Connection** | PICAN-M HAT (GPIO) | Actisense NGT-1 (USB) |
| **Powered by NMEA bus** | Yes (PICAN-M) | No |
| **Camera/Vision AI** | No | Yes |
| **Alerting** | Full (code-based) | Full (code-based) |
| **WhatsApp** | Full | Full |
| **Offline Operation** | Full | Full |
| **Cloud Dashboard** | Yes (when connected) | Yes (when connected) |
| **Form Factor** | Tiny, mount anywhere | Nav station shelf |
| **Best For** | Charter fleets, deliveries | Private yachts, superyachts |

---

## SignalK Setup

Both platforms run SignalK server to connect to NMEA 2000. MasterCommander connects to SignalK via WebSocket — the same code runs on both platforms.

### Pi 5 with PICAN-M

```bash
# SignalK is pre-installed in the Commander OS image
# PICAN-M is auto-detected as a CAN interface
# No additional configuration needed
```

### Mac Mini with Actisense

```bash
# SignalK is pre-installed in the Commander disk image
# Actisense NGT-1 appears as a serial device
# Auto-configured on first boot
```

### Alternative: OpenPlotter

For Pi users who want a full marine Linux distribution, [OpenPlotter](https://openplotter.piais.com/) includes SignalK pre-configured along with chart plotting, AIS, and other marine tools.

---

## Installation

### Pi 5 (Commander OS)

1. Download the Commander OS image from mastercommander.namibarden.com
2. Flash to NVMe SSD using Raspberry Pi Imager
3. Insert NVMe into M.2 HAT+, attach to Pi 5
4. Connect PICAN-M HAT (plugs onto GPIO)
5. Connect PICAN-M to NMEA 2000 backbone
6. Power on — Pi boots from NMEA 2000 power
7. Run `node setup-wizard.js` (select platform: `pi`)
8. Scan WhatsApp QR code
9. Text your boat: "status"

### Mac Mini (Commander Image)

1. Download the Commander disk image
2. Flash to Mac Mini using Apple Configurator or USB installer
3. Connect Actisense NGT-1 USB to NMEA 2000
4. Connect to AC power
5. Run `node setup-wizard.js` (select platform: `mac-mini`)
6. Scan WhatsApp QR code
7. Text your boat: "status"
