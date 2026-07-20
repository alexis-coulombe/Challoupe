import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { recordAudit } from '../audit.js';
import { getSettings, RESTART_POLICIES, setSettings } from '../settings.js';
import { resetOidcConfigCache } from '../oidc.js';
import { restartImageUpdateScheduler } from '../imageUpdates.js';
import { restartScheduledBackupScheduler } from '../scheduledBackups.js';

const router = Router();

router.get('/', (_req, res) => {
  const settings = getSettings();
  // The client secret is write-only from the API's point of view: the settings form
  // always shows a blank field and treats blank-on-save as "leave unchanged".
  res.json({ ...settings, oidc: { ...settings.oidc, clientSecret: '' } });
});

const updateSchema = z
  .object({
    defaultRestartPolicy: z.enum(RESTART_POLICIES),
    refreshIntervalMs: z.number().int().min(1000).max(300_000),
    defaultLogTail: z.number().int().min(10).max(10_000),
    defaultTerminalShell: z.enum(['/bin/bash', '/bin/sh', '/bin/ash']),
    ollamaBaseUrl: z.string().url().max(200),
    ollamaModel: z.string().max(100),
    trivyImage: z.string().max(200),
    maxContainerMemoryMb: z.number().int().positive().max(1024 * 1024).nullable(),
    maxContainerCpus: z.number().positive().max(256).nullable(),
    featureFlags: z
      .object({ aiAssistant: z.boolean(), vulnerabilityScanner: z.boolean(), auditLog: z.boolean() })
      .partial(),
    oidc: z
      .object({
        enabled: z.boolean(),
        issuerUrl: z.string().max(300).refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid URL'),
        clientId: z.string().max(200),
        clientSecret: z.string().max(500),
        buttonLabel: z.string().max(60),
        providerId: z.string().max(50),
      })
      .partial(),
    imageUpdateCheck: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number().int().min(1).max(24 * 30),
      })
      .partial(),
    scheduledBackup: z
      .object({
        enabled: z.boolean(),
        intervalHours: z.number().int().min(1).max(24 * 30),
        keepCount: z.number().int().min(1).max(100),
      })
      .partial(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one setting is required' });

router.put('/', requireAdmin, (req, res) => {
  const body = updateSchema.parse(req.body);
  // Recorded against the pre-update state so that the request which turns audit
  // logging off is itself still captured, rather than silently skipping itself.
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'settings.update',
    detail: Object.keys(body).join(', '),
    status: 'success',
    ip: req.ip,
  });
  const updated = setSettings(body);
  if (body.oidc) resetOidcConfigCache();
  if (body.imageUpdateCheck) restartImageUpdateScheduler();
  if (body.scheduledBackup) restartScheduledBackupScheduler();
  res.json({ ...updated, oidc: { ...updated.oidc, clientSecret: '' } });
});

export default router;
