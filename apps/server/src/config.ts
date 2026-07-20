import path from 'node:path';

// Repo root: apps/server/src (dev) or apps/server/dist (prod) -> ../../..
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export const PORT = Number(process.env.PORT || 3001);
export const HOST = process.env.HOST || '0.0.0.0';
export const DATA_DIR = process.env.DATA_DIR || path.join(repoRoot, 'data');
export const STACKS_DIR = path.join(DATA_DIR, 'stacks');
export const TRIVY_CACHE_DIR = path.join(DATA_DIR, 'trivy-cache');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const DOCKER_SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';
export const WEB_DIST = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');
// Externally-reachable base URL, used to build the OIDC redirect_uri. Falls back to
// reflecting the incoming request when unset — fine for a direct connection, but a
// reverse proxy that doesn't forward the original protocol/host should set this.
export const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '') || '';

// When both are set, index.ts serves HTTPS directly using this cert/key pair instead of
// plain HTTP — point these at a self-signed pair, or a real one (e.g. certbot's
// fullchain.pem/privkey.pem), mounted into the container. Leave unset to run plain HTTP,
// e.g. behind a TLS-terminating reverse proxy instead (see TRUST_PROXY below).
export const TLS_CERT_FILE = process.env.TLS_CERT_FILE || '';
export const TLS_KEY_FILE = process.env.TLS_KEY_FILE || '';

// Set when a reverse proxy in front of this server terminates TLS itself and forwards
// plain HTTP — makes Express trust that proxy's `X-Forwarded-*` headers (so `req.secure`,
// `req.ip`, and the session cookie's `secure` flag reflect the original HTTPS request, not
// the proxy's own plain-HTTP hop). Never enable this unless the proxy is actually trusted
// and strips any client-supplied `X-Forwarded-*` header before setting its own.
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

export const SESSION_TTL_DAYS = 7;
