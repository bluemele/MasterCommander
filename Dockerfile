# Stage 1: Install Node.js dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache git
WORKDIR /app
COPY digestion/package.json ./
RUN npm install --omit=dev

# Stage 2: Final image — nginx + Node.js backend
FROM nginx:alpine

# Install Node.js in the nginx image
RUN apk add --no-cache nodejs

# Nginx config
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static frontend
COPY public/ /usr/share/nginx/html/

# Digestion backend — entry points at /app, libraries in /app/lib
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY digestion/package.json ./
COPY digestion/commander.js digestion/test.js digestion/setup-wizard.js digestion/simulator.js ./
COPY digestion/boat-config.json digestion/boat-config.template.json ./
COPY digestion/signalk-client.js digestion/alert-engine.js digestion/llm-router.js digestion/status-builder.js digestion/whatsapp.js ./lib/

# Start script: nginx in background, commander in foreground
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
CMD ["/start.sh"]
