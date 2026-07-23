import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mockContainer = {
  id: 'container-123',
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  inspect: vi.fn().mockResolvedValue({ Config: { Tty: false } }),
  logs: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  remove: vi.fn().mockResolvedValue(undefined),
};

const mockDocker = {
  listContainers: vi.fn(),
  createContainer: vi.fn().mockResolvedValue(mockContainer),
  getContainer: vi.fn(() => mockContainer),
};

vi.mock('../../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/docker.js')>();
  return { ...actual, docker: mockDocker, pullImage: vi.fn() };
});

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { createAdminAgent, createUserAgent } = await import('../helpers.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  vi.clearAllMocks();
  mockDocker.createContainer.mockResolvedValue(mockContainer);
  mockDocker.getContainer.mockReturnValue(mockContainer);
});

describe('GET /api/containers', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/containers');
    expect(res.status).toBe(401);
  });

  it('maps the Docker listing into the API shape', async () => {
    mockDocker.listContainers.mockResolvedValue([
      {
        Id: 'abc',
        Names: ['/my-app'],
        Image: 'nginx:alpine',
        State: 'running',
        Status: 'Up 2 minutes',
        Created: 1700000000,
        Ports: [],
        Labels: { 'com.docker.compose.project': 'my-stack' },
      },
    ]);
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/containers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'abc',
        name: 'my-app',
        image: 'nginx:alpine',
        state: 'running',
        status: 'Up 2 minutes',
        created: 1700000000,
        ports: [],
        composeProject: 'my-stack',
        updateAvailable: null,
      },
    ]);
  });
});

describe('POST /api/containers', () => {
  it('rejects a request without an image', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/containers').send({});
    expect(res.status).toBe(400);
  });

  it('creates and starts a container on the happy path', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/containers').send({ image: 'alpine:latest' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'container-123' });
    expect(mockDocker.createContainer).toHaveBeenCalledOnce();
    expect(mockContainer.start).toHaveBeenCalledOnce();
  });

  it('rejects auto-remove combined with a non-default restart policy', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .post('/api/containers')
      .send({ image: 'alpine:latest', autoRemove: true, restartPolicy: 'always' });
    expect(res.status).toBe(400);
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
  });

  it('allows auto-remove when the restart policy is left at "no"', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .post('/api/containers')
      .send({ image: 'alpine:latest', autoRemove: true, restartPolicy: 'no' });
    expect(res.status).toBe(201);
  });

  it('falls back to the configured default restart policy when omitted', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ defaultRestartPolicy: 'unless-stopped' });
    await agent.post('/api/containers').send({ image: 'alpine:latest' });
    const options = mockDocker.createContainer.mock.calls[0][0];
    expect(options.HostConfig.RestartPolicy.Name).toBe('unless-stopped');
  });

  it('rejects a non-admin user — creation can grant privileged mode and host bind-mounts', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/containers').send({ image: 'alpine:latest' });
    expect(res.status).toBe(403);
    expect(mockDocker.createContainer).not.toHaveBeenCalled();
  });

  it('allows a non-admin with the manageContainers permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageContainers: true,
    });
    const res = await agent.post('/api/containers').send({ image: 'alpine:latest' });
    expect(res.status).toBe(201);
    expect(mockDocker.createContainer).toHaveBeenCalledOnce();
  });

  it('builds host config from the advanced settings fields', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/containers').send({
      image: 'alpine:latest',
      command: ['sleep', '300'],
      workingDir: '/app',
      labels: ['team=infra'],
      memoryMb: 128,
      cpus: 0.5,
    });
    const options = mockDocker.createContainer.mock.calls[0][0];
    expect(options.Cmd).toEqual(['sleep', '300']);
    expect(options.WorkingDir).toBe('/app');
    expect(options.Labels).toEqual({ team: 'infra' });
    expect(options.HostConfig.Memory).toBe(128 * 1024 * 1024);
    expect(options.HostConfig.NanoCpus).toBe(500_000_000);
  });

  describe('resource quotas for non-admin users', () => {
    it('is never capped for an admin, even with a quota configured', async () => {
      const { agent } = await createAdminAgent(app);
      await agent.put('/api/settings').send({ maxContainerMemoryMb: 256, maxContainerCpus: 1 });
      await agent.post('/api/containers').send({ image: 'alpine:latest', memoryMb: 4096, cpus: 8 });
      const options = mockDocker.createContainer.mock.calls[0][0];
      expect(options.HostConfig.Memory).toBe(4096 * 1024 * 1024);
      expect(options.HostConfig.NanoCpus).toBe(8_000_000_000);
    });

    it('rejects a non-admin request that exceeds the configured quota', async () => {
      const { agent: adminAgent } = await createAdminAgent(app);
      await adminAgent.put('/api/settings').send({ maxContainerMemoryMb: 256 });
      const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
        manageContainers: true,
      });
      const res = await agent.post('/api/containers').send({ image: 'alpine:latest', memoryMb: 512 });
      expect(res.status).toBe(400);
      expect(mockDocker.createContainer).not.toHaveBeenCalled();
    });

    it('clamps a non-admin request that omits memory/cpu to the configured quota', async () => {
      const { agent: adminAgent } = await createAdminAgent(app);
      await adminAgent.put('/api/settings').send({ maxContainerMemoryMb: 256, maxContainerCpus: 1 });
      const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
        manageContainers: true,
      });
      const res = await agent.post('/api/containers').send({ image: 'alpine:latest' });
      expect(res.status).toBe(201);
      const options = mockDocker.createContainer.mock.calls[0][0];
      expect(options.HostConfig.Memory).toBe(256 * 1024 * 1024);
      expect(options.HostConfig.NanoCpus).toBe(1_000_000_000);
    });

    it('allows a non-admin request at or under the quota', async () => {
      const { agent: adminAgent } = await createAdminAgent(app);
      await adminAgent.put('/api/settings').send({ maxContainerMemoryMb: 256 });
      const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
        manageContainers: true,
      });
      const res = await agent.post('/api/containers').send({ image: 'alpine:latest', memoryMb: 128 });
      expect(res.status).toBe(201);
      const options = mockDocker.createContainer.mock.calls[0][0];
      expect(options.HostConfig.Memory).toBe(128 * 1024 * 1024);
    });
  });
});

