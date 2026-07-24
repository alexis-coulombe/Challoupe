import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, userRepository, verifyPassword } from '../auth.js';
import { auditLog } from '../audit.js';
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  totpKeyUri,
  verifyTotpToken,
} from '../totp.js';

const usernameSchema = z.string().trim().min(1).max(64);

const newPasswordSchema = z.string().min(8).max(128);

const setupSchema = z.object({ username: usernameSchema, password: newPasswordSchema });
const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });

export class AuthController {
  status = (req: Request, res: Response): void => {
    const user = req.session.userId ? userRepository.getById(req.session.userId) : null;
    res.json({ setupRequired: userRepository.count() === 0, user: user ?? null });
  };

  // First run: create the initial admin account.
  setup = (req: Request, res: Response): void => {
    if (userRepository.count() > 0) {
      res.status(409).json({ error: 'An account already exists' });
      return;
    }
    const body = setupSchema.parse(req.body);
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(body.username, hashPassword(body.password), 'admin');
    const user = userRepository.getById(Number(info.lastInsertRowid))!;
    req.session.userId = user.id;
    auditLog.record({
      userId: user.id,
      username: user.username,
      action: 'auth.setup',
      detail: 'Created the initial administrator account',
      status: 'success',
      ip: req.ip,
    });
    res.json({ user });
  };

  login = (req: Request, res: Response): void => {
    const body = loginSchema.parse(req.body);
    const user = userRepository.findByUsername(body.username);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      auditLog.record({
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
        // Password alone isn't enough, so hold the session in a pending state (distinct from
        // `userId`, which is what requireAuth actually checks) until /totp/verify passes.
        req.session.pendingTotpUserId = user.id;
        res.json({ requiresTotp: true });
        return;
      }
      req.session.userId = user.id;
      auditLog.record({
        userId: user.id,
        username: user.username,
        action: 'auth.login',
        status: 'success',
        ip: req.ip,
      });
      res.json({ user: userRepository.getById(user.id) });
    });
  };

  // Completes a login that /login left pending on a second factor. Accepts either a 6-digit
  // TOTP code or one of the account's single-use backup codes.
  totpVerify = async (req: Request, res: Response): Promise<void> => {
    const pendingUserId = req.session.pendingTotpUserId;
    if (!pendingUserId) {
      res.status(400).json({ error: 'No sign-in is awaiting a two-factor code' });
      return;
    }
    const body = z.object({ token: z.string().trim().min(6).max(11) }).parse(req.body);
    const user = userRepository.getById(pendingUserId);
    const totp = user && userRepository.getTotpSecret(user.id);
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
        userRepository.replaceTotpBackupCodes(user.id, remaining);
      }
    }
    if (!valid) {
      auditLog.record({
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
      auditLog.record({
        userId: user.id,
        username: user.username,
        action: 'auth.totp_verify',
        status: 'success',
        detail: usedBackupCode ? 'via backup code' : undefined,
        ip: req.ip,
      });
      res.json({ user: userRepository.getById(user.id) });
    });
  };

  // Starts enabling TOTP: generates a secret and stashes it in the session (not the DB yet)
  // until /totp/confirm proves the user actually has it loaded in an authenticator app.
  totpSetup = (req: Request, res: Response): void => {
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
  };

  // Confirms setup: the caller must prove they can generate a valid code from the pending
  // secret before it's persisted and TOTP actually starts being required at login.
  totpConfirm = async (req: Request, res: Response): Promise<void> => {
    const secret = req.session.pendingTotpSecret;
    if (!secret) {
      res.status(400).json({ error: 'No two-factor setup is in progress' });
      return;
    }
    const body = z.object({ token: z.string().trim().length(6) }).parse(req.body);
    if (!(await verifyTotpToken(secret, body.token))) {
      res.status(400).json({ error: 'Invalid code. Check that your device clock is correct and try again' });
      return;
    }
    const backupCodes = generateBackupCodes();
    userRepository.enableTotp(req.user!.id, secret, hashBackupCodes(backupCodes));
    delete req.session.pendingTotpSecret;
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'auth.totp_enabled',
      status: 'success',
      ip: req.ip,
    });
    res.json({ backupCodes });
  };

  // Requires the current password so a hijacked, still-logged-in session can't silently
  // turn off the extra factor protecting it.
  totpDisable = (req: Request, res: Response): void => {
    const body = z.object({ password: z.string() }).parse(req.body);
    const user = userRepository.findByUsername(req.user!.username)!;
    if (!verifyPassword(body.password, user.password_hash)) {
      auditLog.record({
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
    userRepository.disableTotp(req.user!.id);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'auth.totp_disabled',
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  // Regenerating invalidates every previous backup code. The fresh set is shown once, same
  // as at initial setup, since only hashes are ever stored.
  totpBackupCodes = (req: Request, res: Response): void => {
    const body = z.object({ password: z.string() }).parse(req.body);
    const user = userRepository.findByUsername(req.user!.username)!;
    if (!verifyPassword(body.password, user.password_hash)) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }
    if (!req.user!.totpEnabled) {
      res.status(400).json({ error: 'Two-factor authentication is not enabled' });
      return;
    }
    const backupCodes = generateBackupCodes();
    userRepository.replaceTotpBackupCodes(req.user!.id, hashBackupCodes(backupCodes));
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'auth.totp_backup_codes_regenerated',
      status: 'success',
      ip: req.ip,
    });
    res.json({ backupCodes });
  };

  logout = (req: Request, res: Response): void => {
    const loggedOutUser = req.session.userId ? userRepository.getById(req.session.userId) : undefined;
    req.session.destroy(() => {
      if (loggedOutUser) {
        auditLog.record({
          userId: loggedOutUser.id,
          username: loggedOutUser.username,
          action: 'auth.logout',
          status: 'success',
          ip: req.ip,
        });
      }
      res.json({ ok: true });
    });
  };

  // Change own password.
  changePassword = (req: Request, res: Response): void => {
    const body = z.object({ current: z.string(), next: newPasswordSchema }).parse(req.body);
    const user = userRepository.findByUsername(req.user!.username)!;
    if (!verifyPassword(body.current, user.password_hash)) {
      auditLog.record({
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
    auditLog.record({
      userId: user.id,
      username: user.username,
      action: 'auth.password_change',
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };
}

export const authController = new AuthController();
