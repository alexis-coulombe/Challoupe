import { Router } from 'express';
import { systemStatsController as c } from '../controllers/systemStats.controller.js';

const router = Router();

router.get('/', c.getToken);
router.post('/', c.regenerateToken);
router.delete('/', c.revokeToken);

export default router;
