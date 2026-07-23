import { Router } from 'express';
import { notificationsController as c } from '../controllers/notifications.controller.js';

const router = Router();

router.post('/test', c.test);

export default router;
