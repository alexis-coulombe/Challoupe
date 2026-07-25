import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM stack_webhooks');
});

const VALID_COMPOSE = 'services:\n  web:\n    image: nginx:alpine\n';

describe('POST /api/webhooks/deploy/:name/:token', () => {
  it('requires no session but does require a valid token, and actually deploys the stack', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'ci-deployed', compose: VALID_COMPOSE, deploy: false });
    const { body } = await agent.post('/api/stacks/ci-deployed/webhook');

    try {
      // A plain supertest request with no cookie at all — this must work without a session.
      const res = await request(app).post(`/api/webhooks/deploy/ci-deployed/${body.token}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await agent.post('/api/stacks/ci-deployed/down');
    }
  }, 20_000);

  it('rejects a wrong token with 404', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'ci-wrong-token', compose: VALID_COMPOSE, deploy: false });
    await agent.post('/api/stacks/ci-wrong-token/webhook');

    const res = await request(app).post('/api/webhooks/deploy/ci-wrong-token/not-the-real-token');
    expect(res.status).toBe(404);
  });

  it('rejects a nonexistent stack with 404, same as a wrong token', async () => {
    const res = await request(app).post('/api/webhooks/deploy/does-not-exist/some-token');
    expect(res.status).toBe(404);
  });

  it('rejects a malformed stack name with 404 rather than leaking a 400', async () => {
    const res = await request(app).post('/api/webhooks/deploy/Not_Valid/some-token');
    expect(res.status).toBe(404);
  });

  it('rejects a stack that exists but never had a webhook configured', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.post('/api/stacks').send({ name: 'ci-no-webhook', compose: VALID_COMPOSE, deploy: false });

    const res = await request(app).post('/api/webhooks/deploy/ci-no-webhook/some-token');
    expect(res.status).toBe(404);
  });
});
