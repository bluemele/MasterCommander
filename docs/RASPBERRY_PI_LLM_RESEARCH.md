# Raspberry Pi for Marine Boat Monitoring: Deep-Dive Research

Research compiled February 2025–2026. Covers hardware specs, LLM feasibility, NVMe storage, displays, SignalK/NMEA 2000 integration, and Mac Mini comparison.

---

## 1. Raspberry Pi 5 — Current Specs & Available Models

### Processor & Memory

| Spec | Detail |
|------|--------|
| **SoC** | Broadcom BCM2712 |
| **CPU** | Quad-core 64-bit Arm Cortex-A76 @ 2.4GHz |
| **L2 Cache** | 512KB per core |
| **L3 Cache** | 2MB shared |
| **GPU** | VideoCore VII @ 800MHz (OpenGL ES 3.1, Vulkan 1.3) |
| **RAM** | LPDDR4X @ 4,267 MT/s |
| **Performance** | ~3x faster than Pi 4 |

### Available SKUs (as of early 2026)

| RAM | Price (USD) | Notes |
|-----|-------------|-------|
| 1GB | $45 | Added December 2025. Not suitable for LLM use |
| 2GB | $55 | Too small for meaningful AI |
| 4GB | $70 | Tight for LLMs, fine for SignalK only |
| **8GB** | **$95** | Minimum for local AI (3B models) |
| **16GB** | **$145** | Recommended for AI — fits 7B models comfortably |

### Related Products

- **Compute Module 5** (2024) — Same SoC, up to 16GB RAM, up to 64GB eMMC. Good for custom enclosures.
- **Raspberry Pi 500+** (2025) — Keyboard form factor, 16GB RAM, built-in M.2 slot with 256GB SSD pre-installed.
- **Pi 5 production guaranteed** until at least January 2036.
- **Pi 6** expected ~2027 based on historical 3–4 year cadence.

### Key Connectivity

- 2x USB 3.0 + 2x USB 2.0
- **PCIe 2.0 x1** (new — enables NVMe)
- 2x 4-lane MIPI camera/display connectors
- 2x micro HDMI (dual 4K @ 60Hz, HDR)
- Gigabit Ethernet, Wi-Fi 5 (802.11ac), Bluetooth 5.0
- 40-pin GPIO header
- Real-time clock (battery backup)
- Power button

---

## 2. NVMe Storage on Raspberry Pi

**Yes — the Pi 5 is the first Pi with native PCIe, making NVMe straightforward.**

### Official: Raspberry Pi M.2 HAT+ ($12)

- Connects to Pi 5's PCIe 2.0 x1 interface via 16-pin FPC cable
- Supports M.2 M-key NVMe SSDs in **2230 and 2242** form factors
- Up to 3A power delivery to M.2 device
- Auto-detected by Raspberry Pi firmware (HAT+ spec)
- **Can boot directly from NVMe** — no microSD required
- Speeds: ~500 MB/s (PCIe Gen 2), configurable to PCIe Gen 3 for ~800 MB/s
- Compact variant available that fits inside the official Pi 5 case

### PCIe Gen 3 Mode

Add to `/boot/firmware/config.txt`:
```
dtparam=pciex1_gen=3
```
Not officially supported but widely used. Approximately doubles throughput.

### Third-Party Options

