import * as client from 'openid-client';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import {
  disableTotp,
  enableTotp,
  findOrCreateOidcUser,
  findUserByUsername,
  getUserById,
  getUserTotpSecret,
  hashPassword,
  replaceTotpBackupCodes,
  requireAuth,
  userCount,
  verifyPassword,
} from '../auth.js';
import { recordAudit } from '../audit.js';
import { getOidcConfig } from '../oidc.js';
import { getSettings } from '../settings.js';
import { PUBLIC_URL } from '../config.js';
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  totpKeyUri,
  verifyTotpToken,
} from '../totp.js';

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(4).max(128),
});

const router = Router();

// Keyed by IP (express-rate-limit's default `req.ip`, which respects the app's `trust
// proxy` setting) — bounds how many password guesses a single source can throw at either
// endpoint regardless of which username they target.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later.' },
  // The test suite creates dozens of admin/user agents per file, each a real request
  // through this same middleware — without this it would start tripping on test fixtures
  // rather than actual brute-forcing.
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/status', (req, res) => {
  const user = req.session.userId ? getUserById(req.session.userId) : null;
  res.json({ setupRequired: userCount() === 0, user: user ?? null });
});

// First run: create the initial admin account.
router.post('/setup', loginLimiter, (req, res) => {
  if (userCount() > 0) {
    res.status(409).json({ error: 'An account already exists' });
    return;
  }
  const body = credentialsSchema.parse(req.body);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(body.username, hashPassword(body.password), 'admin');
  const user = getUserById(Number(info.lastInsertRowid))!;
  req.session.userId = user.id;
  recordAudit({
    userId: user.id,
    username: user.username,
    action: 'auth.setup',
    detail: 'Created the initial administrator account',
    status: 'success',
    ip: req.ip,
  });
  res.json({ user });
});

router.post('/login', loginLimiter, (req, res) => {
  const body = credentialsSchema.parse(req.body);
  const user = findUserByUsername(body.username);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    recordAudit({
      userId: user?.id ?? null,
      username: body.username,
      action: 'auth.login',
      status: 'failure',
      detail: 'Invalid username or password',
      ip: req.ip,
    });
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  req.session.regenerate((err) => {
    if (err) throw err;
    if (user.totpEnabled) {
      // Password alone isn't enough — hold the session in a pending state (distinct from
      // `userId`, which is what requireAuth actually checks) until /totp/verify passes.
      req.session.pendingTotpUserId = user.id;
      res.json({ requiresTotp: true });
      return;
    }
    req.session.userId = user.id;
    recordAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.login',
      status: 'success',
      ip: req.ip,
    });
    res.json({ user: getUserById(user.id) });
  });
});

// Completes a login that /login left pending on a second factor. Accepts either a 6-digit
// TOTP code or one of the account's single-use backup codes.
router.post('/totp/verify', loginLimiter, async (req, res) => {
  const pendingUserId = req.session.pendingTotpUserId;
  if (!pendingUserId) {
    res.status(400).json({ error: 'No sign-in is awaiting a two-factor code' });
    return;
  }
  const body = z.object({ token: z.string().trim().min(6).max(11) }).parse(req.body);
  const user = getUserById(pendingUserId);
  const totp = user && getUserTotpSecret(user.id);
  if (!user || !totp) {
    delete req.session.pendingTotpUserId;
    res.status(400).json({ error: 'Two-factor authentication is no longer available for this account' });
    return;
  }

  let usedBackupCode = false;
  let valid = await verifyTotpToken(totp.secret, body.token);
  if (!valid) {
    const remaining = consumeBackupCode(totp.backupCodes, body.token.toUpperCase());
    if (remaining) {
      valid = true;
      usedBackupCode = true;
      replaceTotpBackupCodes(user.id, remaining);
    }
  }
  if (!valid) {
    recordAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.totp_verify',
      status: 'failure',
      detail: 'Invalid code',
      ip: req.ip,
    });
    res.status(401).json({ error: 'Invalid code' });
    return;
  }

  delete req.session.pendingTotpUserId;
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    recordAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.totp_verify',
      status: 'success',
      detail: usedBackupCode ? 'via backup code' : undefined,
      ip: req.ip,
    });
    res.json({ user: getUserById(user.id) });
  });
});

// Starts enabling TOTP: generates a secret and stashes it in the session (not the DB yet)
// until /totp/confirm proves the user actually has it loaded in an authenticator app.
router.post('/totp/setup', requireAuth, (req, res) => {
  if (req.user!.authProvider !== 'local') {
    res.status(400).json({ error: 'Two-factor authentication is not available for SSO accounts' });
    return;
  }
  if (req.user!.totpEnabled) {
    res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    return;
  }
  const secret = generateTotpSecret();
  req.session.pendingTotpSecret = secret;
  res.json({ secret, otpauthUrl: totpKeyUri(req.user!.username, secret) });
});

