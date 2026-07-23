import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { networksController as c } from '../controllers/networks.controller.js';

const router = Router();

router.get('/', c.list);
router.post('/', requirePermission('manageNetworks'), c.create);
router.delete<{ id: string }>('/:id', requirePermission('manageNetworks'), c.remove);

export default router;
