import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { settingsService, type AppSettings } from '../settings.js';
import { oidcConfigProvider } from '../integrations/oidc/oidc.js';
import { imageUpdateService } from '../imageUpdates.js';
import { scheduledBackupService } from '../scheduledBackups.js';
import { userRepository } from '../auth.js';
import { stackService } from '../stacks.js';
import { auditWatchdogService } from '../auditWatchdog.js';
import { resourceWatchdogService } from '../resourceWatchdog.js';
import { updateSchema } from './schemas/settings.schema.js';

/**
 * Redacts secret fields before settings are sent to the client
 * @param settings AppSettings
 * @returns AppSettings
 */
function redactSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    oidc: { ...settings.oidc, clientSecret: '' },
    notifications: { ...settings.notifications, webhookUrl: '' },
    ntfy: { ...settings.ntfy, password: '' },
  };
}

class SettingsController {
  /**
   * Get current settings
   * @param req Request
   * @param res Response
   */
  get = (_req: Request, res: Response): void => {
    const settings = settingsService.get();

    res.json(redactSecrets(settings));
  };

  /**
   * Update settings
   * @param req Request
   * @param res Response
   */
  update = (req: Request, res: Response): void => {
    const body = updateSchema.parse(req.body);
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
    if (body.aiWatchdog) auditWatchdogService.restartScheduler();
    if (body.resourceAlerts) resourceWatchdogService.restartScheduler();

    res.json(redactSecrets(updated));
  };

  /**
   * Reset settings to factory defaults
   * @param req Request
   * @param res Response
   */
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
    auditWatchdogService.restartScheduler();
    resourceWatchdogService.restartScheduler();
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
