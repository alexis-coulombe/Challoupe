import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { db } from './db.js';

interface SystemStatsTokenRow {
  id: number;
  token_hash: string;
  created_at: string;
}

export interface SystemStatsTokenStatus {
  configured: boolean;
  createdAt?: string;
}

/**
 * A single global token gating the unauthenticated GET /api/system-stats/:token endpoint,
 * for scripts/monitoring tools to poll without a session. Same shape as StackWebhookRepository,
 * minus the per-name key since there's only ever one of these for the whole instance.
 */
export class SystemStatsTokenRepository {
  constructor(private readonly db: Database.Database) {}

  status(): SystemStatsTokenStatus {
    const row = this.db.prepare('SELECT * FROM system_stats_token WHERE id = 1').get() as
      | SystemStatsTokenRow
      | undefined;
    return row ? { configured: true, createdAt: row.created_at } : { configured: false };
  }

  // Generates a fresh token, replacing any existing one.
  regenerate(): string {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = bcrypt.hashSync(token, 10);
    this.db
      .prepare(
        `INSERT INTO system_stats_token (id, token_hash) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, created_at = datetime('now')`
      )
      .run(tokenHash);
    return token;
  }

  revoke(): void {
    this.db.prepare('DELETE FROM system_stats_token WHERE id = 1').run();
  }

  verify(token: string): boolean {
    const row = this.db.prepare('SELECT * FROM system_stats_token WHERE id = 1').get() as
      | SystemStatsTokenRow
      | undefined;
    if (!row) return false;
    return bcrypt.compareSync(token, row.token_hash);
  }
}

export const systemStatsTokenRepository = new SystemStatsTokenRepository(db);
