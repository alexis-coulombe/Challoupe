import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mockImage = { inspect: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) };
const mockDocker = {
  listImages: vi.fn().mockResolvedValue([]),
  getImage: vi.fn(() => mockImage),
  pruneImages: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
};
const mockPullImage = vi.fn().mockResolvedValue(undefined);
const mockBuildImageFromGit = vi.fn();

vi.mock('../../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/docker.js')>();
  return {
    ...actual,
    docker: mockDocker,
    pullImage: mockPullImage,
    buildImageFromGit: mockBuildImageFromGit,
  };
});

const mockGetRemoteDigest = vi.fn();
vi.mock('../../src/integrations/registry/registry.js', () => ({ getRemoteDigest: mockGetRemoteDigest }));

const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db.js');
const { createAdminAgent, createUserAgent } = await import('../helpers.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  vi.clearAllMocks();
});

describe('GET /api/hosts/local/images', () => {
  it('is readable by a non-admin user', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.get('/api/hosts/local/images');
    expect(res.status).toBe(200);
  });
});

describe('admin-only image mutations', () => {
  it('rejects a non-admin pulling an image', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/images/pull').send({ reference: 'nginx:alpine' });
    expect(res.status).toBe(403);
    expect(mockPullImage).not.toHaveBeenCalled();
  });

  it('rejects a non-admin deleting an image', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.delete('/api/hosts/local/images?ref=nginx:alpine');
    expect(res.status).toBe(403);
    expect(mockImage.remove).not.toHaveBeenCalled();
  });

  it('rejects a non-admin pruning images', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/images/prune');
    expect(res.status).toBe(403);
    expect(mockDocker.pruneImages).not.toHaveBeenCalled();
  });

  it('allows an admin to pull, delete, and prune', async () => {
    const { agent } = await createAdminAgent(app);
    expect((await agent.post('/api/hosts/local/images/pull').send({ reference: 'nginx:alpine' })).status).toBe(200);
    expect((await agent.delete('/api/hosts/local/images?ref=nginx:alpine')).status).toBe(200);
    expect((await agent.post('/api/hosts/local/images/prune')).status).toBe(200);
  });

  it('allows a non-admin with the manageImages permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageImages: true,
    });
    expect((await agent.post('/api/hosts/local/images/pull').send({ reference: 'nginx:alpine' })).status).toBe(200);
    expect((await agent.delete('/api/hosts/local/images?ref=nginx:alpine')).status).toBe(200);
    expect((await agent.post('/api/hosts/local/images/prune')).status).toBe(200);
  });
});

describe('image update checks', () => {
  it('rejects a non-admin checking a single image for updates', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/images/some-id/check-update');
    expect(res.status).toBe(403);
  });

  it('rejects a non-admin checking every image for updates', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/hosts/local/images/check-updates');
    expect(res.status).toBe(403);
  });

  it('reports an available update for a single tagged image', async () => {
    mockImage.inspect.mockResolvedValue({
      RepoTags: ['nginx:alpine'],
      RepoDigests: ['nginx@sha256:old'],
    });
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/hosts/local/images/some-id/check-update');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reference: 'nginx:alpine', updateAvailable: true });
  });

  it('rejects checking an untagged image, nothing to compare against a registry', async () => {
    mockImage.inspect.mockResolvedValue({ RepoTags: ['<none>:<none>'], RepoDigests: [] });
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/hosts/local/images/some-id/check-update');
    expect(res.status).toBe(400);
    expect(mockGetRemoteDigest).not.toHaveBeenCalled();
  });

  it('checks every locally tagged image at once and summarizes the result', async () => {
    mockDocker.listImages.mockResolvedValue([
      { Id: 'i1', RepoTags: ['nginx:alpine'], RepoDigests: ['nginx@sha256:old'] },
    ]);
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/hosts/local/images/check-updates');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 1, updatesAvailable: 1, errors: [] });
  });

  it('reflects a cached update status on the images list afterward', async () => {
    mockDocker.listImages.mockResolvedValue([
      {
        Id: 'i1',
        RepoTags: ['nginx:alpine'],
        RepoDigests: ['nginx@sha256:old'],
        Size: 10,
        Created: 1,
        Containers: 0,
      },
    ]);
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/hosts/local/images/check-updates');
    const res = await agent.get('/api/hosts/local/images');
    expect(res.body[0].updateAvailable).toBe(true);
  });
});

