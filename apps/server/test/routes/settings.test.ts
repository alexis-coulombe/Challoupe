import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

const DEFAULTS = {
  defaultRestartPolicy: 'no',
  refreshIntervalMs: 5000,
  defaultLogTail: 200,
  defaultTerminalShell: '/bin/sh',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  trivyImage: 'aquasec/trivy:latest',
  maxContainerMemoryMb: null,
  maxContainerCpus: null,
  featureFlags: { aiAssistant: true, vulnerabilityScanner: true, auditLog: true },
  oidc: {
    enabled: false,
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    buttonLabel: 'Single Sign-On',
    providerId: '',
  },
  imageUpdateCheck: { enabled: false, intervalHours: 24 },
  scheduledBackup: { enabled: false, intervalHours: 24, keepCount: 7 },
  terminalTheme: { background: '#0b0e14', foreground: '#c9d1d9', cursor: '#3b82f6' },
  notifications: {
    enabled: false,
    webhookUrl: '',
    format: 'generic',
    onContainerCrash: true,
    onImageUpdate: true,
    onBackupFailure: true,
  },
};

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
});

describe('GET /api/settings', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('is readable by any authenticated user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULTS);
  });
});

describe('PUT /api/settings', () => {
  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent
      .put('/api/settings')
      .send({ defaultRestartPolicy: 'always' });
    expect(res.status).toBe(403);
  });

  it('lets an admin update a single setting, leaving the others at their default', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ defaultRestartPolicy: 'unless-stopped' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'unless-stopped' });

    const after = await admin.get('/api/settings');
    expect(after.body).toEqual({ ...DEFAULTS, defaultRestartPolicy: 'unless-stopped' });
  });

  it('lets an admin update every setting at once', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({
      defaultRestartPolicy: 'always',
      refreshIntervalMs: 30_000,
      defaultLogTail: 1000,
      defaultTerminalShell: '/bin/bash',
      ollamaBaseUrl: 'http://192.168.1.50:11434',
      ollamaModel: 'llama3.1',
      trivyImage: 'aquasec/trivy:0.50.0',
      maxContainerMemoryMb: 512,
      maxContainerCpus: 1.5,
      featureFlags: { aiAssistant: false, vulnerabilityScanner: false, auditLog: true },
      oidc: {
        enabled: true,
        issuerUrl: 'https://accounts.example.com',
        clientId: 'challoupe',
        clientSecret: 'shh',
        buttonLabel: 'Sign in with Example',
        providerId: 'google',
      },
      imageUpdateCheck: { enabled: true, intervalHours: 6 },
      terminalTheme: { background: '#ffffff', foreground: '#111111', cursor: '#ff0000' },
      notifications: {
        enabled: true,
        webhookUrl: 'https://discord.com/api/webhooks/x/y',
        format: 'discord',
        onContainerCrash: true,
        onImageUpdate: false,
        onBackupFailure: true,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      defaultRestartPolicy: 'always',
      refreshIntervalMs: 30_000,
      defaultLogTail: 1000,
      defaultTerminalShell: '/bin/bash',
      ollamaBaseUrl: 'http://192.168.1.50:11434',
      ollamaModel: 'llama3.1',
      trivyImage: 'aquasec/trivy:0.50.0',
      maxContainerMemoryMb: 512,
      maxContainerCpus: 1.5,
      featureFlags: { aiAssistant: false, vulnerabilityScanner: false, auditLog: true },
      // The response never echoes the client secret back, even right after setting it.
      oidc: {
        enabled: true,
        issuerUrl: 'https://accounts.example.com',
        clientId: 'challoupe',
        clientSecret: '',
        buttonLabel: 'Sign in with Example',
        providerId: 'google',
      },
      imageUpdateCheck: { enabled: true, intervalHours: 6 },
      scheduledBackup: { enabled: false, intervalHours: 24, keepCount: 7 },
      terminalTheme: { background: '#ffffff', foreground: '#111111', cursor: '#ff0000' },
      // Same write-only treatment as the OIDC client secret above.
      notifications: {
        enabled: true,
        webhookUrl: '',
        format: 'discord',
        onContainerCrash: true,
        onImageUpdate: false,
        onBackupFailure: true,
      },
    });
  });

  it('clears a numeric quota by sending null, and leaves the client secret unchanged when sent blank', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await admin.put('/api/settings').send({
      maxContainerMemoryMb: 512,
      oidc: { clientSecret: 'first-secret', issuerUrl: 'https://accounts.example.com' },
    });

    const cleared = await admin.put('/api/settings').send({
      maxContainerMemoryMb: null,
      oidc: { clientSecret: '', buttonLabel: 'Updated label' },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.maxContainerMemoryMb).toBeNull();
    expect(cleared.body.oidc.buttonLabel).toBe('Updated label');
    expect(cleared.body.oidc.issuerUrl).toBe('https://accounts.example.com'); // untouched field survives
  });

  it('round-trips the SSO provider template id, a UI-only hint alongside the issuer URL', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin
      .put('/api/settings')
      .send({ oidc: { providerId: 'okta', issuerUrl: 'https://dev-1234.okta.com' } });
    expect(res.status).toBe(200);
    expect(res.body.oidc.providerId).toBe('okta');

    const after = await admin.get('/api/settings');
    expect(after.body.oidc.providerId).toBe('okta');
  });

  it('lets an admin toggle a feature flag on its own', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ featureFlags: { aiAssistant: false } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...DEFAULTS,
      featureFlags: { aiAssistant: false, vulnerabilityScanner: true, auditLog: true },
    });
  });

  it('lets an admin toggle the image update check settings on their own', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin
      .put('/api/settings')
      .send({ imageUpdateCheck: { enabled: true, intervalHours: 12 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULTS, imageUpdateCheck: { enabled: true, intervalHours: 12 } });
  });

  it('rejects an image update check interval outside the allowed range', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ imageUpdateCheck: { intervalHours: 0 } });
    expect(res.status).toBe(400);
  });

  it('lets an admin turn on scheduled backups with a custom retention count', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin
      .put('/api/settings')
      .send({ scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...DEFAULTS,
      scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 },
    });
  });

  it('rejects a scheduled backup retention count outside the allowed range', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ scheduledBackup: { keepCount: 0 } });
    expect(res.status).toBe(400);
  });

  it('lets an admin update the terminal theme independently of the other settings', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ terminalTheme: { background: '#112233' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...DEFAULTS,
      terminalTheme: { background: '#112233', foreground: '#c9d1d9', cursor: '#3b82f6' },
    });
  });

  it('rejects a terminal theme color that is not a hex string', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ terminalTheme: { background: 'blue' } });
    expect(res.status).toBe(400);
  });

  it('lets an admin turn on webhook notifications, never echoing the URL back', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({
      notifications: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/x/y', format: 'discord' },
    });
    expect(res.status).toBe(200);
    expect(res.body.notifications).toEqual({
      enabled: true,
      webhookUrl: '',
      format: 'discord',
      onContainerCrash: true,
      onImageUpdate: true,
      onBackupFailure: true,
    });
  });

  it('leaves the stored webhook URL unchanged when sent blank', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await admin
      .put('/api/settings')
      .send({ notifications: { webhookUrl: 'https://discord.com/api/webhooks/x/y' } });

    const res = await admin
      .put('/api/settings')
      .send({ notifications: { webhookUrl: '', onImageUpdate: false } });
    expect(res.status).toBe(200);
    expect(res.body.notifications.onImageUpdate).toBe(false);
    expect(res.body.notifications.webhookUrl).toBe(''); // never echoed back

    // Not readable back over the API by design, so check the stored value directly.
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'notifications.webhookUrl'").get() as {
      value: string;
    };
    expect(stored.value).toBe('https://discord.com/api/webhooks/x/y');
  });

  it('rejects an invalid webhook URL', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ notifications: { webhookUrl: 'not-a-url' } });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid Ollama base URL', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ ollamaBaseUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid restart policy value', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ defaultRestartPolicy: 'sometimes' });
    expect(res.status).toBe(400);
  });

  it('rejects a refresh interval below the 1 second floor', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({ refreshIntervalMs: 100 });
    expect(res.status).toBe(400);
  });

  it('rejects an empty update', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/settings').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/settings/reset', () => {
  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.post('/api/settings/reset');
    expect(res.status).toBe(403);
  });

  it('deletes every user and stack, resets settings, and keeps only the audit log', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await createUserAgent(app, admin, 'member');
    await admin.put('/api/settings').send({
      defaultRestartPolicy: 'always',
      oidc: { enabled: true, clientSecret: 'shh' },
    });
    await admin
      .post('/api/stacks')
      .send({ name: 'reset-me', compose: 'services:\n  web:\n    image: nginx:alpine\n', deploy: false });

    const res = await admin.post('/api/settings/reset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULTS);

    // The requester's own session no longer works, since their user row is gone.
    const after = await admin.get('/api/settings');
    expect(after.status).toBe(401);

    // Setup is possible again, and finds no stacks left behind.
    const { agent: newAdmin } = await createAdminAgent(app, 'admin2');
    const stacks = await newAdmin.get('/api/stacks');
    expect(stacks.body).toEqual([]);

    const auditRows = db
      .prepare("SELECT username FROM audit_log WHERE action = 'settings.factory_reset'")
      .all() as Array<{ username: string }>;
    expect(auditRows).toEqual([{ username: 'admin' }]);
  });
});
