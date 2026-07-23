import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNetwork = { remove: vi.fn().mockResolvedValue(undefined) };
const mockDocker = {
  listNetworks: vi.fn().mockResolvedValue([]),
  createNetwork: vi.fn().mockResolvedValue({ id: 'net-123' }),
  getNetwork: vi.fn(() => mockNetwork),
};

vi.mock('../../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { createAdminAgent, createUserAgent } = await import('../helpers.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  vi.clearAllMocks();
});

describe('GET /api/networks', () => {
  it('is readable by a non-admin user', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.get('/api/networks');
    expect(res.status).toBe(200);
  });
});

describe('admin-only network mutations', () => {
  it('rejects a non-admin creating a network', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/networks').send({ name: 'my-network' });
    expect(res.status).toBe(403);
    expect(mockDocker.createNetwork).not.toHaveBeenCalled();
  });

  it('rejects a non-admin deleting a network', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.delete('/api/networks/net-123');
    expect(res.status).toBe(403);
    expect(mockNetwork.remove).not.toHaveBeenCalled();
  });

  it('allows an admin to create and delete', async () => {
    const { agent } = await createAdminAgent(app);
    expect((await agent.post('/api/networks').send({ name: 'my-network' })).status).toBe(201);
    expect((await agent.delete('/api/networks/net-123')).status).toBe(200);
  });

  it('allows a non-admin with the manageNetworks permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageNetworks: true,
    });
    expect((await agent.post('/api/networks').send({ name: 'my-network' })).status).toBe(201);
    expect((await agent.delete('/api/networks/net-123')).status).toBe(200);
  });
});
