# Commander OS — Build Pipeline Design

How to create downloadable installation images for both Raspberry Pi and Mac Mini platforms, so users can flash-and-go.

---

## Overview

```
GitHub Repo (MasterCommander)
     │
     ├── GitHub Actions CI
     │       │
     │       ├── Pi Image Build (pi-gen + Docker)
     │       │       → commander-os-pi5-v0.2.0.img.xz  (~2.5GB)
     │       │
     │       └── Mac Installer Build (pkgbuild + productbuild)
     │               → commander-mac-v0.2.0.pkg  (~50MB, models downloaded on first run)
     │
     └── GitHub Releases
             → Users download from mastercommander.namibarden.com
             → Or direct from GitHub Releases page
```

Two very different approaches because of the platforms:

| | Raspberry Pi | Mac Mini |
|---|---|---|
| **What ships** | Full OS image (.img.xz) | macOS installer package (.pkg) |
| **Includes OS** | Yes (Raspberry Pi OS 64-bit) | No (macOS already installed) |
| **Includes models** | Yes (Qwen 3B GGUF baked in) | No (downloaded on first run) |
| **Flash tool** | Raspberry Pi Imager | Standard macOS installer |
| **Build tool** | pi-gen (Docker) | pkgbuild + productbuild |
| **Image size** | ~2.5GB compressed | ~50MB (no model) |

---

## Part 1: Raspberry Pi — Commander OS Image

### Approach: pi-gen with a Custom Stage

pi-gen is the official tool used to build Raspberry Pi OS images. We add a custom `stage-commander` that installs everything on top of Raspberry Pi OS Lite (64-bit).

### Directory Structure

```
build/
├── pi/
│   ├── config                          # pi-gen configuration
│   ├── stage-commander/
│   │   ├── 00-install-deps/
│   │   │   ├── 00-packages             # apt packages to install
│   │   │   └── 01-run.sh               # install Node.js, NVMe support
│   │   ├── 01-install-signalk/
│   │   │   └── 00-run.sh               # install & configure SignalK server
│   │   ├── 02-install-ollama/
│   │   │   └── 00-run.sh               # install Ollama + pre-pull Qwen 3B
│   │   ├── 03-install-commander/
│   │   │   ├── 00-run.sh               # install Commander app
│   │   │   └── files/                   # systemd units, configs
│   │   │       ├── commander.service
│   │   │       ├── signalk.service
│   │   │       └── ollama.service
│   │   ├── 04-configure-can/
│   │   │   └── 00-run.sh               # CAN bus (PICAN-M) auto-config
│   │   └── 05-first-boot/
│   │       └── 00-run.sh               # first-boot setup script
│   └── build.sh                        # wrapper to invoke pi-gen
├── mac/
│   └── ...                             # (see Part 2)
└── README.md
```

### pi-gen Config File

```bash
# build/pi/config

IMG_NAME="commander-os"
RELEASE="bookworm"
TARGET_HOSTNAME="commander"
FIRST_USER_NAME="captain"
FIRST_USER_PASS="commander"
ENABLE_SSH="1"
LOCALE_DEFAULT="en_US.UTF-8"
KEYBOARD_KEYMAP="us"
TIMEZONE_DEFAULT="UTC"

# Build Lite image (no desktop), then add our stage
STAGE_LIST="stage0 stage1 stage2 stage-commander"
```

### Stage Scripts

#### `00-install-deps/00-packages`

```
can-utils
git
curl
build-essential
```

#### `00-install-deps/01-run.sh`

```bash
#!/bin/bash -e
# Install Node.js 20 LTS (ARM64)
on_chroot << 'CHEOF'
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Enable PCIe / NVMe support
echo "dtparam=pciex1" >> /boot/firmware/config.txt
# Optional: force Gen 3 for faster NVMe
echo "dtparam=pciex1_gen=3" >> /boot/firmware/config.txt

# Enable CAN bus interface for PICAN-M
echo "dtoverlay=mcp2515-can0,oscillator=16000000,interrupt=25" >> /boot/firmware/config.txt
echo "dtoverlay=spi-bcm2835-overlay" >> /boot/firmware/config.txt
CHEOF
```

#### `01-install-signalk/00-run.sh`

