# syntax=docker/dockerfile:1

# ---- build: install all deps once, compile both workspaces ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Docker CLI + the Compose plugin — client only. Challoupe talks to the *host's* daemon over
# the socket mounted in at /var/run/docker.sock; it never runs a daemon of its own. The CLI
# binary is still needed because stacks.ts shells out to `docker compose` for deploy/down.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && apt-get purge -y curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# Production deps only — better-sqlite3's native binding is compiled/fetched here, against
# this same base image, so it matches what actually runs it.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --omit=dev --workspace=@challoupe/server

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

EXPOSE 3001
VOLUME ["/app/data"]

# Runs as root: it needs to read /var/run/docker.sock, whose group ownership varies by host
# and can't be predicted at image-build time — the same constraint every Docker-socket-
# mounting management tool (Portainer included) runs into, and the same trade-off they make.
# Picks http vs https based on whether TLS is configured, and skips certificate
# verification (rejectUnauthorized:false) since this is only ever probing the container's
# own loopback address — a self-signed cert there is expected, not a trust decision.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "\
    const mod = require(process.env.TLS_CERT_FILE ? 'https' : 'http'); \
    const req = mod.get({ host: '127.0.0.1', port: process.env.PORT || 3001, path: '/api/auth/status', rejectUnauthorized: false, timeout: 3000 }, (res) => process.exit(res.statusCode < 500 ? 0 : 1)); \
    req.on('error', () => process.exit(1)); \
    req.on('timeout', () => { req.destroy(); process.exit(1); }); \
  "

CMD ["node", "apps/server/dist/index.js"]
