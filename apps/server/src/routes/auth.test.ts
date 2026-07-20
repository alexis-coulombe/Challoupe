import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { generate } from 'otplib';

const mockClient = {
  discovery: vi.fn().mockResolvedValue({ configured: true }),
  randomPKCECodeVerifier: vi.fn(() => 'verifier'),
  randomState: vi.fn(() => 'mock-state'),
  randomNonce: vi.fn(() => 'mock-nonce'),
  calculatePKCECodeChallenge: vi.fn().mockResolvedValue('mock-challenge'),
  buildAuthorizationUrl: vi.fn(() => new URL('https://idp.example.com/authorize?mocked=1')),
  authorizationCodeGrant: vi.fn(),
};

vi.mock('openid-client', () => mockClient);

const { app } = await import('../index.js');
const { db } = await import('../db.js');
const { resetOidcConfigCache } = await import('../oidc.js');

beforeEach(() => {
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
  mockClient.discovery.mockResolvedValue({ configured: true });
  resetOidcConfigCache();
});

async function configureOidc(agent: ReturnType<typeof request.agent>): Promise<void> {
  await agent.put('/api/settings').send({
    oidc: {
      enabled: true,
      issuerUrl: 'https://idp.example.com',
      clientId: 'challoupe',
      clientSecret: 'shh',
      buttonLabel: 'Sign in with Example',
    },
  });
}

describe('GET /api/auth/status', () => {
  it('reports setup required with no user on an empty database', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupRequired: true, user: null });
  });
});

describe('POST /api/auth/setup', () => {
  it('creates the first user as an admin and signs them in', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });

    const status = await agent.get('/api/auth/status');
    expect(status.body.user).toMatchObject({ username: 'admin' });
  });

  it('refuses a second setup once an account exists', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    const res = await agent.post('/api/auth/setup').send({ username: 'other', password: 'password123' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
  });

  it('rejects an incorrect password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('accepts the correct password and starts a session', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ username: 'admin', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session so status no longer reports a user', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await agent.post('/api/auth/logout');
    const status = await agent.get('/api/auth/status');
    expect(status.body.user).toBeNull();
  });
});

describe('POST /api/auth/password', () => {
  it('rejects the wrong current password', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    const res = await agent.post('/api/auth/password').send({ current: 'nope', next: 'newpassword1' });
    expect(res.status).toBe(400);
  });

  it('updates the password so the old one no longer logs in', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await agent.post('/api/auth/password').send({ current: 'password123', next: 'newpassword1' });

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'newpassword1' });
    expect(newLogin.status).toBe(200);
  });
});

describe('GET /api/auth/oidc/config', () => {
  it('reports disabled with no configuration', async () => {
    const res = await request(app).get('/api/auth/oidc/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, buttonLabel: 'Single Sign-On' });
  });

  it('reports enabled once fully configured by an admin', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await configureOidc(agent);

    const res = await request(app).get('/api/auth/oidc/config');
    expect(res.body).toEqual({ enabled: true, buttonLabel: 'Sign in with Example' });
  });
});

describe('GET /api/auth/oidc/login', () => {
  it('rejects when SSO is not configured', async () => {
    const res = await request(app).get('/api/auth/oidc/login');
    expect(res.status).toBe(400);
  });

  it('redirects to the authorization server and stashes PKCE/state/nonce in the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await configureOidc(agent);

    const res = await request.agent(app).get('/api/auth/oidc/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://idp.example.com/authorize?mocked=1');
    expect(mockClient.buildAuthorizationUrl).toHaveBeenCalledWith(
      { configured: true },
      expect.objectContaining({ state: 'mock-state', nonce: 'mock-nonce', code_challenge: 'mock-challenge' })
    );
  });
});

describe('GET /api/auth/oidc/callback', () => {
  async function beginLogin(): Promise<ReturnType<typeof request.agent>> {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await configureOidc(adminAgent);

    const loginAgent = request.agent(app);
    await loginAgent.get('/api/auth/oidc/login');
    return loginAgent;
  }

  it('redirects to an error page when there is no pending flow in the session', async () => {
    const res = await request.agent(app).get('/api/auth/oidc/callback?code=abc&state=xyz');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=oidc_failed');
  });

  it('auto-provisions a new user on first login and starts a session', async () => {
    mockClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'sub-1', email: 'alice@example.com' }),
    });
    const agent = await beginLogin();

    const res = await agent.get('/api/auth/oidc/callback?code=abc&state=mock-state');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const status = await agent.get('/api/auth/status');
    expect(status.body.user).toMatchObject({
      username: 'alice@example.com',
      role: 'user',
      authProvider: 'oidc',
    });
  });

  it('logs the same returning user in on a later visit instead of creating a duplicate', async () => {
    mockClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'sub-1', email: 'alice@example.com' }),
    });
    const first = await beginLogin();
    await first.get('/api/auth/oidc/callback?code=abc&state=mock-state');

    const second = await beginLogin();
    await second.get('/api/auth/oidc/callback?code=abc&state=mock-state');

    const status = await second.get('/api/auth/status');
    expect(status.body.user).toMatchObject({ username: 'alice@example.com' });

    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'password123' });
    const users = await adminAgent.get('/api/users');
    expect(users.body.filter((u: { username: string }) => u.username === 'alice@example.com')).toHaveLength(1);
  });

  it('refuses to hijack an existing local account with the same claimed username', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await configureOidc(adminAgent);
    await adminAgent.post('/api/users').send({ username: 'bob@example.com', password: 'password123' });

    mockClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'sub-2', email: 'bob@example.com' }),
    });
    const loginAgent = request.agent(app);
    await loginAgent.get('/api/auth/oidc/login');
    const res = await loginAgent.get('/api/auth/oidc/callback?code=abc&state=mock-state');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=oidc_failed');
    const status = await loginAgent.get('/api/auth/status');
    expect(status.body.user).toBeNull();
  });
});

