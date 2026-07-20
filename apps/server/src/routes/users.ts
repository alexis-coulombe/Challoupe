import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { disableTotp, getUserById, hashPassword, listUsers } from '../auth.js';
import { DEFAULT_PERMISSIONS, PERMISSIONS, PERMISSION_COLUMNS, type Permission, type Permissions } from '../permissions.js';
import { recordAudit } from '../audit.js';

const router = Router();

const permissionsSchema = z
  .object(Object.fromEntries(PERMISSIONS.map((p) => [p, z.boolean()])) as Record<Permission, z.ZodBoolean>)
  .partial();

function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

function insertUser(
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

function updatePermissions(id: number, permissions: Partial<Permissions>): void {
  const entries = Object.entries(permissions) as Array<[Permission, boolean]>;
  if (entries.length === 0) return;
  const sets = entries.map(([p]) => `${PERMISSION_COLUMNS[p]} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => (v ? 1 : 0)), id);
}

router.get('/', (_req, res) => {
  res.json(listUsers());
});

router.post('/', (req, res) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64),
      password: z.string().min(4).max(128),
      role: z.enum(['admin', 'user']).default('user'),
      permissions: permissionsSchema.default({}),
    })
    .parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }
  const id = insertUser(body.username, hashPassword(body.password), body.role, body.permissions);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'user.create',
    target: body.username,
    detail: `role=${body.role}`,
    status: 'success',
    ip: req.ip,
  });
  res.status(201).json(getUserById(id));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const body = z
    .object({
      password: z.string().min(4).max(128).optional(),
      role: z.enum(['admin', 'user']).optional(),
      permissions: permissionsSchema.optional(),
    })
    .parse(req.body);
  if (body.role && body.role !== 'admin' && target.role === 'admin' && adminCount() === 1) {
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
    updatePermissions(id, body.permissions);
    changes.push(`permissions: ${Object.entries(body.permissions).map(([p, v]) => `${p}=${v}`).join(', ')}`);
  }
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'user.update',
    target: target.username,
    detail: changes.join('; ') || undefined,
    status: 'success',
    ip: req.ip,
  });
  res.json(getUserById(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }
  if (target.role === 'admin' && adminCount() === 1) {
    res.status(400).json({ error: 'Cannot delete the last administrator' });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'user.delete',
    target: target.username,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

// Recovery path for a user who lost their authenticator device/backup codes — an admin
// can turn TOTP back off for them, same as an admin can reset a forgotten password above.
router.post('/:id/totp/disable', (req, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (!target.totpEnabled) {
    res.status(400).json({ error: 'Two-factor authentication is not enabled for this user' });
    return;
  }
  disableTotp(id);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'user.totp_disabled',
    target: target.username,
    status: 'success',
    ip: req.ip,
  });
  res.json(getUserById(id));
});

export default router;