```bash
#!/bin/bash -e
on_chroot << 'CHEOF'
# Install SignalK server
npm install -g signalk-server

# Create SignalK data directory
mkdir -p /home/captain/.signalk

# Default SignalK configuration for PICAN-M (CAN bus)
cat > /home/captain/.signalk/settings.json << 'SKEOF'
{
  "interfaces": {},
  "pipedProviders": [
    {
      "id": "canbus-nmea2000",
      "enabled": true,
      "pipeElements": [
        {
          "type": "providers/canbus",
          "options": {
            "canDevice": "can0"
          }
        },
        {
          "type": "providers/analyzer",
          "options": {}
        },
        {
          "type": "providers/n2k-signalk"
        }
      ]
    }
  ]
}
SKEOF

chown -R captain:captain /home/captain/.signalk
CHEOF
```

#### `02-install-ollama/00-run.sh`

```bash
#!/bin/bash -e
on_chroot << 'CHEOF'
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pre-pull the default Pi model (Qwen 2.5 3B)
# This bakes the model into the image so it works offline immediately
ollama serve &
OLLAMA_PID=$!
sleep 5
ollama pull qwen2.5:3b
kill $OLLAMA_PID
wait $OLLAMA_PID 2>/dev/null || true

# Configure Ollama for Pi 5 (3 threads, leave 1 for system)
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'OLEOF'
[Service]
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_THREAD=3"
OLEOF
CHEOF
```

#### `03-install-commander/00-run.sh`

```bash
#!/bin/bash -e
# Copy Commander application
on_chroot << 'CHEOF'
mkdir -p /opt/commander
CHEOF

# Copy app files into the image
install -m 755 -d "${ROOTFS_DIR}/opt/commander"
cp -r "${STAGE_DIR}/files/app/"* "${ROOTFS_DIR}/opt/commander/"

on_chroot << 'CHEOF'
cd /opt/commander
npm install --production

# Install systemd services
cp /opt/commander/systemd/commander.service /etc/systemd/system/
cp /opt/commander/systemd/ollama-ready.service /etc/systemd/system/
systemctl enable commander.service
systemctl enable ollama.service
systemctl enable ollama-ready.service
CHEOF
```

#### `04-configure-can/00-run.sh`

```bash
#!/bin/bash -e
on_chroot << 'CHEOF'
# Auto-bring-up CAN interface on boot
cat > /etc/network/interfaces.d/can0 << 'CANEOF'
auto can0
iface can0 inet manual
    pre-up /sbin/ip link set can0 type can bitrate 250000
    up /sbin/ip link set up can0
    down /sbin/ip link set down can0
CANEOF

# Ensure SignalK starts after CAN is up
mkdir -p /etc/systemd/system/signalk.service.d
cat > /etc/systemd/system/signalk.service.d/after-can.conf << 'SKEOF'
[Unit]
After=network-online.target sys-subsystem-net-devices-can0.device
Wants=sys-subsystem-net-devices-can0.device
SKEOF
CHEOF
```

#### `05-first-boot/00-run.sh`

```bash
#!/bin/bash -e
on_chroot << 'CHEOF'
# Create first-boot script that runs the setup wizard on first login
cat > /etc/profile.d/commander-first-boot.sh << 'FBEOF'
if [ ! -f /opt/commander/boat-config.json ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║  ⚓ Welcome to Commander OS!                        ║"
    echo "║  Run the setup wizard to configure your boat.       ║"
    echo "║                                                      ║"
    echo "║  Type:  commander-setup                              ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo ""
fi
FBEOF

# Create convenience commands
ln -sf /opt/commander/node_modules/.bin/signalk-server /usr/local/bin/signalk-server
cat > /usr/local/bin/commander-setup << 'CSEOF'
#!/bin/bash
cd /opt/commander && node setup-wizard.js
CSEOF
chmod +x /usr/local/bin/commander-setup

cat > /usr/local/bin/commander-start << 'CSEOF'
#!/bin/bash
cd /opt/commander && node commander.js
CSEOF
chmod +x /usr/local/bin/commander-start
CHEOF
```

### Systemd Services

#### `commander.service`

```ini
[Unit]
Description=Commander — AI Boat Monitor
After=network-online.target ollama.service signalk.service
Wants=network-online.target ollama.service signalk.service

[Service]
Type=simple
User=captain
WorkingDirectory=/opt/commander
ExecStart=/usr/bin/node commander.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Build Script

```bash
#!/bin/bash
# build/pi/build.sh — Build Commander OS image
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_GEN_DIR="/tmp/pi-gen"
VERSION=$(node -p "require('$REPO_ROOT/digestion/package.json').version")

echo "Building Commander OS v${VERSION} for Raspberry Pi 5..."

