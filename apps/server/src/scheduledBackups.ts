// Periodically writes a full backup (settings/users/stacks — same shape as the manual
// GET /api/backup download) to data/backups/ and prunes older files past the configured
// retention count. Off by default; see settings.ts's `scheduledBackup` for the toggle.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR } from './config.js';
import { buildBackup } from './backup.js';
import { getSettings } from './settings.js';

// The exported timestamp (already filesystem-safe apart from colons) with `:`/`.` swapped
// for `-`, e.g. challoupe-backup-2026-07-18T21-45-03-000Z.json. ISO order means a plain
// string sort is also a chronological sort — no need to parse dates back out to order them.
export const SCHEDULED_BACKUP_FILENAME_RE = /^challoupe-backup-[0-9TZ-]+\.json$/;

export interface ScheduledBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

function listBackupFiles(): string[] {
  try {
    return readdirSync(BACKUPS_DIR)
      .filter((f) => SCHEDULED_BACKUP_FILENAME_RE.test(f))
      .sort();
  } catch {
    return [];
  }
}

export function listScheduledBackups(): ScheduledBackupFile[] {
  return listBackupFiles()
    .map((filename) => {
      const stat = statSync(path.join(BACKUPS_DIR, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneOldBackups(keepCount: number): void {
  const files = listBackupFiles();
  const excess = files.length - Math.max(1, keepCount);
  for (const file of files.slice(0, Math.max(0, excess))) {
    rmSync(path.join(BACKUPS_DIR, file), { force: true });
  }
}

export async function runScheduledBackup(): Promise<string> {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const backup = await buildBackup();
  const filename = `challoupe-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
  // Contains password hashes and any configured secret (e.g. the SSO client secret) —
  // same sensitivity as the manual download, so it's written owner-only.
  writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(backup, null, 2), { mode: 0o600 });
  pruneOldBackups(getSettings().scheduledBackup.keepCount);
  return filename;
}

let schedulerTimer: NodeJS.Timeout | null = null;

// Re-reads settings and (re)starts the background interval accordingly — called once at
// server startup and again after any settings update that touches `scheduledBackup`, the
// same pattern as imageUpdates.ts's restartImageUpdateScheduler().
export function restartScheduledBackupScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;

  const { scheduledBackup } = getSettings();
  if (!scheduledBackup.enabled) return;

  const intervalMs = Math.max(1, scheduledBackup.intervalHours) * 60 * 60 * 1000;
  schedulerTimer = setInterval(() => {
    runScheduledBackup().catch((err) => console.error('Scheduled backup failed', err));
  }, intervalMs);
  schedulerTimer.unref?.();
}
