import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, userRepository } from '../auth.js';
import { auditLog } from '../audit.js';
import {
  DEFAULT_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_COLUMNS,
  type Permission,
  type Permissions,
} from '../permissions.js';

const permissionsSchema = z
  .object(Object.fromEntries(PERMISSIONS.map((p) => [p, z.boolean()])) as Record<Permission, z.ZodBoolean>)
  .partial();

const createSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(4).max(128),
  role: z.enum(['admin', 'user']).default('user'),
  permissions: permissionsSchema.default({}),
});

const updateSchema = z.object({
  password: z.string().min(4).max(128).optional(),
  role: z.enum(['admin', 'user']).optional(),
  permissions: permissionsSchema.optional(),
});

export class UsersController {
  private adminCount(): number {
    return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
  }

  private insertUser(
    username: string,
    passwordHash: string,
    role: 'admin' | 'user',
    permissions: Partial<Permissions>
  ): number {
    const merged: Permissions = { ...DEFAULT_PERMISSIONS, ...permissions };
    const columns = PERMISSIONS.map((p) => PERMISSION_COLUMNS[p]);
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, role, ${columns.join(', ')}) VALUES (?, ?, ?, ${columns
          .map(() => '?')
          .join(', ')})`
      )
      .run(username, passwordHash, role, ...PERMISSIONS.map((p) => (merged[p] ? 1 : 0)));
    return Number(info.lastInsertRowid);
  }

  private updatePermissions(id: number, permissions: Partial<Permissions>): void {
    const entries = Object.entries(permissions) as Array<[Permission, boolean]>;
    if (entries.length === 0) return;
    const sets = entries.map(([p]) => `${PERMISSION_COLUMNS[p]} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => (v ? 1 : 0)), id);
  }

  list = (_req: Request, res: Response): void => {
    res.json(userRepository.list());
  };

  create = (req: Request, res: Response): void => {
    const body = createSchema.parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    const id = this.insertUser(body.username, hashPassword(body.password), body.role, body.permissions);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'user.create',
      target: body.username,
      detail: `role=${body.role}`,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json(userRepository.getById(id));
  };

  update = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const target = userRepository.getById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const body = updateSchema.parse(req.body);
    if (body.role && body.role !== 'admin' && target.role === 'admin' && this.adminCount() === 1) {
      res.status(400).json({ error: 'Cannot demote the last administrator' });
      return;
    }
    const changes: string[] = [];
    if (body.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), id);
      changes.push('password reset');
    }
    if (body.role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
      changes.push(`role -> ${body.role}`);
    }
    if (body.permissions) {
      this.updatePermissions(id, body.permissions);
      changes.push(`permissions: ${Object.entries(body.permissions).map(([p, v]) => `${p}=${v}`).join(', ')}`);
    }
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'user.update',
      target: target.username,
      detail: changes.join('; ') || undefined,
      status: 'success',
      ip: req.ip,
    });
    res.json(userRepository.getById(id));
  };

  remove = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const target = userRepository.getById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (id === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    if (target.role === 'admin' && this.adminCount() === 1) {
      res.status(400).json({ error: 'Cannot delete the last administrator' });
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'user.delete',
      target: target.username,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  // Recovery path for a user who lost their authenticator device/backup codes — an admin
  // can turn TOTP back off for them, same as an admin can reset a forgotten password above.
  disableTotp = (req: Request, res: Response): void => {
    const id = Number(req.params.id);
    const target = userRepository.getById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (!target.totpEnabled) {
      res.status(400).json({ error: 'Two-factor authentication is not enabled for this user' });
      return;
    }
    userRepository.disableTotp(id);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'user.totp_disabled',
      target: target.username,
      status: 'success',
      ip: req.ip,
    });
    res.json(userRepository.getById(id));
  };
}

export const usersController = new UsersController();
