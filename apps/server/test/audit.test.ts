import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { settingsService } from '../src/settings.js';
import { auditLog } from '../src/audit.js';

beforeEach(() => {
  db.exec('DELETE FROM settings');
  db.exec('DELETE FROM audit_log');
});

describe('recordAudit', () => {
  it('inserts an entry that listAuditLog then returns, newest first', () => {
    auditLog.record({ userId: 1, username: 'admin', action: 'container.create', target: 'my-app', status: 'success' });
    auditLog.record({ userId: 1, username: 'admin', action: 'container.delete', target: 'my-app', status: 'success' });

    const entries = auditLog.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('container.delete');
    expect(entries[1].action).toBe('container.create');
  });

  it('stores optional fields as null when omitted', () => {
    auditLog.record({ userId: null, username: 'viewer', action: 'auth.login', status: 'failure' });

    const [entry] = auditLog.list();
    expect(entry.user_id).toBeNull();
    expect(entry.target).toBeNull();
    expect(entry.detail).toBeNull();
    expect(entry.ip).toBeNull();
    expect(entry.status).toBe('failure');
  });

  it('does nothing when the auditLog feature flag is disabled', () => {
    settingsService.update({ featureFlags: { auditLog: false } });
    auditLog.record({ userId: 1, username: 'admin', action: 'container.create', status: 'success' });

    expect(auditLog.list()).toHaveLength(0);
  });

  it('respects the limit passed to listAuditLog', () => {
    for (let i = 0; i < 5; i++) {
      auditLog.record({ userId: 1, username: 'admin', action: `action.${i}`, status: 'success' });
    }
    expect(auditLog.list(2)).toHaveLength(2);
  });
});
