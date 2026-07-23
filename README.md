<p align="center">
  <img src="assets/brand/banner.svg" width="720">
</p>

A self-hosted Docker manager, containers, images, volumes, networks, docker-compose stacks and user management.

## Architecture

| Directory | Role | Technologies |
|---|---|---|
| `apps/server` | REST + WebSocket API, serves the built frontend | Express 5, ws, dockerode, better-sqlite3, express-session, bcryptjs, zod |
| `apps/web` | Web interface (SPA) | React 18, Ant Design 5, TanStack Query, CodeMirror, xterm.js, Vite |

- **Docker**: the server talks to the `/var/run/docker.sock` socket via dockerode.

- **Stacks**: each stack is a `docker-compose.yml` file stored under `data/stacks/<name>/`, deployed with the real `docker compose -p <name> up -d`.

- **Users**: SQLite (`data/challoupe.db`), bcrypt password hashes, httpOnly cookie
  sessions. Two roles: `admin` (can manage users and app-wide settings, always
  has every permission below) and `user`. On first run, the login screen prompts
  you to create the administrator account.

- **Two-factor authentication**: any local account can turn on TOTP (Google
  Authenticator, Authy, 1Password, etc.) from the user menu. A QR code and a
  manual-entry key, a confirmation code, then one set of single-use backup codes
  shown once. Not available for SSO accounts (the identity provider owns their
  login). An admin can reset a user's 2FA (Users page) if they lose their device
  and every backup code.

- **Permissions**: each `user` account can be individually granted any of eight
  capabilities from the Users page; manage containers, images, volumes, networks, or stacks (create/delete; listing and start/stop/restart/deploy stay
  available to everyone), open a container terminal, use the AI assistant, and   use the vulnerability scanner. Every capability is off by default except the AI
  assistant and vulnerability scanner, which default to on. Enforced on both the API (`requirePermission` middleware, checked independently of the app-wide
  feature flags) and the UI (the corresponding buttons/tabs are hidden without the permission).

- **Container creation**: beyond image/ports/env/volumes/restart policy, an "Advanced settings" panel exposes network selection, command override, working directory, user, labels, privileged mode, auto-remove, and memory/CPU limits.

- **Stack drift detection**: the Stacks list and each stack's page flag when its running containers no longer match its compose file, a service that's been stopped/removed outside Challoupe, a container Compose no longer knows about (what `--remove-orphans` would clean up on redeploy), or a running image that no longer matches what the file specifies (a tag bumped in the editor but not yet redeployed, or a manual change outside Challoupe entirely).

- **AI Assistant (local Ollama)**: point Settings at a local or LAN
  [Ollama](https://ollama.com) server to unlock features, nothing is sent
  anywhere but that Ollama instance:
  - **Log diagnosis** - a "Diagnose with AI" button on a container's Logs tab
    streams its recent logs and state to the model and gets back a plain-language
    explanation of what's happening and, if something's wrong, a likely fix.
  - **Stack generation** - "Generate with AI" in the stack editor turns a plain
    description ("a Postgres database with pgAdmin") into a draft docker-compose.yml.
  - **Chat assistant** - a floating button opens a persistent chat panel that has
    read-only awareness of your current containers and can answer general questions about your Docker environment.
  
- **Vulnerability scanning (local Trivy)**: a "Scan" action on the Images page runs [Trivy](https://trivy.dev) as a one-off container, no persistent scanner service needed. Challoupe mounts the Docker socket into that container so Trivy reads the local image directly, caches its vulnerability database under `data/trivy-cache/` so only the first scan pays the download cost, and returns a  severity-sorted CVE list (package, installed/fixed version, advisory link).

- **Audit log**: an admin-only page (`audit_log` table in SQLite) records who did
  what and when; container/image/volume/network/stack mutations, user management,
  settings changes, security scans, sign-ins/outs, password changes, and denied
  permission checks (who tried what and was refused). Toggled from the Audit Log
  page itself (`featureFlags.auditLog`, on by default); turning it off stops new
  entries without erasing history already recorded.

- **Backup/restore**: Exports every user, all settings, and every stack's compose file as one JSON file; restoring replaces all and signs everyone out so they re-authenticate against the restored state. An optional scheduler (off by default) writes the same export to `data/backups/` on a timer and prunes down to a configured number of most-recent files, for an unattended install where nobody would remember to click "Download backup".

## Getting started

```bash
npm install

# Development (API on :3001, Vite on :5173 with an /api proxy)
npm run dev

# Production
npm run build
npm start          # serves the full app on http://localhost:3001
```

## Running in Docker

```bash
docker compose up -d --build
```

This builds the image from the included `Dockerfile` (multi-stage: compiles both
workspaces, then a slim runtime with the Docker CLI + Compose plugin installed. Needed since stacks are deployed by shelling out to the real `docker compose`), mounts `/var/run/docker.sock` so it manages the *host's* Docker daemon, and persists `data/` in a named volume. The container needs to run as root: it has to read the host's Docker socket, whose group ownership isn't predictable at  image-build time.

To serve HTTPS directly instead of plain HTTP, set `TLS_CERT_FILE`/`TLS_KEY_FILE` (see below) to a cert/key pair mounted into the container.
`docker-compose.yml` has a commented-out example. Skip both and put a TLS-terminating reverse proxy (Traefik, Caddy, nginx) in front instead if you'd rather have it handle certificate renewal.

The Dashboard/Settings "Storage" stat needs the host's Docker root directory visible at the same path inside the container to read its disk usage. Mount it (read-only) to get real numbers;
`docker-compose.yml` has a commented-out example, and `docker info --format
'{{.DockerRootDir}}'` on the host tells you the exact path to use (usually `/var/lib/docker`).

## Testing

```bash
npm test            # runs both apps' test suites
npm run test -w apps/server   # backend only (vitest + supertest, mocked Docker client)
npm run test -w apps/web      # frontend only (vitest + Testing Library)
```

The backend test database runs fully in-memory in test mode (`NODE_ENV=test`), and
stack files are written to an isolated temp directory, tests never touch your real
Docker daemon's state or your `data/` directory. Route tests that exercise container creation/actions mock the `dockerode` client rather than hitting a real daemon.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server listen port |
| `HOST` | `0.0.0.0` | Listen interface |
| `DATA_DIR` | `./data` | SQLite database, session secret, and stacks |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker socket |
| `SESSION_SECRET` | generated and persisted under `data/` | Session signing secret |
| `TLS_CERT_FILE` | unset | Path to a PEM certificate (set together with `TLS_KEY_FILE` to serve HTTPS directly) |
| `TLS_KEY_FILE` | unset | Path to the matching PEM private key |
| `TRUST_PROXY` | `false` | Set to `true` **only** behind a reverse proxy you trust to forward `X-Forwarded-*`, makes the session cookie's `Secure` flag and audit-log IP reflect the original client correctly |
| `PUBLIC_URL` | reflects the incoming request | Externally-reachable base URL (e.g. `https://challoupe.example.com`); set this if that reflection is wrong (behind a proxy that doesn't forward the original host/proto). Used to build the OIDC SSO callback URL |