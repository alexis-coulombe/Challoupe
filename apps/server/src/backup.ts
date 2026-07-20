import { db } from './db.js';
import { STACK_NAME_RE, listStackNames, readStack, writeStack } from './stacks.js';

export interface BackupStack {
  name: string;
  compose: string;
}

export interface BackupFile {
  version: 1;
  exportedAt: string;
  settings: Array<{ key: string; value: string }>;
  // Raw user rows (including password_hash and every permission column) rather than
  // the typed User shape, so a new column added later is backed up automatically
  // without this module needing to know its name.
  users: Array<Record<string, unknown>>;
  stacks: BackupStack[];
}

export async function buildBackup(): Promise<BackupFile> {
  const settings = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const users = db.prepare('SELECT * FROM users').all() as Array<Record<string, unknown>>;
  const stackNames = await listStackNames();
  const stacks = await Promise.all(
    stackNames.map(async (name) => ({ name, compose: await readStack(name) }))
  );
  return { version: 1, exportedAt: new Date().toISOString(), settings, users, stacks };
}

// Fully replaces the current users, settings, and stack definitions with the backup's —
// it does not touch the audit log (history should survive a restore) or any actual
// Docker resource (containers/images/volumes/networks are never part of a backup).
export async function restoreBackup(data: BackupFile): Promise<void> {
  const userColumns = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>)
    .map((c) => c.name)
    .filter((c) => c !== 'id'); // let SQLite reassign fresh ids rather than fighting AUTOINCREMENT's sequence table

  const applyDb = db.transaction(() => {
    db.exec('DELETE FROM settings');
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const row of data.settings) insertSetting.run(row.key, row.value);

    db.exec('DELETE FROM users');
    const insertUser = db.prepare(
      `INSERT INTO users (${userColumns.join(', ')}) VALUES (${userColumns.map(() => '?').join(', ')})`
    );
    for (const user of data.users) {
      insertUser.run(...userColumns.map((c) => user[c] ?? null));
    }
  });
  applyDb();

  for (const stack of data.stacks) {
    if (!STACK_NAME_RE.test(stack.name)) continue;
    await writeStack(stack.name, stack.compose);
  }
}
