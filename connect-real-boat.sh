#!/bin/bash
# Connect MasterCommander to a real SignalK server (e.g., laptop on boat WiFi)
# Usage: ./connect-real-boat.sh <laptop-ip> [port]
# Example: ./connect-real-boat.sh 192.168.1.42 3000

set -e

IP="${1}"
PORT="${2:-3000}"
CONFIG="digestion/boat-config.json"
CONTAINER="mastercommander"

if [ -z "$IP" ]; then
  echo "Usage: $0 <signalk-host-ip> [port]"
  echo "  Example: $0 192.168.1.42 3000"
  exit 1
fi

echo "Pointing SignalK at $IP:$PORT ..."

# Update boat-config.json in place (Python available everywhere)
python3 - <<EOF
import json, sys
with open("$CONFIG") as f:
    cfg = json.load(f)
cfg["signalk"]["host"] = "$IP"
cfg["signalk"]["port"] = $PORT
with open("$CONFIG", "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print("  Updated $CONFIG")
EOF

# Push config into running container (no rebuild needed)
docker cp "$CONFIG" "$CONTAINER:/app/digestion/boat-config.json"
echo "  Copied into container"

# Restart the node process (container stays up, nginx keeps serving)
docker exec "$CONTAINER" sh -c "kill -SIGHUP \$(pgrep -f commander.js) 2>/dev/null || true"
sleep 1
# If SIGHUP didn't reload, do a full container restart
if ! docker exec "$CONTAINER" pgrep -f commander.js > /dev/null 2>&1; then
  docker restart "$CONTAINER"
  echo "  Container restarted"
else
  # Force restart to pick up new config
  docker restart "$CONTAINER"
  echo "  Container restarted"
fi

echo ""
echo "Done. MasterCommander is now connecting to SignalK at $IP:$PORT"
echo "Check: docker logs $CONTAINER --tail 20"