# Clone pi-gen (arm64 branch for Pi 5)
if [ ! -d "$PI_GEN_DIR" ]; then
    git clone --branch arm64 --depth 1 https://github.com/RPi-Distro/pi-gen.git "$PI_GEN_DIR"
fi

# Copy our config
cp "$SCRIPT_DIR/config" "$PI_GEN_DIR/config"

# Skip stages 3-5 (desktop, apps) — we're building on top of Lite
touch "$PI_GEN_DIR/stage3/SKIP" "$PI_GEN_DIR/stage4/SKIP" "$PI_GEN_DIR/stage5/SKIP"
touch "$PI_GEN_DIR/stage3/SKIP_IMAGES" "$PI_GEN_DIR/stage4/SKIP_IMAGES" "$PI_GEN_DIR/stage5/SKIP_IMAGES"

# Copy our custom stage
cp -r "$SCRIPT_DIR/stage-commander" "$PI_GEN_DIR/"

# Copy app files into the stage for installation
mkdir -p "$PI_GEN_DIR/stage-commander/03-install-commander/files/app"
cp "$REPO_ROOT/digestion/"*.js "$PI_GEN_DIR/stage-commander/03-install-commander/files/app/"
cp "$REPO_ROOT/digestion/package.json" "$PI_GEN_DIR/stage-commander/03-install-commander/files/app/"
cp "$REPO_ROOT/digestion/boat-config.template.json" "$PI_GEN_DIR/stage-commander/03-install-commander/files/app/"

# Build using Docker (works on any Linux host)
cd "$PI_GEN_DIR"
CLEAN=1 ./build-docker.sh