describe('POST /api/hosts/local/images/build-from-git', () => {
  it('rejects a non-admin without the manageImages permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent
      .post('/api/hosts/local/images/build-from-git')
      .send({ repoUrl: 'https://github.com/user/repo.git', tag: 'myapp:latest' });
    expect(res.status).toBe(403);
    expect(mockBuildImageFromGit).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid repository URL', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/hosts/local/images/build-from-git').send({ tag: 'myapp:latest' });
    expect(res.status).toBe(400);

    const res2 = await agent
      .post('/api/hosts/local/images/build-from-git')
      .send({ repoUrl: 'not-a-url', tag: 'myapp:latest' });
    expect(res2.status).toBe(400);
  });

  it('rejects a ref or subdir starting with "-" (would be spliced into a positional git arg)', async () => {
    const { agent } = await createAdminAgent(app);
    const badRef = await agent.post('/api/hosts/local/images/build-from-git').send({
      repoUrl: 'https://github.com/user/repo.git',
      ref: '--upload-pack=evil',
      tag: 'myapp:latest',
    });
    expect(badRef.status).toBe(400);

    const badSubdir = await agent.post('/api/hosts/local/images/build-from-git').send({
      repoUrl: 'https://github.com/user/repo.git',
      subdir: '--evil',
      tag: 'myapp:latest',
    });
    expect(badSubdir.status).toBe(400);
    expect(mockBuildImageFromGit).not.toHaveBeenCalled();
  });

  it('builds successfully and records an audit entry with the ref, redacting no credentials when there are none', async () => {
    mockBuildImageFromGit.mockResolvedValue({ log: 'Successfully built abc123\n' });
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/hosts/local/images/build-from-git').send({
      repoUrl: 'https://github.com/user/repo.git',
      ref: 'main',
      tag: 'myapp:latest',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, tag: 'myapp:latest', log: 'Successfully built abc123\n' });
    expect(mockBuildImageFromGit).toHaveBeenCalledWith(
      expect.anything(),
      'https://github.com/user/repo.git',
      'myapp:latest',
      { ref: 'main', subdir: undefined, dockerfile: undefined, buildArgs: undefined }
    );

    const entry = db
      .prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1')
      .get('image.build') as { detail: string; status: string };
    expect(entry.status).toBe('success');
    expect(entry.detail).toBe('from https://github.com/user/repo.git#main');
  });

  it('parses build arguments and the subdirectory/dockerfile fields', async () => {
    mockBuildImageFromGit.mockResolvedValue({ log: 'built\n' });
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/hosts/local/images/build-from-git').send({
      repoUrl: 'https://github.com/user/repo.git',
      subdir: 'backend',
      dockerfile: 'docker/Dockerfile.prod',
      tag: 'myapp:latest',
      buildArgs: ['NODE_ENV=production', 'VERSION=1.2.3'],
    });
    expect(mockBuildImageFromGit).toHaveBeenCalledWith(
      expect.anything(),
      'https://github.com/user/repo.git',
      'myapp:latest',
      {
        ref: undefined,
        subdir: 'backend',
        dockerfile: 'docker/Dockerfile.prod',
        buildArgs: { NODE_ENV: 'production', VERSION: '1.2.3' },
      }
    );
  });

  it('returns ok:false with the build log on a failed build, and records a failure audit entry', async () => {
    mockBuildImageFromGit.mockResolvedValue({
      log: 'Step 1/2: FROM alpine\nStep 2/2: RUN false\n',
      error: 'The command \'/bin/sh -c false\' returned a non-zero code: 1',
    });
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .post('/api/hosts/local/images/build-from-git')
      .send({ repoUrl: 'https://github.com/user/repo.git', tag: 'myapp:latest' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/non-zero code/);
    expect(res.body.log).toContain('Step 2/2');

    const entry = db
      .prepare('SELECT status, detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1')
      .get('image.build') as { status: string; detail: string };
    expect(entry.status).toBe('failure');
    expect(entry.detail).toMatch(/non-zero code/);
  });

  it('redacts embedded credentials from the audit log', async () => {
    mockBuildImageFromGit.mockResolvedValue({ log: 'built\n' });
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/hosts/local/images/build-from-git').send({
      repoUrl: 'https://myuser:supersecrettoken@github.com/user/repo.git',
      tag: 'myapp:latest',
    });
    const entry = db
      .prepare('SELECT detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1')
      .get('image.build') as { detail: string };
    expect(entry.detail).not.toContain('supersecrettoken');
    expect(entry.detail).toContain('***@github.com');
  });
});
