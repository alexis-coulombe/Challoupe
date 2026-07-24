import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('POST /api/notifications/test', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/notifications/test');
    expect(res.status).toBe(401);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    const res = await agent
      .post('/api/notifications/test')
      .send({ webhookUrl: 'https://hooks.example.com/x', format: 'generic' });
    expect(res.status).toBe(403);
  });

  it('posts to the given webhook and reports success', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await admin
      .post('/api/notifications/test')
      .send({ webhookUrl: 'https://hooks.example.com/x', format: 'generic' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://hooks.example.com/x', expect.objectContaining({ method: 'POST' }));
  });

  it('returns a 502 with a friendly message when the webhook is unreachable', async () => {
    const { agent: admin } = await createAdminAgent(app);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const res = await admin
      .post('/api/notifications/test')
      .send({ webhookUrl: 'https://hooks.example.com/x', format: 'generic' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Could not reach the webhook');
  });

  it('rejects an invalid webhook URL', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/notifications/test').send({ webhookUrl: 'not-a-url', format: 'generic' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/notifications/test-ntfy', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/notifications/test-ntfy');
    expect(res.status).toBe(401);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    const res = await agent
      .post('/api/notifications/test-ntfy')
      .send({ serverUrl: 'https://ntfy.sh', topic: 'challoupe', username: '', password: '' });
    expect(res.status).toBe(403);
  });

  it('posts to the given ntfy topic and reports success', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await admin
      .post('/api/notifications/test-ntfy')
      .send({ serverUrl: 'https://ntfy.sh', topic: 'challoupe', username: '', password: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://ntfy.sh/challoupe', expect.objectContaining({ method: 'POST' }));
  });

  it('returns a 502 with a friendly message when ntfy is unreachable', async () => {
    const { agent: admin } = await createAdminAgent(app);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch;

    const res = await admin
      .post('/api/notifications/test-ntfy')
      .send({ serverUrl: 'https://ntfy.sh', topic: 'challoupe', username: '', password: '' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Could not reach ntfy');
  });

  it('rejects an invalid server URL', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin
      .post('/api/notifications/test-ntfy')
      .send({ serverUrl: 'not-a-url', topic: 'challoupe', username: '', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects an empty topic', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin
      .post('/api/notifications/test-ntfy')
      .send({ serverUrl: 'https://ntfy.sh', topic: '', username: '', password: '' });
    expect(res.status).toBe(400);
  });
});
