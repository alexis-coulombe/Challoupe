import { Router } from 'express';
import { systemController as c } from '../controllers/system.controller.js';

const router = Router();

router.get('/info', c.info);

export default router;
