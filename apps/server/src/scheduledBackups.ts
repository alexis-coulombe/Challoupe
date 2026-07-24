import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR } from './config.js';
import { backupService, type BackupService } from './backup.js';
import { notificationService } from './integrations/notifications/notifications.js';
import { settingsService } from './settings.js';

export const SCHEDULED_BACKUP_FILENAME_RE = /^challoupe-backup-[0-9TZ-]+\.json$/;

export interface ScheduledBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

/**
 * Writes full backups to disk on an interval and prunes the oldest ones, replacing what
 * used to be a module-level scheduler timer variable.
 */
export class ScheduledBackupService {
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly backups: BackupService) {}

  private listBackupFiles(): string[] {
    try {
      return readdirSync(BACKUPS_DIR)
        .filter((f) => SCHEDULED_BACKUP_FILENAME_RE.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  list(): ScheduledBackupFile[] {
    return this.listBackupFiles()
      .map((filename) => {
        const stat = statSync(path.join(BACKUPS_DIR, filename));
        return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private pruneOldBackups(keepCount: number): void {
    const files = this.listBackupFiles();
    const excess = files.length - Math.max(1, keepCount);
    for (const file of files.slice(0, Math.max(0, excess))) {
      rmSync(path.join(BACKUPS_DIR, file), { force: true });
    }
  }

  async run(): Promise<string> {
    mkdirSync(BACKUPS_DIR, { recursive: true });
    const backup = await this.backups.build();
    const filename = `challoupe-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
    // Contains password hashes and any configured secret, so it's written owner-only.
    writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(backup, null, 2), { mode: 0o600 });
    this.pruneOldBackups(settingsService.get().scheduledBackup.keepCount);
    return filename;
  }

  /**
   * Re-reads settings and (re)starts the background interval accordingly
   */
  restartScheduler(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;

    const { scheduledBackup } = settingsService.get();
    if (!scheduledBackup.enabled) return;

    const intervalMs = Math.max(1, scheduledBackup.intervalHours) * 60 * 60 * 1000;
    this.schedulerTimer = setInterval(() => {
      this.run().catch((err: Error) => {
        console.error('Scheduled backup failed', err);
        void notificationService.notifyBackupFailure(err.message);
      });
    }, intervalMs);
    this.schedulerTimer.unref?.();
  }
}

export const scheduledBackupService = new ScheduledBackupService(backupService);