describe('TOTP two-factor authentication', () => {
  async function setupTotp(
    agent: ReturnType<typeof request.agent>
  ): Promise<{ secret: string; backupCodes: string[] }> {
    const setupRes = await agent.post('/api/auth/totp/setup');
    const { secret } = setupRes.body;
    const token = await generate({ secret });
    const confirmRes = await agent.post('/api/auth/totp/confirm').send({ token });
    return { secret, backupCodes: confirmRes.body.backupCodes as string[] };
  }

  it('sets up TOTP, rejecting a bad code before accepting a real one', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });

    const setupRes = await agent.post('/api/auth/totp/setup');
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setupRes.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const badConfirm = await agent.post('/api/auth/totp/confirm').send({ token: '000000' });
    expect(badConfirm.status).toBe(400);

    const token = await generate({ secret: setupRes.body.secret });
    const confirmRes = await agent.post('/api/auth/totp/confirm').send({ token });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.backupCodes).toHaveLength(8);

    const status = await agent.get('/api/auth/status');
    expect(status.body.user.totpEnabled).toBe(true);
  });

  it('requires the second factor at login once enabled, and rejects a bad code', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    const { secret } = await setupTotp(agent);

    const freshAgent = request.agent(app);
    const loginRes = await freshAgent
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toEqual({ requiresTotp: true });

    // Password alone doesn't establish a session yet.
    const statusMidFlow = await freshAgent.get('/api/auth/status');
    expect(statusMidFlow.body.user).toBeNull();

    const badVerify = await freshAgent.post('/api/auth/totp/verify').send({ token: '000000' });
    expect(badVerify.status).toBe(401);

    const token = await generate({ secret });
    const verifyRes = await freshAgent.post('/api/auth/totp/verify').send({ token });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user).toMatchObject({ username: 'admin' });

    const status = await freshAgent.get('/api/auth/status');
    expect(status.body.user).toMatchObject({ username: 'admin' });
  });

  it('accepts a single-use backup code in place of a TOTP token, and refuses reuse', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    const { backupCodes } = await setupTotp(agent);

    const freshAgent = request.agent(app);
    await freshAgent.post('/api/auth/login').send({ username: 'admin', password: 'password123' });
    const verifyRes = await freshAgent.post('/api/auth/totp/verify').send({ token: backupCodes[0] });
    expect(verifyRes.status).toBe(200);

    const secondAgent = request.agent(app);
    await secondAgent.post('/api/auth/login').send({ username: 'admin', password: 'password123' });
    const reuseRes = await secondAgent.post('/api/auth/totp/verify').send({ token: backupCodes[0] });
    expect(reuseRes.status).toBe(401);
  });

  it('disables TOTP with the correct password, and refuses without it', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await setupTotp(agent);

    const wrongPassword = await agent.post('/api/auth/totp/disable').send({ password: 'nope' });
    expect(wrongPassword.status).toBe(401);

    const res = await agent.post('/api/auth/totp/disable').send({ password: 'password123' });
    expect(res.status).toBe(200);

    const status = await agent.get('/api/auth/status');
    expect(status.body.user.totpEnabled).toBe(false);

    const freshAgent = request.agent(app);
    const loginRes = await freshAgent
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(loginRes.body.user).toMatchObject({ username: 'admin' });
  });

  it('is not available for OIDC-provisioned accounts', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    await configureOidc(adminAgent);
    mockClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'sub-1', email: 'alice@example.com' }),
    });
    const ssoAgent = request.agent(app);
    await ssoAgent.get('/api/auth/oidc/login');
    await ssoAgent.get('/api/auth/oidc/callback?code=abc&state=mock-state');

    const res = await ssoAgent.post('/api/auth/totp/setup');
    expect(res.status).toBe(400);
  });

  it('regenerates backup codes, invalidating the old set', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/setup').send({ username: 'admin', password: 'password123' });
    const { backupCodes: oldCodes } = await setupTotp(agent);

    const res = await agent.post('/api/auth/totp/backup-codes').send({ password: 'password123' });
    expect(res.status).toBe(200);
    const newCodes = res.body.backupCodes as string[];
    expect(newCodes).toHaveLength(8);
    expect(newCodes).not.toEqual(oldCodes);

    const freshAgent = request.agent(app);
    await freshAgent.post('/api/auth/login').send({ username: 'admin', password: 'password123' });
    const oldCodeRes = await freshAgent.post('/api/auth/totp/verify').send({ token: oldCodes[0] });
    expect(oldCodeRes.status).toBe(401);
  });
});
