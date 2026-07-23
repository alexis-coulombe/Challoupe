import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';

export class AuditLogController {
  // Always readable by an admin regardless of the featureFlags.auditLog toggle. Turning
  // the feature off stops new entries, it doesn't hide history that already exists.
  list = (req: Request, res: Response): void => {
    const limit = Number(req.query.limit) || 300;
    res.json(auditLog.list(limit));
  };
}

export const auditLogController = new AuditLogController();
