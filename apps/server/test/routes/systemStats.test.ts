import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createAdminAgent } from '../helpers.js';

const mockDocker = {
  info: vi.fn(),
  version: vi.fn().mockResolvedValue({ Version: '29.0.0', ApiVersion: '1.51' }),
};

vi.mock('../../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { hostManager } = await import('../../src/hostManager.js');
const { hostRepository } = await import('../../src/hosts.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM system_stats_token');
  vi.clearAllMocks();
  mockDocker.version.mockResolvedValue({ Version: '29.0.0', ApiVersion: '1.51' });
});

function baseInfo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    Name: 'host',
    Containers: 5,
    ContainersRunning: 2,
    ContainersPaused: 0,
    ContainersStopped: 3,
    Images: 10,
    NCPU: 4,
    MemTotal: 8_000_000_000,
    DockerRootDir: '/',
    ...overrides,
  };
}

describe('System stats token management (/api/system-stats-token)', () => {
  it('requires admin', async () => {
    const res = await request(app).get('/api/system-stats-token');
    expect(res.status).toBe(401);
  });

  it('reports not configured, then configured after regenerating', async () => {
    const { agent } = await createAdminAgent(app);
    expect((await agent.get('/api/system-stats-token')).body).toEqual({ configured: false });

    const { body } = await agent.post('/api/system-stats-token');
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await agent.get('/api/system-stats-token')).body).toMatchObject({ configured: true });
  });

  it('revokes the token', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/system-stats-token');
    await agent.delete('/api/system-stats-token');
    expect((await agent.get('/api/system-stats-token')).body).toEqual({ configured: false });
  });
});

describe('GET /api/system-stats/:token', () => {
  it('requires no session but does require a valid token', async () => {
    mockDocker.info.mockResolvedValue(baseInfo());
    const { agent } = await createAdminAgent(app);
    const { body } = await agent.post('/api/system-stats-token');

    // A plain supertest request with no cookie at all — this must work without a session.
    const res = await request(app).get(`/api/system-stats/${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      host: 'local',
      serverVersion: '29.0.0',
      containersTotal: 5,
      containersRunning: 2,
      imagesTotal: 10,
      memoryTotal: 8_000_000_000,
    });
    expect(res.body.cpuPercent).toBeTypeOf('number');
    expect(res.body.storageTotal).toBeGreaterThan(0);
  });

  it('rejects a wrong token with 404', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/system-stats-token');
    const res = await request(app).get('/api/system-stats/not-the-real-token');
    expect(res.status).toBe(404);
  });

  it('rejects any token when none has ever been configured', async () => {
    const res = await request(app).get('/api/system-stats/anything');
    expect(res.status).toBe(404);
  });

  it('scopes to a remote host via ?host=, nulling the OS-level fields', async () => {
    mockDocker.info.mockResolvedValue(baseInfo());
    const { agent } = await createAdminAgent(app);
    const { body } = await agent.post('/api/system-stats-token');

    const host = hostRepository.create({
      name: 'remote-1',
      sshHost: '10.0.0.9',
      sshPort: 22,
      sshUsername: 'deploy',
      sshPrivateKey: 'key',
      createdBy: 1,
    });
    const remoteDocker = {
      info: vi.fn().mockResolvedValue(baseInfo({ Containers: 1, ContainersRunning: 1, Images: 2 })),
      version: vi.fn().mockResolvedValue({ Version: '27.1.0' }),
    };
    const getClientSpy = vi.spyOn(hostManager, 'getClient').mockImplementation(async (hostId: string) => {
      if (hostId === 'local') return mockDocker as never;
      if (hostId === String(host.id)) return remoteDocker as never;
      return null;
    });

    const res = await request(app).get(`/api/system-stats/${body.token}?host=${host.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      host: String(host.id),
      serverVersion: '27.1.0',
      containersTotal: 1,
      containersRunning: 1,
      imagesTotal: 2,
      cpuPercent: null,
      memoryUsed: null,
      memoryPercent: null,
      storageUsed: null,
      storageTotal: null,
      storagePercent: null,
    });

    getClientSpy.mockRestore();
    db.exec('DELETE FROM hosts');
  });

  it('returns 404 for an unknown host', async () => {
    const { agent } = await createAdminAgent(app);
    const { body } = await agent.post('/api/system-stats-token');
    const res = await request(app).get(`/api/system-stats/${body.token}?host=999`);
    expect(res.status).toBe(404);
  });
});
