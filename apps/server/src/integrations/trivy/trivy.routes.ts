import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { trivyController as c } from '../controllers/trivy.controller.js';

const router = Router();

router.post('/scan', requirePermission('useSecurityScanner'), c.scan);

export default router;
