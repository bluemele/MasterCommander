#!/bin/sh

# Start nginx in the background
nginx -g 'daemon off;' &
NGINX_PID=$!

# Start the digestion backend
cd /app
node commander.js --no-whatsapp &
COMMANDER_PID=$!

# If either process exits, stop the other
trap "kill $NGINX_PID $COMMANDER_PID 2>/dev/null; exit" SIGTERM SIGINT

wait -n
kill $NGINX_PID $COMMANDER_PID 2>/dev/null
exit 1
