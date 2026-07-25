import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { deployWebhookController as c } from '../controllers/deployWebhook.controller.js';

const router = Router();

// Keyed by IP, same pattern as routes/auth.ts's login limiter — bounds how many token
// guesses a single source can throw at any stack's deploy endpoint.
const deployLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/deploy/:name/:token', deployLimiter, c.trigger);

export default router;
