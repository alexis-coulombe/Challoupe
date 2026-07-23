import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { containersController as c } from '../controllers/containers.controller.js';

const router = Router();

router.get('/', c.list);
router.post('/', requirePermission('manageContainers'), c.create);
router.get('/:id', c.getOne);
router.get('/:id/logs', c.logs);
router.post('/:id/actions/:action', c.action);
router.delete<{ id: string }>('/:id', requirePermission('manageContainers'), c.remove);

export default router;
