import { Router } from 'express';
import { notificationsController as c } from './notifications.controller.js';

const router = Router();

router.post('/test', c.test);
router.post('/test-ntfy', c.testNtfy);

export default router;
