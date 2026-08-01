<p align="center">
  <img src="assets/brand/banner.svg" width="720">
</p>

A self-hosted Docker manager: containers, images, volumes, networks, compose stacks, and user management. Across the local host and any number of remote Docker hosts over SSH.

## Architecture

| Directory | Role | Technologies |
|---|---|---|
| `apps/server` | REST + WebSocket API, serves the built frontend | Express 5, ws, dockerode, ssh2, better-sqlite3, express-session, bcryptjs, zod |
| `apps/web` | Web interface (SPA) | React 18, Ant Design 5, TanStack Query, CodeMirror, xterm.js, Vite |

Beyond the basics of containers, images, volumes and networks, Challoupe covers compose stacks with deploy webhooks, any number of remote Docker hosts over SSH, granular per-user permissions with two-factor and SSO sign-in, a local AI assistant, vulnerability scanning, resource alerts, webhook/ntfy notifications, a full audit log, and backup/restore.

Full documentation, everything above explained chapter by chapter, lives in [`docs/docs.html`](docs/docs.html). Open it in a browser (or clone the repo and open the file locally) for the details on any of it.

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
docker pull ghcr.io/alexis-coulombe/challoupe:latest
docker run -d --name challoupe \
  -p 3001:3001 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v challoupe_data:/app/data \
  ghcr.io/alexis-coulombe/challoupe:latest
```

Mounts `/var/run/docker.sock` to manage the host's Docker daemon, and persists `data/` in a named volume. Runs as root since the host socket's group ownership isn't predictable ahead of time.

Or, from a clone of this repo, `docker-compose.yml` already points at the same published image:

```bash
git clone https://github.com/alexis-coulombe/Challoupe.git
cd Challoupe
docker compose up -d
```

To build from source instead (e.g. to test a local change), use `docker compose up -d --build`, which uses the included multi-stage `Dockerfile` (compiles both workspaces, then a slim runtime with the Docker CLI + Compose plugin, needed since stacks shell out to `docker compose`).

To serve HTTPS directly, set `TLS_CERT_FILE`/`TLS_KEY_FILE` (see below) to a cert/key pair mounted into the container; `docker-compose.yml` has a commented-out example. Otherwise put a reverse proxy (Traefik, Caddy, nginx) in front.

The Storage stat needs the host's Docker root directory mounted (read-only) at the same path to read real disk usage; `docker-compose.yml` has a commented-out example. Find the path with `docker info --format '{{.DockerRootDir}}'` (usually `/var/lib/docker`).

## Testing

```bash
npm test            # runs both apps' test suites
npm run test -w apps/server   # backend only (vitest + supertest, mocked Docker client)
npm run test -w apps/web      # frontend only (vitest + Testing Library)
```

Tests run against an in-memory database and an isolated temp directory (`NODE_ENV=test`), never touching your real `data/` directory. Container/image route tests mock the `dockerode` client instead of hitting a real daemon.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server listen port |
| `HOST` | `0.0.0.0` | Listen interface |
| `DATA_DIR` | `./data` | SQLite database, session secret, host SSH encryption key, and stacks |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker socket |
| `SESSION_SECRET` | generated and persisted under `data/` | Session signing secret |
| `TLS_CERT_FILE` | unset | Path to a PEM certificate (set together with `TLS_KEY_FILE` to serve HTTPS directly) |
| `TLS_KEY_FILE` | unset | Path to the matching PEM private key |
| `TRUST_PROXY` | `false` | Set to `true` only behind a trusted reverse proxy forwarding `X-Forwarded-*`; fixes the session cookie's `Secure` flag and audit-log IP |
| `PUBLIC_URL` | reflects the incoming request | Externally-reachable base URL (e.g. `https://challoupe.example.com`), needed if a proxy hides the original host/proto. Used for the OIDC callback URL |

## License

Challoupe is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). You're free to use, modify, and redistribute it; if you run a modified version as a network service, you have to make that modified source available to its users too.
