import type Database from 'better-sqlite3';
import { db } from './db.js';
import { STACK_NAME_RE, stackService, type StackService } from './stacks.js';

export interface BackupStack {
  name: string;
  compose: string;
}

export interface BackupFile {
  version: 1;
  exportedAt: string;
  settings: Array<{ key: string; value: string }>;
  users: Array<Record<string, unknown>>;
  stacks: BackupStack[];
}

/**
 * Builds a full export of settings/users/stacks, and restores one back into the database
 * and filesystem.
 */
export class BackupService {
  constructor(
    private readonly db: Database.Database,
    private readonly stacks: StackService
  ) {}

  /**
   * Create BackupFile object from current settings
   * @returns BackupFile
   */
  async build(): Promise<BackupFile> {
    const settings = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const users = this.db.prepare('SELECT * FROM users').all() as Array<Record<string, unknown>>;
    const stackNames = await this.stacks.listNames();
    const stacks = await Promise.all(
      stackNames.map(async (name) => ({ name, compose: await this.stacks.read(name) }))
    );
    return { version: 1, exportedAt: new Date().toISOString(), settings, users, stacks };
  }

  /**
   * Restore settings from BackupFile object
   * @param data BackupFile
   */
  async restore(data: BackupFile): Promise<void> {
    const userColumns = (this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>)
      .map((c) => c.name)
      .filter((c) => c !== 'id'); // let SQLite reassign fresh ids rather than fighting AUTOINCREMENT's sequence table

    const applyDb = this.db.transaction(() => {
      this.db.exec('DELETE FROM settings');
      const insertSetting = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const row of data.settings) insertSetting.run(row.key, row.value);

      this.db.exec('DELETE FROM users');
      const insertUser = this.db.prepare(
        `INSERT INTO users (${userColumns.join(', ')}) VALUES (${userColumns.map(() => '?').join(', ')})`
      );
      for (const user of data.users) {
        insertUser.run(...userColumns.map((c) => user[c] ?? null));
      }
    });
    applyDb();

    for (const stack of data.stacks) {
      if (!STACK_NAME_RE.test(stack.name)) continue;
      await this.stacks.write(stack.name, stack.compose);
    }
  }
}

export const backupService = new BackupService(db, stackService);
