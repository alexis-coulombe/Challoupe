import { Router } from 'express';
import { requireAdmin } from '../../auth.js';
import { aiController as c } from './ai.controller.js';

const router = Router();

// Admin-only to prevent others to point the server at an arbitrary host/port
router.get('/models', requireAdmin, c.models);

export default router;