describe('POST /api/containers/:id/actions/:action', () => {
  it('rejects an unknown action', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/containers/container-123/actions/nuke');
    expect(res.status).toBe(400);
  });

  it('calls the matching Docker method for a known action', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/containers/container-123/actions/stop');
    expect(res.status).toBe(200);
    expect(mockContainer.stop).toHaveBeenCalledOnce();
  });

  it('allows a non-admin user — start/stop/restart are non-destructive', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/containers/container-123/actions/stop');
    expect(res.status).toBe(200);
    expect(mockContainer.stop).toHaveBeenCalledOnce();
  });
});

describe('DELETE /api/containers/:id', () => {
  it('rejects a non-admin user', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.delete('/api/containers/container-123');
    expect(res.status).toBe(403);
    expect(mockContainer.remove).not.toHaveBeenCalled();
  });

  it('allows an admin', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.delete('/api/containers/container-123');
    expect(res.status).toBe(200);
    expect(mockContainer.remove).toHaveBeenCalledOnce();
  });

  it('allows a non-admin with the manageContainers permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageContainers: true,
    });
    const res = await agent.delete('/api/containers/container-123');
    expect(res.status).toBe(200);
    expect(mockContainer.remove).toHaveBeenCalledOnce();
  });
});

describe('GET /api/containers/:id/logs', () => {
  it('demultiplexes the raw Docker log stream', async () => {
    const body = Buffer.from('hello from container\n', 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length, 4);
    mockContainer.logs.mockResolvedValue(Buffer.concat([header, body]));

    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/containers/container-123/logs');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello from container\n');
  });
});
