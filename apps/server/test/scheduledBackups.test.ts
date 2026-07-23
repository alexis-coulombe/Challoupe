import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotifyBackupFailure = vi.fn();
vi.mock('../src/notifications.js', () => ({
  notificationService: { notifyBackupFailure: mockNotifyBackupFailure },
}));

// Defaults to the real build() below (existing tests want a real file); a test can swap in
// mockRejectedValueOnce to simulate a single failed scheduled run without affecting the rest.
const mockBuild = vi.fn();
vi.mock('../src/backup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/backup.js')>();
  mockBuild.mockImplementation(() => actual.backupService.build());
  return { ...actual, backupService: { ...actual.backupService, build: mockBuild } };
});

const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');
const { SCHEDULED_BACKUP_FILENAME_RE, scheduledBackupService } = await import('../src/scheduledBackups.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
});

describe('SCHEDULED_BACKUP_FILENAME_RE', () => {
  it('matches a real generated filename', async () => {
    const filename = await scheduledBackupService.run();
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
    const filename = await scheduledBackupService.run();
    const files = scheduledBackupService.list();
    expect(files.map((f) => f.filename)).toContain(filename);
    expect(files.find((f) => f.filename === filename)?.size).toBeGreaterThan(0);
  });
});

describe('restartScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a notification when a scheduled run fails', async () => {
    settingsService.update({ scheduledBackup: { enabled: true, intervalHours: 1 } });
    mockBuild.mockRejectedValueOnce(new Error('disk full'));
    scheduledBackupService.restartScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockNotifyBackupFailure).toHaveBeenCalledWith('disk full');
  });

  it('does not notify when the scheduled run succeeds', async () => {
    settingsService.update({ scheduledBackup: { enabled: true, intervalHours: 1 } });
    scheduledBackupService.restartScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockNotifyBackupFailure).not.toHaveBeenCalled();
  });
});
