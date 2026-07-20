import type { IncomingMessage } from 'node:http';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import { db } from './db.js';
import { authenticateUpgrade } from './wsAuth.js';

beforeEach(() => {
  db.exec('DELETE FROM users');
});

function fakeRequest(cookieHeader?: string): IncomingMessage {
  return { url: '/', headers: { cookie: cookieHeader } } as unknown as IncomingMessage;
}

describe('authenticateUpgrade', () => {
  it('resolves null when the request has no cookie', async () => {
    expect(await authenticateUpgrade(fakeRequest())).toBeNull();
  });

  it('resolves null for a cookie that matches no session', async () => {
    expect(await authenticateUpgrade(fakeRequest('challoupe.sid=s%3Anot-a-real-session'))).toBeNull();
  });

  it('resolves the logged-in user from a real session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ username: 'admin', password: 'password123' });
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cookieHeader = setCookie[0].split(';')[0];

    const user = await authenticateUpgrade(fakeRequest(cookieHeader));
    expect(user?.username).toBe('admin');
    expect(user?.role).toBe('admin');
  });
});
