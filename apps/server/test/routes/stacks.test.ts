import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { docker } from '../../src/docker.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM stack_webhooks');
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

  it('rejects a non-admin user, since a compose file is as powerful as a privileged container', async () => {
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
  it('rejects a non-admin user without manageStacks, since deploying an unstarted stack is equivalent to creating containers', async () => {
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

  it('revokes any deploy webhook the stack had', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'webhook-cleanup', compose: VALID_COMPOSE });
    await agent.post('/api/stacks/webhook-cleanup/webhook');

    await agent.delete('/api/stacks/webhook-cleanup');

    await agent.post('/api/stacks').send({ name: 'webhook-cleanup', compose: VALID_COMPOSE });
    const status = await agent.get('/api/stacks/webhook-cleanup/webhook');
    expect(status.body).toEqual({ configured: false });
  });
});

describe('GET/POST/DELETE /api/stacks/:name/webhook', () => {
  it('reports not configured until a token is generated', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'hook-stack', compose: VALID_COMPOSE });

    const before = await agent.get('/api/stacks/hook-stack/webhook');
    expect(before.body).toEqual({ configured: false });

    const generate = await agent.post('/api/stacks/hook-stack/webhook');
    expect(generate.status).toBe(200);
    expect(generate.body.token).toMatch(/^[0-9a-f]{64}$/);

    const after = await agent.get('/api/stacks/hook-stack/webhook');
    expect(after.body).toMatchObject({ configured: true });
  });

  it('returns a fresh token on regeneration and invalidates the previous one', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'hook-regen', compose: VALID_COMPOSE });

    const first = await agent.post('/api/stacks/hook-regen/webhook');
    const second = await agent.post('/api/stacks/hook-regen/webhook');
    expect(second.body.token).not.toBe(first.body.token);

    const oldTokenTrigger = await request(app).post(`/api/webhooks/deploy/hook-regen/${first.body.token}`);
    expect(oldTokenTrigger.status).toBe(404);
  });

  it('revokes a webhook, after which its token no longer triggers a deploy', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'hook-revoke', compose: VALID_COMPOSE });
    const generate = await agent.post('/api/stacks/hook-revoke/webhook');

    const revoke = await agent.delete('/api/stacks/hook-revoke/webhook');
    expect(revoke.status).toBe(200);
    expect((await agent.get('/api/stacks/hook-revoke/webhook')).body).toEqual({ configured: false });

    const trigger = await request(app).post(`/api/webhooks/deploy/hook-revoke/${generate.body.token}`);
    expect(trigger.status).toBe(404);
  });

  it('rejects a non-admin user without manageStacks from generating or revoking a token', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'hook-guarded', compose: VALID_COMPOSE });
    const agent = await createUserAgent(app, adminAgent, 'viewer');

    const generate = await agent.post('/api/stacks/hook-guarded/webhook');
    expect(generate.status).toBe(403);

    const revoke = await agent.delete('/api/stacks/hook-guarded/webhook');
    expect(revoke.status).toBe(403);
  });

  it('allows a non-admin with the manageStacks permission to generate a token', async () => {
    const { agent: adminAgent } = await createAdminAgent(app);
    await adminAgent.post('/api/stacks').send({ name: 'hook-granted', compose: VALID_COMPOSE });
    const agent = await createUserAgent(app, adminAgent, 'viewer', 'password123', 'user', {
      manageStacks: true,
    });

    const generate = await agent.post('/api/stacks/hook-granted/webhook');
    expect(generate.status).toBe(200);
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

      // Simulate someone removing one container directly, outside Challoupe entirely.
      // The stack is still (partially) up, just no longer matching its compose file.
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

      // The remaining container is still running fine, so `status` alone reads "running".
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
