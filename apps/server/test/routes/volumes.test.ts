import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVolume = { remove: vi.fn().mockResolvedValue(undefined) };
const mockDocker = {
  listVolumes: vi.fn().mockResolvedValue({ Volumes: [] }),
  createVolume: vi.fn().mockResolvedValue({ Name: 'my-volume' }),
  getVolume: vi.fn(() => mockVolume),
  pruneVolumes: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
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

describe('GET /api/hosts/local/volumes', () => {
  it('is readable by a non-admin user', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.get('/api/hosts/local/volumes');
    expect(res.status).toBe(200);
  });
});

describe('admin-only volume mutations', () => {
  it('rejects a non-admin creating a volume', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/volumes').send({ name: 'my-volume' });
    expect(res.status).toBe(403);
    expect(mockDocker.createVolume).not.toHaveBeenCalled();
  });

  it('rejects a non-admin deleting a volume', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.delete('/api/hosts/local/volumes/my-volume');
    expect(res.status).toBe(403);
    expect(mockVolume.remove).not.toHaveBeenCalled();
  });

  it('rejects a non-admin pruning volumes', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/volumes/prune');
    expect(res.status).toBe(403);
    expect(mockDocker.pruneVolumes).not.toHaveBeenCalled();
  });

  it('allows an admin to create, delete, and prune', async () => {
    const { agent } = await createAdminAgent(app);
    expect((await agent.post('/api/hosts/local/volumes').send({ name: 'my-volume' })).status).toBe(201);
    expect((await agent.delete('/api/hosts/local/volumes/my-volume')).status).toBe(200);
    expect((await agent.post('/api/hosts/local/volumes/prune')).status).toBe(200);
  });

  it('allows a non-admin with the manageVolumes permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageVolumes: true,
    });
    expect((await agent.post('/api/hosts/local/volumes').send({ name: 'my-volume' })).status).toBe(201);
    expect((await agent.delete('/api/hosts/local/volumes/my-volume')).status).toBe(200);
    expect((await agent.post('/api/hosts/local/volumes/prune')).status).toBe(200);
  });
});
