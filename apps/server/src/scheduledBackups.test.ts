import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.js';
import {
  SCHEDULED_BACKUP_FILENAME_RE,
  listScheduledBackups,
  runScheduledBackup,
} from './scheduledBackups.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
});

describe('SCHEDULED_BACKUP_FILENAME_RE', () => {
  it('matches a real generated filename', async () => {
    const filename = await runScheduledBackup();
    expect(filename).toMatch(SCHEDULED_BACKUP_FILENAME_RE);
  });

  it('rejects anything that could escape the backups directory', () => {
    expect(SCHEDULED_BACKUP_FILENAME_RE.test('../../etc/passwd')).toBe(false);
    expect(SCHEDULED_BACKUP_FILENAME_RE.test('challoupe-backup-2026-01-01/../../etc.json')).toBe(false);
    expect(SCHEDULED_BACKUP_FILENAME_RE.test('not-a-backup.json')).toBe(false);
  });
});

describe('runScheduledBackup / listScheduledBackups', () => {
  it('writes a real file that shows up in the listing', async () => {
    const filename = await runScheduledBackup();
    const files = listScheduledBackups();
    expect(files.map((f) => f.filename)).toContain(filename);
    expect(files.find((f) => f.filename === filename)?.size).toBeGreaterThan(0);
  });
});
