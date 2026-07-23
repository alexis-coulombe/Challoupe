import { Router } from 'express';
import { backupController as c } from '../controllers/backup.controller.js';

const router = Router();

router.get('/', c.export);
router.post('/restore', c.restore);
router.get('/scheduled', c.listScheduled);
router.post('/scheduled/run', c.runScheduled);
router.get('/scheduled/:filename', c.downloadScheduled);
router.delete('/scheduled/:filename', c.deleteScheduled);

export default router;
