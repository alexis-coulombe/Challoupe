import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { setSettings } from './settings.js';
import { listAuditLog, recordAudit } from './audit.js';

beforeEach(() => {
  db.exec('DELETE FROM settings');
  db.exec('DELETE FROM audit_log');
});

describe('recordAudit', () => {
  it('inserts an entry that listAuditLog then returns, newest first', () => {
    recordAudit({ userId: 1, username: 'admin', action: 'container.create', target: 'my-app', status: 'success' });
    recordAudit({ userId: 1, username: 'admin', action: 'container.delete', target: 'my-app', status: 'success' });

    const entries = listAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('container.delete');
    expect(entries[1].action).toBe('container.create');
  });

  it('stores optional fields as null when omitted', () => {
    recordAudit({ userId: null, username: 'viewer', action: 'auth.login', status: 'failure' });

    const [entry] = listAuditLog();
    expect(entry.user_id).toBeNull();
    expect(entry.target).toBeNull();
    expect(entry.detail).toBeNull();
    expect(entry.ip).toBeNull();
    expect(entry.status).toBe('failure');
  });

  it('does nothing when the auditLog feature flag is disabled', () => {
    setSettings({ featureFlags: { auditLog: false } });
    recordAudit({ userId: 1, username: 'admin', action: 'container.create', status: 'success' });

    expect(listAuditLog()).toHaveLength(0);
  });

  it('respects the limit passed to listAuditLog', () => {
    for (let i = 0; i < 5; i++) {
      recordAudit({ userId: 1, username: 'admin', action: `action.${i}`, status: 'success' });
    }
    expect(listAuditLog(2)).toHaveLength(2);
  });
});
