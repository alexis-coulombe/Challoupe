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

beforeEach(() => {
  db.exec('DELETE FROM users');
  vi.clearAllMocks();
  mockDocker.version.mockResolvedValue({ Version: '29.0.0', ApiVersion: '1.51' });
});

function baseInfo(dockerRootDir: string) {
  return {
    Name: 'host',
    Containers: 5,
    ContainersRunning: 2,
    ContainersPaused: 0,
    ContainersStopped: 3,
    Images: 10,
    OperatingSystem: 'Linux',
    KernelVersion: '6.0.0',
    Architecture: 'x86_64',
    NCPU: 4,
    MemTotal: 8_000_000_000,
    DockerRootDir: dockerRootDir,
  };
}

describe('GET /api/system/info', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/system/info');
    expect(res.status).toBe(401);
  });

  it('returns real storage stats when the Docker root directory is readable', async () => {
    mockDocker.info.mockResolvedValue(baseInfo('/'));
    const { agent } = await createAdminAgent(app);

    const res = await agent.get('/api/system/info');
    expect(res.status).toBe(200);
    expect(res.body.storageTotal).toBeGreaterThan(0);
  });

  it('degrades to zeroed storage stats instead of failing the whole endpoint when the Docker root dir is not visible in this filesystem (e.g. Challoupe itself running containerized without that bind mount)', async () => {
    mockDocker.info.mockResolvedValue(baseInfo('/no/such/path/on/this/fs'));
    const { agent } = await createAdminAgent(app);

    const res = await agent.get('/api/system/info');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ storageTotal: 0, storageUsed: 0, storagePercent: 0 });
    // Every other stat still comes through untouched.
    expect(res.body.containers).toBe(5);
    expect(res.body.serverVersion).toBe('29.0.0');
  });
});
