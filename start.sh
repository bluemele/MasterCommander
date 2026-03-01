#!/bin/sh

# Start nginx in the background
nginx -g 'daemon off;' &
NGINX_PID=$!

# Start the digestion backend
cd /app

# Start simulator (fake SignalK source on :3858)
node simulator.js --profile cat58 &
SIM_PID=$!
sleep 1

# Start commander (connects to simulator, telemetry API on :3100)
node commander.js --no-whatsapp &
COMMANDER_PID=$!

# If signaled, stop all
trap "kill $NGINX_PID $SIM_PID $COMMANDER_PID 2>/dev/null; exit" SIGTERM SIGINT

# Poll for any process dying
while kill -0 $NGINX_PID 2>/dev/null && kill -0 $SIM_PID 2>/dev/null && kill -0 $COMMANDER_PID 2>/dev/null; do
  sleep 2
done

kill $NGINX_PID $SIM_PID $COMMANDER_PID 2>/dev/null
exit 1
