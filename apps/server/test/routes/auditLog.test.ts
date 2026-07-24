import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM audit_log');
  db.exec('DELETE FROM settings');
});

describe('GET /api/audit-log', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/audit-log');
    expect(res.status).toBe(401);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    const res = await agent.get('/api/audit-log');
    expect(res.status).toBe(403);
  });

  it('records the account setup and lists it for an admin', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/audit-log');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ action: 'auth.setup', username: 'admin', status: 'success' });
  });

  it('records a permission-denied attempt from a non-admin', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    await agent.post('/api/hosts/local/containers').send({ image: 'alpine:latest' });

    const res = await admin.get('/api/audit-log');
    const denied = res.body.find((e: { action: string }) => e.action === 'permission.denied');
    expect(denied).toMatchObject({ username: 'viewer', status: 'failure' });
  });

  it('keeps returning history after the feature is disabled, but stops recording new entries', async () => {
    const { agent } = await createAdminAgent(app);
    const before = (await agent.get('/api/audit-log')).body.length;

    await agent.put('/api/settings').send({ featureFlags: { auditLog: false } });
    await agent.post('/api/users').send({ username: 'someone', password: 'password123' });

    const res = await agent.get('/api/audit-log');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(before);
    expect(res.body.some((e: { action: string }) => e.action === 'user.create')).toBe(false);
  });
});
