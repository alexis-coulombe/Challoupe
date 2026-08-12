import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth.js';
import { authController as c } from '../controllers/auth.controller.js';
import oidcRoutes from '../integrations/oidc/oidc.routes.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/status', c.status);
router.post('/setup', loginLimiter, c.setup);
router.post('/login', loginLimiter, c.login);
router.post('/totp/verify', loginLimiter, c.totpVerify);
router.post('/totp/setup', requireAuth, c.totpSetup);
router.post('/totp/confirm', requireAuth, c.totpConfirm);
router.post('/totp/disable', requireAuth, loginLimiter, c.totpDisable);
router.post('/totp/backup-codes', requireAuth, loginLimiter, c.totpBackupCodes);
router.post('/logout', c.logout);
router.post('/password', requireAuth, loginLimiter, c.changePassword);
router.use('/oidc', oidcRoutes);

export default router;
