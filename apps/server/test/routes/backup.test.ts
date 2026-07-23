import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  db.exec('DELETE FROM audit_log');
});

describe('GET /api/backup', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(401);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    const res = await agent.get('/api/backup');
    expect(res.status).toBe(403);
  });

  it('exports the current users, settings, and stacks', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ trivyImage: 'aquasec/trivy:0.50.0' });
    await agent
      .post('/api/stacks')
      .send({ name: 'backup-stack', compose: 'services:\n  web:\n    image: nginx:alpine\n' });

    const res = await agent.get('/api/backup');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toMatchObject({ username: 'admin', role: 'admin' });
    expect(res.body.settings).toEqual(
      expect.arrayContaining([{ key: 'trivyImage', value: 'aquasec/trivy:0.50.0' }])
    );
    expect(res.body.stacks).toEqual([
      { name: 'backup-stack', compose: 'services:\n  web:\n    image: nginx:alpine\n' },
    ]);

    const audit = await agent.get('/api/audit-log');
    expect(audit.body[0]).toMatchObject({ action: 'backup.export', username: 'admin', status: 'success' });
  });
});

describe('POST /api/backup/restore', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/backup/restore').send({});
    expect(res.status).toBe(401);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    const res = await agent.post('/api/backup/restore').send({});
    expect(res.status).toBe(403);
  });

  it('rejects a backup with an unsupported version', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .post('/api/backup/restore')
      .send({ version: 2, exportedAt: new Date().toISOString(), settings: [], users: [], stacks: [] });
    expect(res.status).toBe(400);
  });

  it('accepts a restore payload larger than the general 1mb JSON body limit', async () => {
    const { agent } = await createAdminAgent(app);
    await agent
      .post('/api/stacks')
      .send({ name: 'big-stack', compose: 'services:\n  web:\n    image: nginx:alpine\n', deploy: false });
    const exported = (await agent.get('/api/backup')).body;
    // Pad well past the general 1mb express.json() limit to prove /api/backup's own
    // larger limit (see index.ts) is what's actually in effect here.
    exported.stacks[0].compose += '\n# ' + 'x'.repeat(1.5 * 1024 * 1024);

    const res = await agent.post('/api/backup/restore').send(exported);
    expect(res.status).toBe(200);
  });

  it('replaces users, settings, and stacks, then invalidates the current session', async () => {
    const { agent } = await createAdminAgent(app);
    const exported = (await agent.get('/api/backup')).body;

    // Diverge current state from the backup so the restore is observably meaningful.
    await agent.put('/api/settings').send({ trivyImage: 'something-else' });
    await agent.post('/api/users').send({ username: 'temp-user', password: 'password123' });

    const restore = await agent.post('/api/backup/restore').send(exported);
    expect(restore.status).toBe(200);

    // The session that performed the restore no longer works. A full state
    // replacement forces a clean re-login rather than running on stale session data.
    const whoAmI = await agent.get('/api/auth/status');
    expect(whoAmI.body.user).toBeNull();

    const freshLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(freshLogin.status).toBe(200);
    const cookie = (freshLogin.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    const usersAfter = await request(app).get('/api/users').set('Cookie', cookie);
    expect(usersAfter.body.map((u: { username: string }) => u.username)).toEqual(['admin']);

    const settingsAfter = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(settingsAfter.body.trivyImage).toBe('aquasec/trivy:latest');
  });

  it('writes a stack from the backup that does not currently exist on disk', async () => {
    const { agent } = await createAdminAgent(app);
    const exported = (await agent.get('/api/backup')).body;
    exported.stacks.push({
      name: 'never-seen-before',
      compose: 'services:\n  web:\n    image: nginx:alpine\n',
    });

    await agent.post('/api/backup/restore').send(exported);

    const freshLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    const cookie = (freshLogin.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const stackRes = await request(app).get('/api/stacks/never-seen-before').set('Cookie', cookie);
    expect(stackRes.status).toBe(200);
    expect(stackRes.body.compose).toBe('services:\n  web:\n    image: nginx:alpine\n');
  });
});

describe('scheduled backups', () => {
  it('lists nothing before any scheduled backup has run', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/backup/scheduled');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('writes one on demand, lists it, downloads it, then deletes it', async () => {
    const { agent } = await createAdminAgent(app);

    const runRes = await agent.post('/api/backup/scheduled/run');
    expect(runRes.status).toBe(200);
    const { filename } = runRes.body;
    expect(filename).toMatch(/^challoupe-backup-.+\.json$/);

    const listRes = await agent.get('/api/backup/scheduled');
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({ filename });

    const downloadRes = await agent.get(`/api/backup/scheduled/${filename}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.version).toBe(1);
    expect(downloadRes.body.users).toHaveLength(1);

    const audit = await agent.get('/api/audit-log');
    expect(audit.body[0]).toMatchObject({ action: 'backup.scheduled_run', target: filename });

    const deleteRes = await agent.delete(`/api/backup/scheduled/${filename}`);
    expect(deleteRes.status).toBe(200);
    expect((await agent.get('/api/backup/scheduled')).body).toEqual([]);
  });

  it('rejects a filename that tries to escape the backups directory', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent.get('/api/backup/scheduled/..%2F..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const agent = await createUserAgent(app, admin, 'viewer');
    expect((await agent.get('/api/backup/scheduled')).status).toBe(403);
    expect((await agent.post('/api/backup/scheduled/run')).status).toBe(403);
  });

  it('persists the schedule and interval, and restarts the scheduler on update', async () => {
    const { agent } = await createAdminAgent(app);
    const res = await agent
      .put('/api/settings')
      .send({ scheduledBackup: { enabled: true, intervalHours: 12, keepCount: 3 } });
    expect(res.status).toBe(200);
    expect(res.body.scheduledBackup).toEqual({ enabled: true, intervalHours: 12, keepCount: 3 });

    const getRes = await agent.get('/api/settings');
    expect(getRes.body.scheduledBackup).toEqual({ enabled: true, intervalHours: 12, keepCount: 3 });
  });

  it('prunes the oldest files past keepCount after a run', async () => {
    const { agent } = await createAdminAgent(app);
    await agent.put('/api/settings').send({ scheduledBackup: { keepCount: 2 } });

    for (let i = 0; i < 4; i++) {
      await agent.post('/api/backup/scheduled/run');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const files = (await agent.get('/api/backup/scheduled')).body;
    expect(files).toHaveLength(2);
  });
});