// Confirms setup: the caller must prove they can generate a valid code from the pending
// secret before it's persisted and TOTP actually starts being required at login.
router.post('/totp/confirm', requireAuth, async (req, res) => {
  const secret = req.session.pendingTotpSecret;
  if (!secret) {
    res.status(400).json({ error: 'No two-factor setup is in progress' });
    return;
  }
  const body = z.object({ token: z.string().trim().length(6) }).parse(req.body);
  if (!(await verifyTotpToken(secret, body.token))) {
    res.status(400).json({ error: 'Invalid code — check that your device clock is correct and try again' });
    return;
  }
  const backupCodes = generateBackupCodes();
  enableTotp(req.user!.id, secret, hashBackupCodes(backupCodes));
  delete req.session.pendingTotpSecret;
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'auth.totp_enabled',
    status: 'success',
    ip: req.ip,
  });
  res.json({ backupCodes });
});

// Requires the current password so a hijacked, still-logged-in session can't silently
// turn off the extra factor protecting it.
router.post('/totp/disable', requireAuth, (req, res) => {
  const body = z.object({ password: z.string() }).parse(req.body);
  const user = findUserByUsername(req.user!.username)!;
  if (!verifyPassword(body.password, user.password_hash)) {
    recordAudit({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'auth.totp_disabled',
      status: 'failure',
      detail: 'Incorrect password',
      ip: req.ip,
    });
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }
  disableTotp(req.user!.id);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'auth.totp_disabled',
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

// Regenerating invalidates every previous backup code — the fresh set is shown once, same
// as at initial setup, since only hashes are ever stored.
router.post('/totp/backup-codes', requireAuth, (req, res) => {
  const body = z.object({ password: z.string() }).parse(req.body);
  const user = findUserByUsername(req.user!.username)!;
  if (!verifyPassword(body.password, user.password_hash)) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }
  if (!req.user!.totpEnabled) {
    res.status(400).json({ error: 'Two-factor authentication is not enabled' });
    return;
  }
  const backupCodes = generateBackupCodes();
  replaceTotpBackupCodes(req.user!.id, hashBackupCodes(backupCodes));
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'auth.totp_backup_codes_regenerated',
    status: 'success',
    ip: req.ip,
  });
  res.json({ backupCodes });
});

router.post('/logout', (req, res) => {
  const loggedOutUser = req.session.userId ? getUserById(req.session.userId) : undefined;
  req.session.destroy(() => {
    if (loggedOutUser) {
      recordAudit({
        userId: loggedOutUser.id,
        username: loggedOutUser.username,
        action: 'auth.logout',
        status: 'success',
        ip: req.ip,
      });
    }
    res.json({ ok: true });
  });
});

// Change own password.
router.post('/password', requireAuth, (req, res) => {
  const body = z
    .object({ current: z.string(), next: z.string().min(4).max(128) })
    .parse(req.body);
  const user = findUserByUsername(req.user!.username)!;
  if (!verifyPassword(body.current, user.password_hash)) {
    recordAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.password_change',
      status: 'failure',
      detail: 'Current password was incorrect',
      ip: req.ip,
    });
    res.status(400).json({ error: 'Current password is incorrect' });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(body.next),
    user.id
  );
  recordAudit({
    userId: user.id,
    username: user.username,
    action: 'auth.password_change',
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

// Public: lets the login page know whether to show an SSO button, without exposing
// the issuer/client configuration itself.
router.get('/oidc/config', (_req, res) => {
  const { oidc } = getSettings();
  res.json({ enabled: !!(oidc.enabled && oidc.issuerUrl && oidc.clientId), buttonLabel: oidc.buttonLabel });
});

function callbackUrl(req: Request): string {
  return `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/api/auth/oidc/callback`;
}

router.get('/oidc/login', async (req, res) => {
  const config = await getOidcConfig();
  if (!config) {
    res.status(400).json({ error: 'Single sign-on is not configured' });
    return;
  }
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  req.session.oidc = { state, nonce, codeVerifier };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(req),
    scope: 'openid profile email',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  res.redirect(url.href);
});

router.get('/oidc/callback', async (req, res) => {
  const saved = req.session.oidc;
  const config = saved ? await getOidcConfig() : null;
  if (!config || !saved) {
    res.redirect('/login?error=oidc_failed');
    return;
  }
  delete req.session.oidc;
  try {
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: saved.codeVerifier,
      expectedState: saved.state,
      expectedNonce: saved.nonce,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('The identity provider did not return an ID token');
    const username = String(claims.email ?? claims.preferred_username ?? claims.sub);
    const user = findOrCreateOidcUser(username);
    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.userId = user.id;
      recordAudit({
        userId: user.id,
        username: user.username,
        action: 'auth.oidc_login',
        status: 'success',
        ip: req.ip,
      });
      res.redirect('/');
    });
  } catch (err) {
    recordAudit({
      userId: null,
      username: 'unknown',
      action: 'auth.oidc_login',
      status: 'failure',
      detail: (err as Error).message,
      ip: req.ip,
    });
    res.redirect('/login?error=oidc_failed');
  }
});

export default router;