# Compress output
OUTPUT=$(ls -t deploy/*.img 2>/dev/null | head -1)
if [ -n "$OUTPUT" ]; then
    xz -9 -T0 "$OUTPUT"
    FINAL="${OUTPUT}.xz"
    echo "Image built: $FINAL"
    echo "Size: $(du -h "$FINAL" | cut -f1)"
else
    echo "ERROR: No image found in deploy/"
    exit 1
fi
```

### GitHub Actions Workflow

```yaml
# .github/workflows/build-pi-image.yml
name: Build Commander OS (Pi)

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-pi:
    runs-on: ubuntu-latest
    timeout-minutes: 120

    steps:
      - uses: actions/checkout@v4

      - name: Enable ARM emulation
        uses: docker/setup-qemu-action@v3

      - name: Build Pi image with pi-gen
        uses: usimd/pi-gen-action@v1
        with:
          image-name: commander-os
          pi-gen-version: arm64
          stage-list: stage0 stage1 stage2 ./build/pi/stage-commander
          hostname: commander
          username: captain
          password: commander
          locale: en_US.UTF-8
          enable-ssh: 1

      - name: Compress image
        run: xz -9 -T0 deploy/*.img

      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          files: deploy/*.img.xz
```

### What the User Does

```
1. Download commander-os-pi5-v0.2.0.img.xz from website
2. Open Raspberry Pi Imager
3. Choose "Use custom" → select the .img.xz file
4. Flash to NVMe SSD (via USB adapter) or microSD
5. Insert into Pi 5 with M.2 HAT+ and PICAN-M
6. Connect PICAN-M to NMEA 2000 backbone
7. Power on — Pi boots from NMEA 2000 power
8. SSH in: ssh captain@commander.local (password: commander)
9. Run: commander-setup
10. Scan WhatsApp QR code
11. Text your boat: "status"
```

---

## Part 2: Mac Mini — Installer Package

### Approach: Shell Installer + macOS .pkg

macOS doesn't allow distributing full disk images with the OS. Instead, we ship:
1. A `.pkg` installer that installs Commander + dependencies
2. A post-install script that pulls the Ollama model on first run

### Directory Structure

```
build/
├── mac/
│   ├── scripts/
│   │   ├── preinstall.sh              # Check prerequisites
│   │   ├── postinstall.sh             # Install Ollama, SignalK, pull model
│   │   └── uninstall.sh               # Clean removal
│   ├── resources/
│   │   ├── welcome.html               # Installer welcome screen
│   │   ├── license.html               # License
│   │   └── conclusion.html            # Post-install instructions
│   ├── distribution.xml               # Installer UI definition
│   ├── build-pkg.sh                   # Build the .pkg
│   └── com.commander.plist            # LaunchDaemon for auto-start
└── pi/
    └── ...                            # (see Part 1)
```

### Pre-Install Script

```bash
#!/bin/bash
# build/mac/scripts/preinstall.sh
# Runs before installation — check prerequisites

set -e

# Check macOS version (need 14+ for M4)
SW_VER=$(sw_vers -productVersion | cut -d. -f1)
if [ "$SW_VER" -lt 14 ]; then
    echo "Commander requires macOS 14 (Sonoma) or later."
    exit 1
fi

# Check architecture (must be Apple Silicon)
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
    echo "Commander requires Apple Silicon (M1/M2/M4)."
    exit 1
fi

# Check available RAM (need 16GB+)
RAM_GB=$(sysctl -n hw.memsize | awk '{print int($1/1073741824)}')
if [ "$RAM_GB" -lt 16 ]; then
    echo "Warning: ${RAM_GB}GB RAM detected. 24GB+ recommended for Qwen 14B."
    echo "Commander will use a smaller model (Qwen 3B) instead."
fi

echo "Prerequisites OK: macOS ${SW_VER}, ${ARCH}, ${RAM_GB}GB RAM"
exit 0
```

### Post-Install Script

```bash
#!/bin/bash
# build/mac/scripts/postinstall.sh
# Runs after files are copied — install runtime dependencies

set -e
LOG="/var/log/commander-install.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== Commander Post-Install $(date) ==="

INSTALL_DIR="/opt/commander"
CAPTAIN_USER=$(stat -f '%Su' /dev/console)  # Current logged-in user

# ── Install Homebrew if not present ─────────────────────
if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew..."
    su "$CAPTAIN_USER" -c '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
fi

# ── Install Node.js ─────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "Installing Node.js..."
    su "$CAPTAIN_USER" -c "brew install node@20"
fi

# ── Install SignalK ─────────────────────────────────────
if ! command -v signalk-server &>/dev/null; then
    echo "Installing SignalK server..."
    npm install -g signalk-server
fi

# ── Install Ollama ──────────────────────────────────────
if ! command -v ollama &>/dev/null; then
    echo "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# ── Install npm dependencies ───────────────────────────
cd "$INSTALL_DIR"
npm install --production

# ── Determine model based on RAM ────────────────────────
RAM_GB=$(sysctl -n hw.memsize | awk '{print int($1/1073741824)}')
if [ "$RAM_GB" -ge 24 ]; then
    MODEL="qwen2.5:14b"
elif [ "$RAM_GB" -ge 16 ]; then
    MODEL="qwen2.5:7b"
else
    MODEL="qwen2.5:3b"
fi

echo "RAM: ${RAM_GB}GB → Selected model: ${MODEL}"

# ── Pull model (this is the slow part — ~4-8GB download) ──
echo "Pulling ${MODEL}... (this may take 5-15 minutes)"
ollama pull "$MODEL"

# ── Install LaunchDaemon for auto-start ─────────────────
cp "$INSTALL_DIR/com.commander.plist" /Library/LaunchDaemons/
launchctl load /Library/LaunchDaemons/com.commander.plist

# ── Set ownership ───────────────────────────────────────
chown -R "$CAPTAIN_USER" "$INSTALL_DIR"

echo "=== Commander installed successfully ==="
echo "Run 'commander-setup' to configure your boat."
exit 0
```

### LaunchDaemon (Auto-Start)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.commander.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/commander/commander.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/opt/commander</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/commander.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/commander-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
```

### distribution.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>Commander — AI Boat Monitor</title>
    <organization>com.commander</organization>
    <domains enable_localSystem="true"/>
    <options customize="never" require-scripts="true" rootVolumeOnly="true"/>

    <welcome file="welcome.html" mime-type="text/html"/>
    <license file="license.html" mime-type="text/html"/>
    <conclusion file="conclusion.html" mime-type="text/html"/>

    <choices-outline>
        <line choice="com.commander.app"/>
    </choices-outline>

    <choice id="com.commander.app"
            visible="false"
            title="Commander Application">
        <pkg-ref id="com.commander.app"/>
    </choice>

    <pkg-ref id="com.commander.app"
             version="0.2.0"
             onConclusion="none">commander-app.pkg</pkg-ref>
</installer-gui-script>
```

### Build Script

```bash
#!/bin/bash
# build/mac/build-pkg.sh — Build Commander macOS installer
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION=$(node -p "require('$REPO_ROOT/digestion/package.json').version")
BUILD_DIR="/tmp/commander-pkg-build"
OUTPUT_DIR="$REPO_ROOT/deploy"

echo "Building Commander Mac installer v${VERSION}..."

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/payload/opt/commander"
mkdir -p "$BUILD_DIR/scripts"
mkdir -p "$BUILD_DIR/resources"
mkdir -p "$OUTPUT_DIR"

# ── Copy application files ──────────────────────────────
cp "$REPO_ROOT/digestion/"*.js "$BUILD_DIR/payload/opt/commander/"
cp "$REPO_ROOT/digestion/package.json" "$BUILD_DIR/payload/opt/commander/"
cp "$REPO_ROOT/digestion/boat-config.template.json" "$BUILD_DIR/payload/opt/commander/"
cp "$SCRIPT_DIR/com.commander.plist" "$BUILD_DIR/payload/opt/commander/"

# ── Copy scripts ────────────────────────────────────────
cp "$SCRIPT_DIR/scripts/preinstall.sh" "$BUILD_DIR/scripts/preinstall"
cp "$SCRIPT_DIR/scripts/postinstall.sh" "$BUILD_DIR/scripts/postinstall"
chmod +x "$BUILD_DIR/scripts/"*

# ── Copy resources ──────────────────────────────────────
cp "$SCRIPT_DIR/resources/"* "$BUILD_DIR/resources/"
cp "$SCRIPT_DIR/distribution.xml" "$BUILD_DIR/"

# ── Build component package ─────────────────────────────
pkgbuild \
    --root "$BUILD_DIR/payload" \
    --identifier "com.commander.app" \
    --version "$VERSION" \
    --scripts "$BUILD_DIR/scripts" \
    --install-location "/" \
    "$BUILD_DIR/commander-app.pkg"

# ── Build product archive (final .pkg) ──────────────────
productbuild \
    --distribution "$BUILD_DIR/distribution.xml" \
    --resources "$BUILD_DIR/resources" \
    --package-path "$BUILD_DIR" \
    "$OUTPUT_DIR/commander-mac-v${VERSION}.pkg"

echo "Installer built: $OUTPUT_DIR/commander-mac-v${VERSION}.pkg"
echo "Size: $(du -h "$OUTPUT_DIR/commander-mac-v${VERSION}.pkg" | cut -f1)"

# ── Optional: Sign and notarize ─────────────────────────
# Uncomment when you have an Apple Developer ID:
#
# productsign --sign "Developer ID Installer: Your Name (TEAMID)" \
#     "$OUTPUT_DIR/commander-mac-v${VERSION}.pkg" \
#     "$OUTPUT_DIR/commander-mac-v${VERSION}-signed.pkg"
#
# xcrun notarytool submit "$OUTPUT_DIR/commander-mac-v${VERSION}-signed.pkg" \
#     --apple-id "your@email.com" \
#     --team-id "TEAMID" \
#     --password "@keychain:AC_PASSWORD" \
#     --wait
#
# xcrun stapler staple "$OUTPUT_DIR/commander-mac-v${VERSION}-signed.pkg"
```

### GitHub Actions Workflow

```yaml
# .github/workflows/build-mac-installer.yml
name: Build Commander Mac Installer

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build .pkg installer
        run: bash build/mac/build-pkg.sh

      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          files: deploy/*.pkg
```

### What the User Does

```
1. Download commander-mac-v0.2.0.pkg from website
2. Double-click the .pkg file
3. Follow installer prompts (click through)
4. Wait for post-install (installs Ollama, SignalK, pulls Qwen 14B model — ~10 min)
5. Connect Actisense NGT-1 USB to NMEA 2000 backbone
6. Open Terminal, run: commander-setup
7. Scan WhatsApp QR code
8. Text your boat: "status"
```

---

## Part 3: Alternative — Quick Install Script

For users who don't want to flash an image or run an installer, provide a one-liner:

### Pi (on existing Raspberry Pi OS)

```bash
curl -fsSL https://mastercommander.namibarden.com/install.sh | bash
```

### Mac (on existing macOS)

```bash
curl -fsSL https://mastercommander.namibarden.com/install-mac.sh | bash
```

### `install.sh` (Pi version)

```bash
#!/bin/bash
# Quick install Commander on an existing Raspberry Pi OS
set -e

echo "⚓ Installing Commander..."

# Install dependencies
sudo apt-get update
sudo apt-get install -y can-utils nodejs npm

# Install SignalK
sudo npm install -g signalk-server

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Clone Commander
git clone https://github.com/bluemele/MasterCommander.git /opt/commander
cd /opt/commander/digestion
npm install --production

# Pull default model
ollama pull qwen2.5:3b

# Run setup
node setup-wizard.js

echo "⚓ Commander installed! Run: node /opt/commander/digestion/commander.js"
```

---

## Part 4: Offline Model Embedding (Pi Image)

The Pi image **must** include the LLM model pre-downloaded, because many boats have no internet at the dock.

### How Ollama Models Are Stored

```
~/.ollama/
├── models/
│   ├── manifests/
│   │   └── registry.ollama.ai/
│   │       └── library/
│   │           └── qwen2.5/
│   │               └── 3b          # manifest file
│   └── blobs/
│       ├── sha256-abc123...        # model weights (~1.7GB for Q4_K_M)
│       └── sha256-def456...        # tokenizer, config
```

### Baking Into pi-gen Image

In the `02-install-ollama/00-run.sh` stage, we:
1. Start Ollama temporarily inside the chroot
2. Pull the model (downloads into the image filesystem)
3. Stop Ollama
4. The model files remain in the image at `/home/captain/.ollama/models/`

This adds ~1.7GB to the image (for Qwen 2.5:3B Q4_K_M), bringing the total uncompressed image to ~4GB, or ~2.5GB compressed with xz.

### For Mac: Download on First Run

The Mac installer is lightweight (~50MB). The postinstall script downloads the model after installation. This is acceptable because:
- Mac Mini users typically have internet during setup (at the dock)
- The 14B model is ~8GB — too large to ship in a .pkg file
- Apple's notarization process has size limits

---

## Part 5: Release Process

### Versioning

Follow the existing `package.json` version (currently `0.2.0`).

### Tag and Release

```bash
# Bump version in digestion/package.json
# Commit the change
git tag v0.2.0
git push origin v0.2.0
# GitHub Actions builds both Pi image and Mac installer
# Artifacts are uploaded to the GitHub Release
```

### Download Page

The website at `mastercommander.namibarden.com` links to the latest GitHub Release:

```
Download Commander OS
├── Raspberry Pi 5 → commander-os-pi5-v0.2.0.img.xz (2.5GB)
│   Flash with Raspberry Pi Imager. Works offline immediately.
│
├── Mac Mini M4 → commander-mac-v0.2.0.pkg (50MB)
│   Double-click to install. Requires internet for model download.
│
└── Manual Install → curl -fsSL .../install.sh | bash
    For existing systems. Works on any Linux or macOS.
```

---

## Summary

| Step | Pi Image | Mac Installer |
|------|----------|---------------|
| **Build tool** | pi-gen (Docker, arm64 branch) | pkgbuild + productbuild |
| **CI** | GitHub Actions + QEMU | GitHub Actions (macos-latest) |
| **Output** | .img.xz (~2.5GB) | .pkg (~50MB) |
| **Includes OS** | Yes | No |
| **Includes model** | Yes (Qwen 3B, 1.7GB) | No (downloaded post-install) |
| **Works offline** | Immediately | After first-run model download |
| **User effort** | Flash → plug in → setup wizard | Install → wait for download → setup wizard |
| **Signing** | N/A | Apple Developer ID + notarization |

## Sources

- [pi-gen — Official Raspberry Pi OS image builder](https://github.com/RPi-Distro/pi-gen)
- [rpi-image-gen — New Raspberry Pi image builder (2025)](https://github.com/raspberrypi/rpi-image-gen)
- [usimd/pi-gen-action — GitHub Action for pi-gen](https://github.com/usimd/pi-gen-action)
- [pguyot/arm-runner-action — ARM emulation in GitHub Actions](https://github.com/pguyot/arm-runner-action)
- [CustomPiOS — Modular Pi distribution builder](https://github.com/guysoft/CustomPiOS)
- [OpenPlotter pi-gen fork — Marine distro example](https://github.com/openplotter/pi-gen)
- [Ollama offline installation](https://github.com/ollama/ollama/issues/696)
- [Ollama Linux docs](https://docs.ollama.com/linux)
- [Apple pkgbuild documentation](https://keith.github.io/xcode-man-pages/pkgbuild.1.html)
- [Packaging Mac software for distribution — Apple](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Distributing macOS apps with Packages — AppCoda](https://www.appcoda.com/packages-macos-apps-distribution/)
- [Mikegyver 12V Mac Mini mod](https://mikegyver.com/products/upgrade-service-12v-apple-mac-mini-m1-m2-m4-in-your-car-rv-boat)