| Product | SSD Sizes | Features | Price |
|---------|-----------|----------|-------|
| **Waveshare PCIe to M.2 HAT+** | 2230/2242 | Gen2/Gen3, LED indicators | ~$15 |
| **Geekworm X1001** | 2230/2242/2260/**2280** | Wider form factor support | ~$15 |
| **Seeed Dual M.2 (PCIe 2.0)** | All sizes | Two M.2 slots, Hailo AI support | ~$25 |
| **Seeed Dual M.2 (PCIe 3.0)** | All sizes | PCIe 3.0 switch, dual slots | ~$35 |
| **NVMe + USB 3.2 Combo HAT** | All sizes | 4x USB 3.2 ports + NVMe | ~$25 |

### Why NVMe Matters for This Project

- **10x faster** than microSD for model loading and telemetry logging
- A 3B GGUF model loads from NVMe in seconds vs. 30+ seconds from SD
- Essential for reliable 24/7 operation — microSD cards fail under constant writes
- 256GB NVMe provides ample space for models, logs, charts, and SignalK data

---

## 3. Raspberry Pi Displays

**No Pi model includes a built-in screen, but official touchscreens are available.**

### Official Raspberry Pi Displays

| Display | Size | Resolution | Touch | Price | Notes |
|---------|------|------------|-------|-------|-------|
| **Touch Display 2 (5")** | 5" | 720x1280 | 5-point capacitive | $40 | New 2025. Best for nav station panel |
| **Touch Display 2 (7")** | 7" | 720x1280 | 5-point capacitive | $60 | Good for dashboard display |
| **Touch Display (Original)** | 7" | 800x480 | 10-point capacitive | $60 | Lower res, still available |
| **15.6" Monitor** | 15.6" | 1080p 60Hz | No | ~$100 | HDMI, built-in speakers |

All touchscreens connect via DSI ribbon cable (no HDMI needed). They're powered directly from the Pi — no separate power supply.

### For a Marine Monitoring System

The **5" Touch Display 2 ($40)** is the best fit:
- Small enough to mount at a nav station or engine room panel
- 720x1280 portrait resolution (rotatable to landscape)
- Plug-and-play with Pi OS — full Linux driver support
- Can display SignalK instrument panels, alert status, system health
- Waterproof enclosure needed for cockpit mounting (third-party)

---

## 4. Running a Local LLM on Raspberry Pi

### Can It Run Qwen 14B?

**No. Qwen 14B cannot run on a Raspberry Pi 5, even the 16GB model.**

- Qwen 14B at Q4_K_M quantization requires ~8-9GB just for model weights
- Plus ~2-4GB for KV cache, OS, and runtime
- Total: ~12GB minimum — technically fits in 16GB RAM but with no headroom
- Even at Q2_K (~5.5GB weights), performance would be ~0.5-1.5 tok/s — unusable
- The Pi 5's memory bandwidth (34 GB/s) is the real bottleneck for large models

**Qwen 14B belongs on the Mac Mini tier**, where 24GB unified memory and higher bandwidth make it practical at 15-25 tok/s.

### What Models CAN Run on Pi 5?

#### Pi 5 with 8GB RAM

| Model | Quantization | RAM Used | Speed | Usability |
|-------|-------------|----------|-------|-----------|
| **Qwen 2.5:3B** (recommended) | Q4_K_M | ~2GB | 4-7 tok/s | Good for boat Q&A |
| Gemma 3:1B | Q4_K_M | ~700MB | 7-15 tok/s | Fast, basic answers |
| Llama 3.2:3B | Q4_K_M | ~2GB | 4-6 tok/s | Good alternative |
| Phi-4-mini:3.8B | Q4_K_M | ~2.5GB | 3-5 tok/s | Better reasoning |
| BitNet B1.58 2B | 1.58-bit | ~500MB | 8+ tok/s | Very efficient |
| Mistral 7B | Q4_K_M | ~4GB | 1-3 tok/s | Works but slow, tight fit |

#### Pi 5 with 16GB RAM

| Model | Quantization | RAM Used | Speed | Usability |
|-------|-------------|----------|-------|-----------|
| Everything above | — | — | Same | More headroom |
| **Qwen 2.5:7B** | Q4_K_M | ~4.5GB | 2-4 tok/s | Best quality on Pi |
| DeepSeek-R1 7B | Q4_K_M | ~4.5GB | 2-4 tok/s | Reasoning model |
| Llama 3:8B | Q4_K_M | ~5GB | 1-3 tok/s | Functional, slow |
| Qwen 2.5:14B | Q2_K | ~6GB | 0.5-1.5 tok/s | Technically loads, unusably slow |

#### MoE Models (Special Case)

Qwen3 30B-A3B (Mixture of Experts) — only activates ~3B parameters at a time:
- Fits in 8GB RAM with heavy quantization
- ~2-5 tok/s with tight memory
- Potentially better quality than a dense 3B model
- Trade-off: 10-15 seconds per response, tight memory

### GGUF Quantization Explained

GGUF is the standard format for running LLMs on CPU (via llama.cpp). Quantization levels:

| Quant | Bits/Weight | Quality Loss | Size (7B) | Size (3B) |
|-------|-------------|-------------|-----------|-----------|
| Q8_0 | 8-bit | Minimal | ~7GB | ~3GB |
| Q6_K | 6-bit | Very low | ~5.5GB | ~2.3GB |
| **Q4_K_M** | 4-bit | Low | **~4GB** | **~1.7GB** |
| Q3_K_M | 3-bit | Moderate | ~3.3GB | ~1.4GB |
| Q2_K | 2-bit | Significant | ~2.7GB | ~1.1GB |

**Q4_K_M is the sweet spot** — best balance of quality and size for Pi hardware.

### Inference Engines on ARM

| Engine | Pros | Cons | Best For |
|--------|------|------|----------|
| **llama.cpp** | Full control, lowest overhead, BLAS support | More complex setup | Production deployment |
| **Ollama** | Easy setup, model management, API | Higher overhead, poor defaults on Pi | Development/testing |
| **Llamafile** | Single binary, 3-4x faster than Ollama on CPU | Fewer models available | Maximum performance |

**Recommendation for MasterCommander:** Use Ollama for ease of management (model pulling, API), but tune settings:
- Set `OLLAMA_NUM_THREADS=3` (leave 1 core for SignalK/system)
- Set context length explicitly per model
- Consider llamafile if every tok/s matters

### Optimization Tips

- Use **OpenBLAS or BLIS** for faster matrix operations
- Pin LLM threads to specific CPU cores (CPU affinity)
- Boot from NVMe for fast model loading
- Use a heatsink/active cooler — thermal throttling kills performance
- Keep context window small (512-1024 tokens) for boat queries
- The LLM handles natural language only — alerts and monitoring are pure code

### New Hardware: AI HAT+ 2 (January 2026)

Raspberry Pi announced the AI HAT+ 2 with **Hailo-10H** providing:
- 40 TOPS (INT4) neural network acceleration
- 8GB onboard RAM (separate from Pi's RAM)
- Designed for LLMs and vision language models
- Could significantly change the LLM-on-Pi equation — worth watching

---

## 5. Raspberry Pi vs. Mac Mini for This Use Case

### Head-to-Head Comparison

| Factor | Raspberry Pi 5 (16GB) | Mac Mini M4 (24GB) |
|--------|----------------------|---------------------|
| **Price** | ~$250 (with PICAN-M, NVMe) | ~$850 (with Actisense) |
| **Best AI Model** | Qwen 3B (4-7 tok/s) | Qwen 14B (15-25 tok/s) |
| **Max Model** | 7B (slow) | 32B Q4 (5-10 tok/s) |
| **Memory Bandwidth** | 34 GB/s | 100+ GB/s |
| **Power Draw (idle)** | ~4W | ~3-6W |
| **Power Draw (AI load)** | 5-10W | 30-65W |
| **Power Source** | 5V DC (NMEA bus or USB-C) | 120/240V AC (needs inverter) |
| **12V DC Direct** | Yes (via buck converter or PICAN-M) | Yes (via Mikegyver mod, ~$200) |
| **NMEA Connection** | PICAN-M HAT (GPIO, $80) | Actisense NGT-1 (USB, $250) |
| **Form Factor** | Credit card sized | Small desktop |
| **Camera/Vision AI** | Limited (no NPU) | Yes (Apple Neural Engine) |
| **Reliability** | Very high (no moving parts, industrial) | High (consumer product) |
| **Marine Track Record** | Extensive (SignalK community standard) | Limited (niche) |
| **OS** | Raspberry Pi OS (Debian Linux) | macOS |

### Power Analysis for Marine Use

**Raspberry Pi 5:**
- 5-10W from 5V DC — trivial on any boat
- PICAN-M powers it directly from the NMEA 2000 bus (LEN 2-3)
- Alternatively: any 12V→5V buck converter ($5-15), rated 5A
- Can run indefinitely from a small solar panel
- No inverter needed
- At 10W, draws ~0.83A from 12V — a 100Ah battery runs it for 120 hours

**Mac Mini M4:**
- 3-6W idle, 30-65W under AI load
- Requires 120/240V AC or a DC conversion mod
- Mikegyver offers a 12V DC conversion service for M4 Mac Minis
- At 30W average, draws ~2.5A from 12V — a 100Ah battery runs it for 40 hours
- Standard on boats 40ft+ with shore power or generator

### When to Choose Each

**Choose Raspberry Pi when:**
- Budget matters (charter fleets, delivery boats)
- No reliable AC power
- Simple monitoring + alerts is the primary need
- 3B model quality is sufficient (and it is — see HARDWARE.md)
- Compact installation required (engine room, behind panel)
- Want to power from NMEA 2000 bus directly

**Choose Mac Mini when:**
- Want conversational-quality AI (14B model)
- Need camera/vision AI (FLIR thermal, PoE cameras)
- Boat has reliable AC power (yacht 40ft+)
- Want to run larger models for analysis
- Budget allows ~$850

### The Key Insight

> The LLM is the *interface*, not the *brain*. Alert monitoring, threshold checks, bilge pump cycling detection, anchor drag alerts — all of this is pure code running in the alert engine. The LLM only handles natural language questions like "How are the batteries?" or "Summarize today's engine data." A 3B model on a Pi handles this perfectly well.

---

## 6. NMEA 2000 and SignalK on Raspberry Pi

### Is This a Common Setup?

**Yes — Raspberry Pi + SignalK is the de facto standard for DIY marine data systems.** The SignalK project specifically targets Raspberry Pi as the primary hardware platform. Thousands of boats worldwide run this combination.

### What is SignalK?

SignalK is a universal marine data protocol that:
- Translates NMEA 2000, NMEA 0183, Seatalk, Victron, and other protocols into unified JSON
- Runs as a Node.js server on the Pi
- Provides REST API and WebSocket for real-time data streaming
- Has hundreds of plugins for dashboards, logging, cloud sync, alerts
- Completely open source and free

### Hardware Adapters for NMEA 2000

| Adapter | Type | Price | Features |
|---------|------|-------|----------|
| **PICAN-M HAT** (recommended) | GPIO HAT | ~$80 | CAN bus + NMEA 0183 + powers Pi from NMEA 2000 bus |
| Actisense NGT-1 | USB | ~$250 | Gold standard USB gateway, plug-and-play |
| Yacht Devices YDNU-02 | USB | ~$100 | USB to NMEA 2000, bidirectional |
| Canable/CANable 2.0 | USB | ~$25 | Generic USB CAN adapter, needs configuration |
| Smart2000 ESP | Wireless | ~$40 | ESP32-based, wireless CAN to Wi-Fi |
| Smart2000 USB | USB | ~$25 | Budget USB-CAN option |

### PICAN-M HAT — The Best Option for Pi

The PICAN-M from Copperhill Technologies is purpose-built for marine Pi installations:

1. **NMEA 2000 (CAN bus)** via Micro-C connector — direct backbone connection
2. **NMEA 0183** via RS422 screw terminals — for legacy instruments
3. **12V switch-mode power supply** — powers the Pi directly from the NMEA 2000 bus
4. **GPIO-attached** — no USB cables, cleaner installation

### Physical Installation

```
NMEA 2000 Backbone
    │
    ├── Tee connector
    │       │
    │   Drop cable (shortest available)
    │       │
    │   PICAN-M HAT ←── plugged onto Pi 5 GPIO header
    │       │
    │   Raspberry Pi 5 ←── NVMe via M.2 HAT+
    │       │
    │   (Optional: 5" touchscreen via DSI)
    │
    ├── Other NMEA 2000 devices...
    │
    └── 120Ω terminators at each end
```

### Software Stack

```
NMEA 2000 Bus → PICAN-M HAT → can0 interface → SignalK Server → WebSocket → MasterCommander
                                                      │
                                                      ├── REST API (for dashboards)
                                                      ├── Plugins (Grafana, logging, etc.)
                                                      └── WebSocket (real-time data stream)
```

### Marine Linux Distributions

- **OpenPlotter** — Full marine Linux distro for Pi with SignalK, OpenCPN (charts), AIS, weather routing pre-installed
- **BBN Marine OS** — Free open-source alternative with SignalK, OpenCPN, NMEA support
- **Commander OS** (this project) — Custom image with SignalK + MasterCommander pre-configured

### What Data Comes Over NMEA 2000?

SignalK automatically discovers and translates:
- **Navigation:** GPS position, COG, SOG, heading, depth, wind speed/direction
- **Engines:** RPM, coolant temp, oil pressure, fuel rate, hours
- **Electrical:** Battery voltage, current, SOC, charge state
- **Tanks:** Fuel, water, waste, LPG levels
- **Environment:** Air/water temp, humidity, barometric pressure
- **Autopilot:** Mode, heading, rudder angle
- **AIS:** Nearby vessel targets

All available as JSON at paths like `vessels.self.navigation.position`, `vessels.self.propulsion.port.revolutions`, etc.

---

## Summary & Recommendations for MasterCommander

### Essential Tier (Raspberry Pi 5, 16GB) — $250

- **Use Qwen 2.5:3B Q4_K_M** — 4-7 tok/s, ~2GB RAM, leaves plenty for SignalK
- **Do NOT attempt Qwen 14B** — it won't fit or will be unusably slow
- Boot from NVMe via M.2 HAT+ for reliability and speed
- Use PICAN-M HAT for NMEA 2000 + bus power
- Optional 5" touchscreen for local display
- Ollama for model management, consider llamafile for max performance
- Total power: 5-10W from 5V DC — runs from NMEA 2000 bus

### Pro Tier (Mac Mini M4, 24GB) — $850

- **Use Qwen 2.5:14B** — 15-25 tok/s, conversational quality
- Can run 32B Q4 for maximum capability (5-10 tok/s)
- Actisense NGT-1 USB for NMEA 2000
- Requires AC power or Mikegyver 12V DC mod
- Enables camera/vision AI features

### Watch List

- **AI HAT+ 2 (Hailo-10H)** — 40 TOPS + 8GB RAM could enable larger models on Pi
- **Raspberry Pi 6** (~2027) — likely 8+ cores, more RAM, faster PCIe
- **New MoE models** — Qwen3 30B-A3B already runs on Pi 5 8GB at ~3 tok/s
- **Llamafile improvements** — consistently 3-4x faster than Ollama on ARM

---

## Sources

- [Raspberry Pi 5 Product Page](https://www.raspberrypi.com/products/raspberry-pi-5/)
- [Raspberry Pi M.2 HAT+ Documentation](https://www.raspberrypi.com/documentation/accessories/m2-hat-plus.html)
- [Raspberry Pi Touch Display 2](https://www.raspberrypi.com/products/touch-display-2/)
- [How Well Do LLMs Perform on a Raspberry Pi 5? — Stratosphere Laboratory](https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5)
- [I Ran 9 Popular LLMs on Raspberry Pi 5 — It's FOSS](https://itsfoss.com/llms-for-raspberry-pi/)
- [LLM Evaluation on Single-board Computers — arXiv](https://arxiv.org/html/2511.07425v1)
- [llama.cpp/llamafile Comparison on Pi 5 — Medium](https://medium.com/aidatatools/local-llm-eval-tokens-sec-comparison-between-llama-cpp-and-llamafile-on-raspberry-pi-5-8gb-model-89cfa17f6f18)
- [Qwen3 30B-A3B on Pi — Byteshape](https://byteshape.com/blogs/Qwen3-30B-A3B-Instruct-2507/)
- [Running Qwen 2.5 30B on Pi 5 — Vipin PG](https://vipinpg.com/blog/running-qwen-25-30b-on-raspberry-pi-5-with-n8n-building-a-local-ai-assistant-workflow-under-8gb-ram)
- [Mac Mini M4 AI Benchmarks — Like2Byte](https://like2byte.com/mac-mini-m4-deepseek-r1-ai-benchmarks/)
- [Mac Mini M4 12V Marine Mod — Mikegyver](https://mikegyver.com/products/upgrade-service-12v-apple-mac-mini-m1-m2-m4-in-your-car-rv-boat)
- [Signal K Overview](https://signalk.org/overview/)
- [Signal K Installation](https://signalk.org/installation/)
- [PICAN-M Setup Guide — Seabits](https://seabits.com/set-up-signal-k-and-grafana-on-raspberry-pi-with-pican-m-nmea-2000-board/)
- [NMEA 2000 Powered Pi — Seabits](https://seabits.com/nmea-2000-powered-raspberry-pi/)
- [Copperhill Technologies (PICAN-M)](https://copperhilltech.com/blog/turn-your-raspberry-pi-into-a-smart-marine-hub-with-openplotter-and-signal-k-fd742f/)
- [Pi 5 AI HAT+ 2 — The Register](https://www.theregister.com/2026/01/15/pi_5_ai_hat_2/)
- [Arm Smart Home LLM Blog](https://developer.arm.com/community/arm-community-blogs/b/internet-of-things-blog/posts/transforming-smart-home-privacy-and-latency-with-local-llm-inference-on-arm-devices)
- [16GB Raspberry Pi 5 Announcement](https://www.raspberrypi.com/news/16gb-raspberry-pi-5-on-sale-now-at-120/)
