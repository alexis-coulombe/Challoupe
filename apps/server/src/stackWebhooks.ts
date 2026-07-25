import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { db } from './db.js';

interface StackWebhookRow {
  stack_name: string;
  token_hash: string;
  created_at: string;
}

export interface StackWebhookStatus {
  configured: boolean;
  createdAt?: string;
}

export class StackWebhookRepository {
  constructor(private readonly db: Database.Database) {}

  status(name: string): StackWebhookStatus {
    const row = this.db.prepare('SELECT * FROM stack_webhooks WHERE stack_name = ?').get(name) as
      | StackWebhookRow
      | undefined;
    return row ? { configured: true, createdAt: row.created_at } : { configured: false };
  }

  // Generates a fresh token, replacing any existing one for this stack.
  regenerate(name: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = bcrypt.hashSync(token, 10);
    this.db
      .prepare(
        `INSERT INTO stack_webhooks (stack_name, token_hash) VALUES (?, ?)
         ON CONFLICT(stack_name) DO UPDATE SET token_hash = excluded.token_hash, created_at = datetime('now')`
      )
      .run(name, tokenHash);
    return token;
  }

  revoke(name: string): void {
    this.db.prepare('DELETE FROM stack_webhooks WHERE stack_name = ?').run(name);
  }

  verify(name: string, token: string): boolean {
    const row = this.db.prepare('SELECT * FROM stack_webhooks WHERE stack_name = ?').get(name) as
      | StackWebhookRow
      | undefined;
    if (!row) return false;
    return bcrypt.compareSync(token, row.token_hash);
  }
}

export const stackWebhookRepository = new StackWebhookRepository(db);
