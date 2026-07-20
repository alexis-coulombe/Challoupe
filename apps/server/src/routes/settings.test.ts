import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { db } from '../db.js';
import { createAdminAgent, createUserAgent } from '../test/helpers.js';

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
