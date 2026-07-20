import { Router } from 'express';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { recordAudit } from '../audit.js';
import { buildBackup, restoreBackup } from '../backup.js';
import { BACKUPS_DIR } from '../config.js';
import {
  SCHEDULED_BACKUP_FILENAME_RE,
  listScheduledBackups,
  runScheduledBackup,
} from '../scheduledBackups.js';

const router = Router();

router.get('/', async (req, res) => {
  const backup = await buildBackup();
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'backup.export',
    detail: `${backup.users.length} users, ${backup.stacks.length} stacks`,
    status: 'success',
    ip: req.ip,
  });
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="challoupe-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json(backup);
});

const restoreSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  settings: z.array(z.object({ key: z.string(), value: z.string() })),
  users: z.array(z.record(z.string(), z.unknown())),
  stacks: z.array(z.object({ name: z.string(), compose: z.string() })),
});

// Restoring replaces the current users/settings/stacks wholesale, which can invalidate
// the requester's own session (their user row may not come back with the same id) —
// the session is deliberately destroyed afterward so everyone re-authenticates cleanly
// against the restored state rather than running with stale in-memory session data.
router.post('/restore', async (req, res) => {
  const body = restoreSchema.parse(req.body);
  await restoreBackup(body);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'backup.restore',
    detail: `${body.users.length} users, ${body.stacks.length} stacks`,
    status: 'success',
    ip: req.ip,
  });
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Lists the backups written by the scheduler (see settings.ts's `scheduledBackup` for the
// on/off toggle and retention count) — newest first.
router.get('/scheduled', (_req, res) => {
  res.json(listScheduledBackups());
});

// Writes one on demand, outside the timer — e.g. right before a risky change, or to
// confirm the feature is wired up without waiting for the next scheduled run.
router.post('/scheduled/run', async (req, res) => {
  const filename = await runScheduledBackup();
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'backup.scheduled_run',
    target: filename,
    status: 'success',
    ip: req.ip,
  });
  res.json({ filename });
});

const filenameSchema = z.object({ filename: z.string().regex(SCHEDULED_BACKUP_FILENAME_RE) });

router.get('/scheduled/:filename', (req, res) => {
  const { filename } = filenameSchema.parse(req.params);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(readFileSync(path.join(BACKUPS_DIR, filename)));
});

router.delete('/scheduled/:filename', (req, res) => {
  const { filename } = filenameSchema.parse(req.params);
  unlinkSync(path.join(BACKUPS_DIR, filename));
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'backup.scheduled_delete',
    target: filename,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

export default router;
