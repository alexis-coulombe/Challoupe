import { Router } from 'express';
import { oidcController as c } from './oidc.controller.js';

const router = Router();

router.get('/config', c.config);
router.get('/login', c.login);
router.get('/callback', c.callback);

export default router;
