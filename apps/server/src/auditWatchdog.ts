import { auditLog, type AuditLogRow } from './audit.js';
import { settingsService } from './settings.js';
import { notificationService } from './integrations/notifications/notifications.js';

export interface AuditAnomaly {
  signature: string;
  message: string;
}

const LOOKBACK_MS = 30 * 60 * 1000;
const FAILED_LOGIN_THRESHOLD = 5;
const PERMISSION_DENIED_THRESHOLD = 10;

// SQLite's datetime('now') stores "YYYY-MM-DD HH:MM:SS" in UTC with no timezone marker.
function toEpochMs(createdAt: string): number {
  return new Date(`${createdAt.replace(' ', 'T')}Z`).getTime();
}

/**
 * Plain rule-based checks over recent audit log activity, no LLM involved since this is
 * already structured data: repeated failed logins or permission denials for the same user
 * in a short window.
 */
export function detectAuditAnomalies(rows: AuditLogRow[], now = Date.now()): AuditAnomaly[] {
  const recent = rows.filter((r) => now - toEpochMs(r.created_at) <= LOOKBACK_MS);

  const failedLogins = new Map<string, number>();
  const permissionDenials = new Map<string, number>();
  for (const row of recent) {
    if (row.action === 'auth.login' && row.status === 'failure') {
      failedLogins.set(row.username, (failedLogins.get(row.username) ?? 0) + 1);
    }
    if (row.action === 'permission.denied') {
      permissionDenials.set(row.username, (permissionDenials.get(row.username) ?? 0) + 1);
    }
  }

  const findings: AuditAnomaly[] = [];
  for (const [username, count] of failedLogins) {
    if (count >= FAILED_LOGIN_THRESHOLD) {
      findings.push({
        signature: `login-fail:${username}`,
        message: `${count} failed login attempts for "${username}" in the last 30 minutes`,
      });
    }
  }
  for (const [username, count] of permissionDenials) {
    if (count >= PERMISSION_DENIED_THRESHOLD) {
      findings.push({
        signature: `perm-denied:${username}`,
        message: `${count} permission-denied actions by "${username}" in the last 30 minutes`,
      });
    }
  }
  return findings;
}

// Once a given anomaly has been notified, it's suppressed for an hour even if the
// scheduler ticks again while it's still ongoing, so a sustained brute-force attempt
// sends one notification rather than one per tick.
const ANOMALY_NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

export class AuditWatchdogService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastNotifiedAt = new Map<string, number>();

  async checkNow(): Promise<void> {
    const { aiWatchdog } = settingsService.get();
    if (!aiWatchdog.enabled || !aiWatchdog.checkAuditLog) return;

    const now = Date.now();
    const fresh = detectAuditAnomalies(auditLog.list(500), now).filter((f) => {
      const last = this.lastNotifiedAt.get(f.signature);
      return last === undefined || now - last >= ANOMALY_NOTIFY_COOLDOWN_MS;
    });
    if (fresh.length === 0) return;

    for (const f of fresh) this.lastNotifiedAt.set(f.signature, now);
    await notificationService.notifyAuditAnomaly(fresh.map((f) => f.message).join('; '));
  }

  restartScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const { aiWatchdog } = settingsService.get();
    if (!aiWatchdog.enabled || !aiWatchdog.checkAuditLog) return;
    this.timer = setInterval(() => void this.checkNow(), aiWatchdog.auditCheckIntervalMinutes * 60_000);
    this.timer.unref?.();
  }
}

export const auditWatchdogService = new AuditWatchdogService();
