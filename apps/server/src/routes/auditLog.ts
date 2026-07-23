import { Router } from 'express';
import { auditLogController as c } from '../controllers/auditLog.controller.js';

const router = Router();

router.get('/', c.list);

export default router;
