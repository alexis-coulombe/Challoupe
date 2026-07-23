import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { aiController as c } from '../controllers/ai.controller.js';

const router = Router();

router.get('/models', requirePermission('useAi'), c.models);

export default router;
