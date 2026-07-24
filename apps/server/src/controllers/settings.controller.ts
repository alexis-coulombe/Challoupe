import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { RESTART_POLICIES, settingsService, type AppSettings } from '../settings.js';
import { oidcConfigProvider } from '../oidc.js';
import { imageUpdateService } from '../imageUpdates.js';
import { scheduledBackupService } from '../scheduledBackups.js';
import { userRepository } from '../auth.js';
import { stackService } from '../stacks.js';

// Both are write-only from the API's point of view: the settings form always shows a
// blank field and treats blank-on-save as "leave unchanged".
function redactSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    oidc: { ...settings.oidc, clientSecret: '' },
    notifications: { ...settings.notifications, webhookUrl: '' },
    ntfy: { ...settings.ntfy, password: '' },
  };
}

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
    terminalTheme: z
      .object({
        background: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
        foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
        cursor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color'),
      })
      .partial(),
    notifications: z
      .object({
        enabled: z.boolean(),
        webhookUrl: z.string().max(500).refine((v) => v === '' || /^https?:\/\//.test(v), 'Must be a valid URL'),
        format: z.enum(['generic', 'discord', 'slack']),
        onContainerCrash: z.boolean(),
        onImageUpdate: z.boolean(),
        onBackupFailure: z.boolean(),
      })
      .partial(),
    ntfy: z
      .object({
        enabled: z.boolean(),
        serverUrl: z.string().url().max(300),
        topic: z.string().max(100),
        username: z.string().max(200),
        password: z.string().max(500),
        onContainerCrash: z.boolean(),
        onImageUpdate: z.boolean(),
        onBackupFailure: z.boolean(),
      })
      .partial(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one setting is required' });

export class SettingsController {
  get = (_req: Request, res: Response): void => {
    const settings = settingsService.get();
    res.json(redactSecrets(settings));
  };

  update = (req: Request, res: Response): void => {
    const body = updateSchema.parse(req.body);
    // Recorded against the pre-update state so that the request which turns audit
    // logging off is itself still captured, rather than silently skipping itself.
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'settings.update',
      detail: Object.keys(body).join(', '),
      status: 'success',
      ip: req.ip,
    });
    const updated = settingsService.update(body);
    if (body.oidc) oidcConfigProvider.resetCache();
    if (body.imageUpdateCheck) imageUpdateService.restartScheduler();
    if (body.scheduledBackup) scheduledBackupService.restartScheduler();
    res.json(redactSecrets(updated));
  };

  reset = async (req: Request, res: Response): Promise<void> => {
    const stackNames = await stackService.listNames();
    for (const name of stackNames) {
      await stackService.delete(name);
    }
    userRepository.deleteAll();
    const reset = settingsService.reset();
    oidcConfigProvider.resetCache();
    imageUpdateService.restartScheduler();
    scheduledBackupService.restartScheduler();
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'settings.factory_reset',
      detail: `deleted ${stackNames.length} stack(s) and all users, kept the audit log`,
      status: 'success',
      ip: req.ip,
    });
    req.session.destroy(() => {
      res.json(redactSecrets(reset));
    });
  };
}

export const settingsController = new SettingsController();
