import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { settingsController as c } from '../controllers/settings.controller.js';

const router = Router();

router.get('/', c.get);
router.put('/', requireAdmin, c.update);
router.post('/reset', requireAdmin, c.reset);

export default router;
