import type Database from 'better-sqlite3';
import { db } from './db.js';
import { settingsService, type SettingsService } from './settings.js';

export interface AuditEntry {
  userId: number | null;
  username: string;
  action: string;
  target?: string;
  detail?: string;
  status: 'success' | 'failure';
  ip?: string;
}

export interface AuditLogRow {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string;
  action: string;
  target: string | null;
  detail: string | null;
  status: 'success' | 'failure';
  ip: string | null;
}

/**
 * Records and reads the `audit_log` table, gated by the `featureFlags.auditLog` setting.
 */
export class AuditLogRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly settings: SettingsService
  ) {}

  /**
   * Add log entry
   * @param entry AuditEntry
   * @returns void
   */
  record(entry: AuditEntry): void {
    if (!this.settings.get().featureFlags.auditLog) {
      return;
    }

    try {
      this.db
        .prepare(
          `INSERT INTO audit_log (user_id, username, action, target, detail, status, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.userId,
          entry.username,
          entry.action,
          entry.target ?? null,
          entry.detail ?? null,
          entry.status,
          entry.ip ?? null
        );
    } catch (err) {
      console.error('Failed to record audit log entry:', err);
    }
  }

  /**
   * Get logs from db
   * @param limit number
   * @returns
   */
  list(limit = 300): AuditLogRow[] {
    const capped = Math.min(Math.max(limit, 1), 1000);
    return this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(capped) as AuditLogRow[];
  }
}

export const auditLog = new AuditLogRepository(db, settingsService);
