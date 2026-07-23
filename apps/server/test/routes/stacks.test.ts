import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { docker } from '../../src/docker.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
});

const VALID_COMPOSE = 'services:\n  web:\n    image: nginx:alpine\n';

describe('stack name validation', () => {
  it('rejects an invalid stack name on any :name route', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/stacks/Not_Valid');
    expect(res.status).toBe(400);
  });
});

describe('operations on a stack that does not exist', () => {
  it.each([
    ['GET', '/api/stacks/never-created'],
    ['PUT', '/api/stacks/never-created'],
    ['POST', '/api/stacks/never-created/deploy'],
    ['POST', '/api/stacks/never-created/down'],
    ['DELETE', '/api/stacks/never-created'],
  ])('returns 404 for %s %s', async (method, path) => {
    const { agent } = await createAdminAgent(app);
    const res = await agent[method.toLowerCase() as 'get' | 'put' | 'post' | 'delete'](path).send({
      compose: VALID_COMPOSE,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/stacks', () => {
  it('creates a stack without deploying it by default', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .post('/api/stacks')
      .send({ name: 'my-stack', compose: VALID_COMPOSE, deploy: false });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'my-stack', deploy: null });
  });

  it('rejects a duplicate stack name', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'dup-stack', compose: VALID_COMPOSE });
    const res = await agent.post('/api/stacks').send({ name: 'dup-stack', compose: VALID_COMPOSE });
    expect(res.status).toBe(409);
  });

  it('rejects a compose body without a services key', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.post('/api/stacks').send({ name: 'bad-stack', compose: 'foo: bar' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-admin user — a compose file is as powerful as a privileged container', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer');
    const res = await agent.post('/api/stacks').send({ name: 'my-stack', compose: VALID_COMPOSE });
    expect(res.status).toBe(403);
  });

  it('allows a non-admin with the manageStacks permission', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageStacks: true,
    });
    const res = await agent.post('/api/stacks').send({ name: 'granted-stack', compose: VALID_COMPOSE });
    expect(res.status).toBe(201);
  });
});

describe('POST /api/stacks/:name/deploy and /down', () => {
  it('rejects a non-admin user without manageStacks — deploying an unstarted stack is equivalent to creating containers', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'deploy-guarded', compose: VALID_COMPOSE, deploy: false });
    const agent = await createUserAgent(app, adminAgent, 'viewer');

    const deploy = await agent.post('/api/stacks/deploy-guarded/deploy');
    expect(deploy.status).toBe(403);

    const down = await agent.post('/api/stacks/deploy-guarded/down');
    expect(down.status).toBe(403);
  });

  it('allows a non-admin with the manageStacks permission past the gate (reaches the real deploy/down, not blocked at 403)', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'deploy-granted', compose: VALID_COMPOSE, deploy: false });
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageStacks: true,
    });

    try {
      const deploy = await agent.post('/api/stacks/deploy-granted/deploy');
      expect(deploy.status).not.toBe(403);
    } finally {
      await agent.post('/api/stacks/deploy-granted/down'); // best-effort cleanup either way
    }
  });
});

describe('GET/PUT /api/stacks/:name', () => {
  it('reads back a created stack and lets it be updated', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'editable', compose: VALID_COMPOSE });

    const read = await agent.get('/api/stacks/editable');
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ name: 'editable', compose: VALID_COMPOSE });

    const updated = 'services:\n  web:\n    image: nginx:latest\n';
    const put = await agent.put('/api/stacks/editable').send({ compose: updated });
    expect(put.status).toBe(200);

    const readAgain = await agent.get('/api/stacks/editable');
    expect(readAgain.body.compose).toBe(updated);
  });

  it('lets a non-admin read a stack but not write to it', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'readable', compose: VALID_COMPOSE });
    const agent = await createUserAgent(app, adminAgent, 'viewer');

    const read = await agent.get('/api/stacks/readable');
    expect(read.status).toBe(200);

    const put = await agent.put('/api/stacks/readable').send({ compose: VALID_COMPOSE });
    expect(put.status).toBe(403);
  });

  it('lets a non-admin with the manageStacks permission write to it', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'grantable', compose: VALID_COMPOSE });
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageStacks: true,
    });

    const updated = 'services:\n  web:\n    image: nginx:latest\n';
    const put = await agent.put('/api/stacks/grantable').send({ compose: updated });
    expect(put.status).toBe(200);
  });
});

describe('DELETE /api/stacks/:name', () => {
  it('rejects a non-admin user', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'protected-stack', compose: VALID_COMPOSE });
    const agent = await createUserAgent(app, adminAgent, 'viewer');

    const res = await agent.delete('/api/stacks/protected-stack');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/stacks/:name/drift', () => {
  const TWO_SERVICE_COMPOSE =
    'services:\n  web:\n    image: nginx:alpine\n  cache:\n    image: redis:alpine\n';

  it('reports in sync immediately after a real deploy, then reports drift once a container is removed outside Challoupe', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'drift-check', compose: TWO_SERVICE_COMPOSE, deploy: false });

    try {
      await agent.post('/api/stacks/drift-check/deploy');

      const freshDrift = await agent.get('/api/stacks/drift-check/drift');
      expect(freshDrift.status).toBe(200);
      expect(freshDrift.body).toEqual({
        inSync: true,
        missingServices: [],
        orphanedContainers: [],
        imageMismatches: [],
      });

      const list = await agent.get('/api/stacks');
      expect(list.body.find((s: { name: string }) => s.name === 'drift-check')).toMatchObject({
        drifted: false,
      });

      // Simulate someone removing one container directly, outside Challoupe entirely —
      // the stack is still (partially) up, just no longer matching its compose file.
      // (Docker's label filter ORs multiple values together, so this must be a single
      // filter and then find the target container in code, not two label filters at once.)
      const containers = await docker.listContainers({
        filters: { label: ['com.docker.compose.project=drift-check'] },
      });
      const cacheContainer = containers.find((c) => c.Labels['com.docker.compose.service'] === 'cache')!;
      await docker.getContainer(cacheContainer.Id).remove({ force: true });

      const driftAfter = await agent.get('/api/stacks/drift-check/drift');
      expect(driftAfter.status).toBe(200);
      expect(driftAfter.body.inSync).toBe(false);
      expect(driftAfter.body.missingServices).toEqual(['cache']);

      // The remaining container is still running fine, so `status` alone reads "running" —
      // `drifted` is what actually surfaces that the stack no longer matches its file.
      const listAfter = await agent.get('/api/stacks');
      expect(listAfter.body.find((s: { name: string }) => s.name === 'drift-check')).toMatchObject({
        status: 'running',
        drifted: true,
      });
    } finally {
      await agent.post('/api/stacks/drift-check/down'); // best-effort cleanup either way
    }
  }, 20_000);

  it('does not consider a never-deployed stack drifted', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'never-deployed', compose: VALID_COMPOSE, deploy: false });

    const list = await agent.get('/api/stacks');
    expect(list.body.find((s: { name: string }) => s.name === 'never-deployed')).toMatchObject({
      status: 'inactive',
      drifted: false,
    });

    const drift = await agent.get('/api/stacks/never-deployed/drift');
    expect(drift.status).toBe(200);
    expect(drift.body).toEqual({
      inSync: true,
      missingServices: [],
      orphanedContainers: [],
      imageMismatches: [],
    });
  });
});
