import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';

class AuditLogController {
  /**
   * List audit log entries
   * @param req Request
   * @param res Response
   */
  list = (req: Request, res: Response): void => {
    const limit = Number(req.query.limit) || 300;

    res.json(auditLog.list(limit));
  };

  /**
   * Clear the audit log
   * @param req Request
   * @param res Response
   */
  clear = (req: Request, res: Response): void => {
    auditLog.clear();

    res.status(204).end();
  };
}

export const auditLogController = new AuditLogController();
