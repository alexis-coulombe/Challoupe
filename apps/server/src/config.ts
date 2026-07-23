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
export const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '') || '';

// When both are set, index.ts serves HTTPS directly using this cert/key pair instead of
// plain HTTP.
export const TLS_CERT_FILE = process.env.TLS_CERT_FILE || '';
export const TLS_KEY_FILE = process.env.TLS_KEY_FILE || '';

// Set when a reverse proxy in front of this server terminates TLS itself and forwards
// plain HTTP.
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

export const SESSION_TTL_DAYS = 7;
