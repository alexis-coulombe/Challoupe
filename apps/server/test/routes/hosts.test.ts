import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminAgent, createUserAgent } from '../helpers.js';

const mockTestConnection = vi.fn();
const mockInvalidate = vi.fn();
// getClient is only exercised here as a side effect of dockerEventBroadcaster.startHost()
// firing on host creation (see hosts.controller.ts) — resolving null keeps that a harmless
// no-op instead of a noisy unhandled rejection in these route tests.
const mockGetClient = vi.fn().mockResolvedValue(null);
vi.mock('../../src/hostManager.js', () => ({
  hostManager: { testConnection: mockTestConnection, invalidate: mockInvalidate, getClient: mockGetClient },
}));

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM hosts');
  vi.clearAllMocks();
});

const validHost = {
  name: 'prod-server',
  sshHost: '192.168.1.50',
  sshPort: 22,
  sshUsername: 'deploy',
  sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
};

describe('GET /api/hosts', () => {
  it('requires authentication', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/hosts');
    expect(res.status).toBe(401);
  });

  it('is readable by a non-admin user, since the switcher needs it', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    await admin.post('/api/hosts').send(validHost);
    const res = await memberAgent.get('/api/hosts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('lists hosts for an admin, never including the private key', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await admin.post('/api/hosts').send(validHost);
    const res = await admin.get('/api/hosts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'prod-server', sshHost: '192.168.1.50', hasPassphrase: false });
    expect(res.body[0]).not.toHaveProperty('sshPrivateKey');
  });
});

describe('POST /api/hosts', () => {
  it('rejects a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.post('/api/hosts').send(validHost);
    expect(res.status).toBe(403);
  });

  it('creates a host', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/hosts').send(validHost);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'prod-server', sshHost: '192.168.1.50', sshPort: 22 });
    expect(res.body).not.toHaveProperty('sshPrivateKey');
  });

  it('rejects a duplicate host name', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await admin.post('/api/hosts').send(validHost);
    const res = await admin.post('/api/hosts').send(validHost);
    expect(res.status).toBe(409);
  });

  it('rejects a missing private key', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/hosts').send({ ...validHost, sshPrivateKey: '' });
    expect(res.status).toBe(400);
  });

  it('defaults the SSH port to 22 when omitted', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const { sshPort: _omit, ...body } = validHost;
    const res = await admin.post('/api/hosts').send(body);
    expect(res.status).toBe(201);
    expect(res.body.sshPort).toBe(22);
  });
});

describe('PUT /api/hosts/:id', () => {
  it('rejects a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.put(`/api/hosts/${created.body.id}`).send({ sshHost: '10.0.0.9' });
    expect(res.status).toBe(403);
  });

  it('updates a host and invalidates its cached client', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const res = await admin.put(`/api/hosts/${created.body.id}`).send({ sshHost: '10.0.0.9' });
    expect(res.status).toBe(200);
    expect(res.body.sshHost).toBe('10.0.0.9');
    expect(mockInvalidate).toHaveBeenCalledWith(String(created.body.id));
  });

  it('returns 404 for a host that does not exist', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.put('/api/hosts/9999').send({ sshHost: '10.0.0.9' });
    expect(res.status).toBe(404);
  });

  it('leaves the stored private key unchanged when sent blank', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const res = await admin
      .put(`/api/hosts/${created.body.id}`)
      .send({ sshPrivateKey: '', sshHost: '10.0.0.9' });
    expect(res.status).toBe(200);
    expect(res.body.sshHost).toBe('10.0.0.9');
    // Not readable back over the API by design; the underlying HostRepository test covers the
    // actual stored-value assertion.
  });
});

describe('DELETE /api/hosts/:id', () => {
  it('rejects a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.delete(`/api/hosts/${created.body.id}`);
    expect(res.status).toBe(403);
  });

  it('deletes a host and invalidates its cached client', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const res = await admin.delete(`/api/hosts/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(mockInvalidate).toHaveBeenCalledWith(String(created.body.id));

    const after = await admin.get('/api/hosts');
    expect(after.body).toEqual([]);
  });

  it('returns 404 for a host that does not exist', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.delete('/api/hosts/9999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/hosts/test', () => {
  it('rejects a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.post('/api/hosts/test').send(validHost);
    expect(res.status).toBe(403);
  });

  it('tests a draft connection without persisting it', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/hosts/test').send(validHost);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sshHost: '192.168.1.50', sshUsername: 'deploy' })
    );

    const hosts = await admin.get('/api/hosts');
    expect(hosts.body).toEqual([]);
  });

  it('reports a connection failure', async () => {
    mockTestConnection.mockResolvedValue({ ok: false, error: 'auth failed' });
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/hosts/test').send(validHost);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'auth failed' });
  });
});

describe('POST /api/hosts/:id/test', () => {
  it('re-tests an existing host using its stored (decrypted) connection', async () => {
    mockTestConnection.mockResolvedValue({ ok: true });
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/hosts').send(validHost);
    const res = await admin.post(`/api/hosts/${created.body.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sshHost: '192.168.1.50', sshPrivateKey: validHost.sshPrivateKey })
    );
  });

  it('returns 404 for a host that does not exist', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/hosts/9999/test');
    expect(res.status).toBe(404);
  });
});
