import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { systemStatsController as c } from '../controllers/systemStats.controller.js';

const router = Router();

// Rate limit endpoint to 60 times a minute
const statsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/:token', statsLimiter, c.fetch);

export default router;
