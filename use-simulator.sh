#!/bin/bash
# Switch MasterCommander back to the built-in simulator
# Usage: ./use-simulator.sh

set -e

CONFIG="digestion/boat-config.json"
CONTAINER="mastercommander"

echo "Switching to simulator (localhost:3858) ..."

python3 - <<EOF
import json
with open("$CONFIG") as f:
    cfg = json.load(f)
cfg["signalk"]["host"] = "localhost"
cfg["signalk"]["port"] = 3858
with open("$CONFIG", "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
print("  Updated $CONFIG")
EOF

docker cp "$CONFIG" "$CONTAINER:/app/digestion/boat-config.json"
docker restart "$CONTAINER"

echo "Done. Running on simulator."
echo "Check: docker logs $CONTAINER --tail 20"
