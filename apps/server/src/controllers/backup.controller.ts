import type { Request, Response } from 'express';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { auditLog } from '../audit.js';
import { backupService } from '../backup.js';
import { BACKUPS_DIR } from '../config.js';
import { scheduledBackupService } from '../scheduledBackups.js';
import { filenameSchema, restoreSchema } from './schemas/backup.schema.js';

class BackupController {
  /**
   * Export backup data
   * @param req Request
   * @param res Response
   */
  export = async (req: Request, res: Response): Promise<void> => {
    const backup = await backupService.build();
    auditLog.record({
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
  };

  /**
   * Restore settings from backup json
   * @param req Request
   * @param res Response
   */
  restore = async (req: Request, res: Response): Promise<void> => {
    const body = restoreSchema.parse(req.body);
    await backupService.restore(body);

    auditLog.record({
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
  };

  /**
   * Lists the backups written by the scheduler
   * @param _req Request
   * @param res Response
   */
  listScheduled = (_req: Request, res: Response): void => {
    res.json(scheduledBackupService.list());
  };

  /**
   * Executre scheduled backup
   * @param req Request
   * @param res Response
   */
  runScheduled = async (req: Request, res: Response): Promise<void> => {
    const filename = await scheduledBackupService.run();

    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'backup.scheduled_run',
      target: filename,
      status: 'success',
      ip: req.ip,
    });

    res.json({ filename });
  };

  /**
   * Download scheduled backup
   * @param req Request
   * @param res Response
   */
  downloadScheduled = (req: Request, res: Response): void => {
    const { filename } = filenameSchema.parse(req.params);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(readFileSync(path.join(BACKUPS_DIR, filename)));
  };

  /**
   * Delete scheduled backup
   * @param req Request
   * @param res Response
   */
  deleteScheduled = (req: Request, res: Response): void => {
    const { filename } = filenameSchema.parse(req.params);
    unlinkSync(path.join(BACKUPS_DIR, filename));
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'backup.scheduled_delete',
      target: filename,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };
}

export const backupController = new BackupController();
