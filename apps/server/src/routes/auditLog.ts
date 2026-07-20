import { Router } from 'express';
import { listAuditLog } from '../audit.js';

const router = Router();

// Always readable by an admin regardless of the featureFlags.auditLog toggle — turning
// the feature off stops new entries, it doesn't hide history that already exists.
router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 300;
  res.json(listAuditLog(limit));
});

export default router;
