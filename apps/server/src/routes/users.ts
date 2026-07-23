import { Router } from 'express';
import { usersController as c } from '../controllers/users.controller.js';

const router = Router();

router.get('/', c.list);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/totp/disable', c.disableTotp);

export default router;
