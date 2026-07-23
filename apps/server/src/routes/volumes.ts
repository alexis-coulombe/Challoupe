import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { volumesController as c } from '../controllers/volumes.controller.js';

const router = Router();

router.get('/', c.list);
router.post('/', requirePermission('manageVolumes'), c.create);
router.delete<{ name: string }>('/:name', requirePermission('manageVolumes'), c.remove);
router.post('/prune', requirePermission('manageVolumes'), c.prune);

export default router;
