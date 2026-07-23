import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';
import { app } from '../../src/index.js';
import { db } from '../../src/db.js';
import { createAdminAgent, createUserAgent } from '../helpers.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
});

describe('GET /api/users', () => {
  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const res = await memberAgent.get('/api/users');
    expect(res.status).toBe(403);
  });

  it('lists users for an admin', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await createUserAgent(app, admin, 'member');
    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u: { username: string }) => u.username).sort()).toEqual([
      'admin',
      'member',
    ]);
  });
});

describe('POST /api/users', () => {
  it('rejects a duplicate username', async () => {
    const { agent: admin } = await createAdminAgent(app);
    await admin.post('/api/users').send({ username: 'dupe', password: 'password123' });
    const res = await admin.post('/api/users').send({ username: 'dupe', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/users').send({ username: 'member', password: 'short1' });
    expect(res.status).toBe(400);
  });

  it('defaults to no management permissions but AI/security scanner on', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/users').send({ username: 'member', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.permissions).toEqual({
      manageContainers: false,
      manageImages: false,
      manageVolumes: false,
      manageNetworks: false,
      manageStacks: false,
      exec: false,
      useAi: true,
      useSecurityScanner: true,
    });
  });

  it('honors explicitly granted permissions', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const res = await admin.post('/api/users').send({
      username: 'member',
      password: 'password123',
      permissions: { manageContainers: true, useAi: false },
    });
    expect(res.status).toBe(201);
    expect(res.body.permissions.manageContainers).toBe(true);
    expect(res.body.permissions.useAi).toBe(false);
    expect(res.body.permissions.manageStacks).toBe(false);
  });
});

describe('DELETE /api/users/:id', () => {
  it('refuses to delete your own account', async () => {
    const { agent: admin, user } = await createAdminAgent(app);
    const res = await admin.delete(`/api/users/${user.id}`);
    expect(res.status).toBe(400);
  });

  it('lets an admin delete a different user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin
      .post('/api/users')
      .send({ username: 'member', password: 'password123' });
    const res = await admin.delete(`/api/users/${created.body.id}`);
    expect(res.status).toBe(200);
    expect((await admin.get('/api/users')).body).toHaveLength(1);
  });
});

describe('PUT /api/users/:id', () => {
  it('refuses to demote the last remaining admin', async () => {
    const { agent: admin, user } = await createAdminAgent(app);
    const res = await admin.put(`/api/users/${user.id}`).send({ role: 'user' });
    expect(res.status).toBe(400);
  });

  it('updates the role of another user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin
      .post('/api/users')
      .send({ username: 'member', password: 'password123' });
    const res = await admin.put(`/api/users/${created.body.id}`).send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('updates only the permissions that were sent, leaving the rest untouched', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/users').send({ username: 'member', password: 'password123' });

    const res = await admin
      .put(`/api/users/${created.body.id}`)
      .send({ permissions: { manageContainers: true } });
    expect(res.status).toBe(200);
    expect(res.body.permissions.manageContainers).toBe(true);
    // AI/security-scanner defaults are untouched by a partial update.
    expect(res.body.permissions.useAi).toBe(true);
    expect(res.body.permissions.manageStacks).toBe(false);
  });
});

describe('POST /api/users/:id/totp/disable', () => {
  it('lets an admin reset a locked-out user\'s two-factor authentication', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const setupRes = await memberAgent.post('/api/auth/totp/setup');
    const token = await generate({ secret: setupRes.body.secret });
    await memberAgent.post('/api/auth/totp/confirm').send({ token });

    const member = (await admin.get('/api/users')).body.find(
      (u: { username: string }) => u.username === 'member'
    );
    expect(member.totpEnabled).toBe(true);

    const res = await admin.post(`/api/users/${member.id}/totp/disable`);
    expect(res.status).toBe(200);
    expect(res.body.totpEnabled).toBe(false);
  });

  it('rejects resetting a user who never enabled it', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const created = await admin.post('/api/users').send({ username: 'member', password: 'password123' });
    const res = await admin.post(`/api/users/${created.body.id}/totp/disable`);
    expect(res.status).toBe(400);
  });

  it('is forbidden for a non-admin user', async () => {
    const { agent: admin } = await createAdminAgent(app);
    const memberAgent = await createUserAgent(app, admin, 'member');
    const other = await admin.post('/api/users').send({ username: 'other', password: 'password123' });
    const res = await memberAgent.post(`/api/users/${other.body.id}/totp/disable`);
    expect(res.status).toBe(403);
  });
});
