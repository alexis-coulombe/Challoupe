import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { aiController as c } from '../controllers/ai.controller.js';

const router = Router();

// Admin-only: `baseUrl` lets the caller point the server at an arbitrary host/port
// (the Settings "test connection" flow). Without this, any user would get a
// server-side request forgery primitive, since `useAi` is granted by default.
router.get('/models', requireAdmin, c.models);

export default router;
