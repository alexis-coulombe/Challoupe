import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogRow } from '../src/audit.js';

const mockNotifyAuditAnomaly = vi.fn();
vi.mock('../src/integrations/notifications/notifications.js', () => ({
  notificationService: { notifyAuditAnomaly: mockNotifyAuditAnomaly },
}));

const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');
const { auditLog } = await import('../src/audit.js');
const { detectAuditAnomalies, AuditWatchdogService } = await import('../src/auditWatchdog.js');

const NOW = Date.parse('2026-01-01T12:00:00Z');

function rowAt(minutesAgo: number, overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  const created_at = new Date(NOW - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  return {
    id: 1,
    created_at,
    user_id: 1,
    username: 'admin',
    action: 'auth.login',
    target: null,
    detail: null,
    status: 'failure',
    ip: null,
    ...overrides,
  };
}

describe('detectAuditAnomalies', () => {
  it('ignores failed logins below the threshold', () => {
    const rows = Array.from({ length: 4 }, () => rowAt(5));
    expect(detectAuditAnomalies(rows, NOW)).toEqual([]);
  });

  it('flags 5 or more failed logins for the same user within the last 30 minutes', () => {
    const rows = Array.from({ length: 5 }, () => rowAt(5));
    expect(detectAuditAnomalies(rows, NOW)).toEqual([
      { signature: 'login-fail:admin', message: '5 failed login attempts for "admin" in the last 30 minutes' },
    ]);
  });

  it('does not combine failed logins across different usernames', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => rowAt(5, { username: 'admin' })),
      ...Array.from({ length: 3 }, () => rowAt(5, { username: 'bob' })),
    ];
    expect(detectAuditAnomalies(rows, NOW)).toEqual([]);
  });

  it('ignores rows older than the 30-minute lookback window', () => {
    const rows = Array.from({ length: 5 }, () => rowAt(40));
    expect(detectAuditAnomalies(rows, NOW)).toEqual([]);
  });

  it('ignores successful logins', () => {
    const rows = Array.from({ length: 5 }, () => rowAt(5, { status: 'success' }));
    expect(detectAuditAnomalies(rows, NOW)).toEqual([]);
  });

  it('flags 10 or more permission denials for the same user within the last 30 minutes', () => {
    const rows = Array.from({ length: 10 }, () => rowAt(5, { action: 'permission.denied' }));
    expect(detectAuditAnomalies(rows, NOW)).toEqual([
      { signature: 'perm-denied:admin', message: '10 permission-denied actions by "admin" in the last 30 minutes' },
    ]);
  });

  it('can flag both kinds of anomaly at once', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => rowAt(5, { action: 'auth.login', status: 'failure' })),
      ...Array.from({ length: 10 }, () => rowAt(5, { action: 'permission.denied' })),
    ];
    expect(detectAuditAnomalies(rows, NOW)).toHaveLength(2);
  });
});

describe('AuditWatchdogService', () => {
  beforeEach(() => {
    db.exec('DELETE FROM settings');
    db.exec('DELETE FROM audit_log');
    vi.clearAllMocks();
  });

  it('does nothing when disabled (the default)', async () => {
    for (let i = 0; i < 6; i++) {
      auditLog.record({ userId: null, username: 'admin', action: 'auth.login', status: 'failure', ip: '1.2.3.4' });
    }
    const service = new AuditWatchdogService();
    await service.checkNow();
    expect(mockNotifyAuditAnomaly).not.toHaveBeenCalled();
  });

  it('notifies once when a real anomaly is found in the audit log', async () => {
    settingsService.update({ aiWatchdog: { enabled: true, checkAuditLog: true } });
    for (let i = 0; i < 6; i++) {
      auditLog.record({ userId: null, username: 'admin', action: 'auth.login', status: 'failure', ip: '1.2.3.4' });
    }
    const service = new AuditWatchdogService();
    await service.checkNow();
    expect(mockNotifyAuditAnomaly).toHaveBeenCalledOnce();
    expect(mockNotifyAuditAnomaly).toHaveBeenCalledWith(expect.stringContaining('failed login attempts for "admin"'));
  });

  it('does not re-notify for the same ongoing anomaly on a later check', async () => {
    settingsService.update({ aiWatchdog: { enabled: true, checkAuditLog: true } });
    for (let i = 0; i < 6; i++) {
      auditLog.record({ userId: null, username: 'admin', action: 'auth.login', status: 'failure', ip: '1.2.3.4' });
    }
    const service = new AuditWatchdogService();
    await service.checkNow();
    await service.checkNow();
    expect(mockNotifyAuditAnomaly).toHaveBeenCalledOnce();
  });

  it('does nothing when checkAuditLog is turned off even though the watchdog is enabled', async () => {
    settingsService.update({ aiWatchdog: { enabled: true, checkAuditLog: false } });
    for (let i = 0; i < 6; i++) {
      auditLog.record({ userId: null, username: 'admin', action: 'auth.login', status: 'failure', ip: '1.2.3.4' });
    }
    const service = new AuditWatchdogService();
    await service.checkNow();
    expect(mockNotifyAuditAnomaly).not.toHaveBeenCalled();
  });
});

describe('AuditWatchdogService.restartScheduler', () => {
  beforeEach(() => {
    db.exec('DELETE FROM settings');
    db.exec('DELETE FROM audit_log');
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule a background check when disabled (the default)', async () => {
    const service = new AuditWatchdogService();
    service.restartScheduler();
    await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000);
    expect(mockNotifyAuditAnomaly).not.toHaveBeenCalled();
  });

  it('runs a check on the configured interval once enabled', async () => {
    settingsService.update({
      aiWatchdog: { enabled: true, checkAuditLog: true, auditCheckIntervalMinutes: 10 },
    });
    for (let i = 0; i < 6; i++) {
      auditLog.record({ userId: null, username: 'admin', action: 'auth.login', status: 'failure', ip: '1.2.3.4' });
    }
    const service = new AuditWatchdogService();
    service.restartScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mockNotifyAuditAnomaly).toHaveBeenCalledOnce();
  });
});
