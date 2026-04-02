#!/bin/sh

# Start the digestion backend first (so it's ready when nginx starts proxying)
cd /app

# Start simulator (fake SignalK source on :3858)
node simulator.js --profile ${SIM_PROFILE:-gilsboat} &
SIM_PID=$!

# Wait for simulator to be ready before starting commander
echo "Waiting for simulator on :3858..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null http://127.0.0.1:3858/scenario 2>/dev/null; then
    echo "Simulator ready"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "WARNING: Simulator not responding after 30s, starting commander anyway"
  fi
  sleep 1
done

# Start commander (connects to simulator, telemetry API on :3100)
node commander.js &
COMMANDER_PID=$!

# Wait for telemetry API to be ready before starting nginx
echo "Waiting for telemetry API on :3100..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null http://127.0.0.1:3100/api/health 2>/dev/null; then
    echo "Telemetry API ready"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "WARNING: Telemetry API not responding after 30s, starting nginx anyway"
  fi
  sleep 1
done

# Start nginx last — backends are ready, no 502s
nginx -g 'daemon off;' &
NGINX_PID=$!

# If signaled, stop all
trap "kill $NGINX_PID $SIM_PID $COMMANDER_PID 2>/dev/null; exit" SIGTERM SIGINT

# Poll for any process dying
while kill -0 $NGINX_PID 2>/dev/null && kill -0 $SIM_PID 2>/dev/null && kill -0 $COMMANDER_PID 2>/dev/null; do
  sleep 2
done

kill $NGINX_PID $SIM_PID $COMMANDER_PID 2>/dev/null
exit 1
