import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { imagesController as c } from '../controllers/images.controller.js';

const router = Router();

router.get('/', c.list);
router.post('/check-updates', requirePermission('manageImages'), c.checkUpdates);
router.post<{ id: string }>('/:id/check-update', requirePermission('manageImages'), c.checkUpdate);
router.post('/build-from-git', requirePermission('manageImages'), c.buildFromGit);
router.post('/pull', requirePermission('manageImages'), c.pull);
router.delete('/', requirePermission('manageImages'), c.remove);
router.post('/prune', requirePermission('manageImages'), c.prune);

export default router;
