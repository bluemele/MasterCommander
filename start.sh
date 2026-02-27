#!/bin/sh

# Start nginx in the background
nginx -g 'daemon off;' &
NGINX_PID=$!

# Start the digestion backend
cd /app
node commander.js --no-whatsapp &
COMMANDER_PID=$!

# If signaled, stop both
trap "kill $NGINX_PID $COMMANDER_PID 2>/dev/null; exit" SIGTERM SIGINT

# Poll for either process dying
while kill -0 $NGINX_PID 2>/dev/null && kill -0 $COMMANDER_PID 2>/dev/null; do
  sleep 2
done

kill $NGINX_PID $COMMANDER_PID 2>/dev/null
exit 1
