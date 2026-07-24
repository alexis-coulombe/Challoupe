import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDocker = { listContainers: vi.fn().mockResolvedValue([]) };
vi.mock('../../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { createAdminAgent } = await import('../helpers.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM hosts');
  vi.clearAllMocks();
});

describe('requireHost middleware', () => {
  it('resolves the local sentinel without touching the hosts table', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/hosts/local/containers');
    expect(res.status).toBe(200);
    expect(mockDocker.listContainers).toHaveBeenCalledOnce();
  });

  it('returns 404 for a host id that does not exist', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/hosts/9999/containers');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-numeric, non-local host id', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/hosts/not-a-real-id/containers');
    expect(res.status).toBe(404);
  });

  it('still requires authentication before the host is even resolved', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/hosts/local/containers');
    expect(res.status).toBe(401);
  });
});
