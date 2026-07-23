import bcrypt from 'bcryptjs';
import session from 'express-session';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import { DATA_DIR, SESSION_TTL_DAYS } from './config.js';
import {
  DEFAULT_PERMISSIONS,
  PERMISSION_COLUMNS,
  PERMISSIONS,
  type Permission,
  type Permissions,
} from './permissions.js';
import { auditLog } from './audit.js';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
  authProvider: 'local' | 'oidc';
  permissions: Permissions;
  totpEnabled: boolean;
}

interface RawUserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  auth_provider: 'local' | 'oidc';
  totp_secret: string | null;
  totp_enabled: number;
  totp_backup_codes: string | null;
  [column: string]: unknown;
}

function rowToUser(row: RawUserRow): User {
  const permissions = {} as Permissions;
  for (const permission of PERMISSIONS) {
    permissions[permission] = !!row[PERMISSION_COLUMNS[permission]];
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    authProvider: row.auth_provider,
    permissions,
    totpEnabled: !!row.totp_enabled,
  };
}

/**
 * Reads/writes the `users` table: account lookup, OIDC auto-provisioning, and the TOTP
 * fields stored alongside each user row.
 */
export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  getById(id: number): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawUserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY username').all() as RawUserRow[];
    return rows.map(rowToUser);
  }

  findByUsername(username: string): (User & { password_hash: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | RawUserRow
      | undefined;
    return row ? { ...rowToUser(row), password_hash: row.password_hash } : undefined;
  }

  /**
   * Finds the local account for a returning SSO user, or auto-provisions one on first login
   * @param username string
   * @returns User
   */
  findOrCreateOidc(username: string): User {
    const existing = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | RawUserRow
      | undefined;
    if (existing) {
      if (existing.auth_provider !== 'oidc') {
        throw Object.assign(
          new Error('An account with this username already exists locally'),
          { statusCode: 409 }
        );
      }
      return rowToUser(existing);
    }
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const columns = PERMISSIONS.map((p) => PERMISSION_COLUMNS[p]);
    const info = this.db
      .prepare(
        `INSERT INTO users (username, password_hash, role, auth_provider, ${columns.join(', ')}) VALUES (?, ?, 'user', 'oidc', ${columns
          .map(() => '?')
          .join(', ')})`
      )
      .run(username, passwordHash, ...PERMISSIONS.map((p) => (DEFAULT_PERMISSIONS[p] ? 1 : 0)));
    return this.getById(Number(info.lastInsertRowid))!;
  }

  /**
   * Returns a secret/backup-codes pair when TOTP is enabled
   * @param id 
   * @returns 
   */
  getTotpSecret(id: number): { secret: string; backupCodes: string[] } | undefined {
    const row = this.db
      .prepare('SELECT totp_secret, totp_backup_codes FROM users WHERE id = ? AND totp_enabled = 1')
      .get(id) as { totp_secret: string | null; totp_backup_codes: string | null } | undefined;
    if (!row || !row.totp_secret) return undefined;
    return {
      secret: row.totp_secret,
      backupCodes: row.totp_backup_codes ? (JSON.parse(row.totp_backup_codes) as string[]) : [],
    };
  }

  enableTotp(id: number, secret: string, hashedBackupCodes: string[]): void {
    this.db
      .prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_backup_codes = ? WHERE id = ?')
      .run(secret, JSON.stringify(hashedBackupCodes), id);
  }

  disableTotp(id: number): void {
    this.db
      .prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL WHERE id = ?')
      .run(id);
  }

  replaceTotpBackupCodes(id: number, hashedBackupCodes: string[]): void {
    this.db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?').run(JSON.stringify(hashedBackupCodes), id);
  }
}

export const userRepository = new UserRepository(db);

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    // Transient CSRF/replay protection for the OIDC authorization-code flow
    oidc?: { state: string; nonce: string; codeVerifier: string };
    // Set once a password has verified for an account with TOTP enabled, in place of `userId`
    pendingTotpUserId?: number;
    // A secret generated by /auth/totp/setup
    pendingTotpSecret?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Session secret: from env, otherwise generated once and persisted in data/.
function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const SqliteStore = SqliteStoreFactory(session);

export const sessionMiddleware = session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 15 * 60 * 1000 },
  }),
  secret: sessionSecret(),
  name: 'challoupe.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: SESSION_TTL_DAYS * 24 * 3600 * 1000,
  },
});

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = req.session.userId ? userRepository.getById(req.session.userId) : undefined;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    auditLog.record({
      userId: req.user?.id ?? null,
      username: req.user?.username ?? 'unknown',
      action: 'permission.denied',
      target: `${req.method} ${req.originalUrl}`,
      detail: 'Admin access required',
      status: 'failure',
      ip: req.ip,
    });
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// An admin always has every permission; a "user" account needs it explicitly granted.
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role !== 'admin' && !req.user?.permissions[permission]) {
      auditLog.record({
        userId: req.user?.id ?? null,
        username: req.user?.username ?? 'unknown',
        action: 'permission.denied',
        target: `${req.method} ${req.originalUrl}`,
        detail: `Missing permission: ${permission}`,
        status: 'failure',
        ip: req.ip,
      });
      res.status(403).json({ error: "You don't have permission to perform this action." });
      return;
    }
    next();
  };
}

export function hasPermission(user: User | undefined, permission: Permission): boolean {
  return user?.role === 'admin' || !!user?.permissions[permission];
}
