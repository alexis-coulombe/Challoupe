import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { DEFAULT_PERMISSIONS, PERMISSION_COLUMNS, PERMISSIONS } from './permissions.js';

// Tests run against an isolated in-memory database instead of touching disk.
const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(DATA_DIR, 'challoupe.db');
if (dbPath !== ':memory:') {
  mkdirSync(DATA_DIR, { recursive: true });
} 

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_username TEXT NOT NULL,
  ssh_private_key TEXT NOT NULL,
  ssh_passphrase TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS stack_webhooks (
  stack_name TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Added after the initial release: bring existing databases up to date one column at a
// time, since better-sqlite3 has no migration framework of its own.
const existingColumns = new Set(
  (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((c) => c.name)
);

for (const permission of PERMISSIONS) {
  const column = PERMISSION_COLUMNS[permission];
  if (!existingColumns.has(column)) {
    const fallback = DEFAULT_PERMISSIONS[permission] ? 1 : 0;
    db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT ${fallback}`);
  }
}

if (!existingColumns.has('auth_provider')) {
  db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
}

if (!existingColumns.has('totp_secret')) {
  db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
}

if (!existingColumns.has('totp_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
}

if (!existingColumns.has('totp_backup_codes')) {
  db.exec('ALTER TABLE users ADD COLUMN totp_backup_codes TEXT');
}
