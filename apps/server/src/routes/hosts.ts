import { Router, type NextFunction, type Request, type Response } from 'express';
import type Docker from 'dockerode';
import { requireAdmin } from '../auth.js';
import { hostManager } from '../hostManager.js';
import { hostsController as c } from '../controllers/hosts.controller.js';
import containerRoutes from './containers.js';
import imageRoutes from './images.js';
import volumeRoutes from './volumes.js';
import networkRoutes from './networks.js';
import systemRoutes from './system.js';

declare global {
  namespace Express {
    interface Request {
      dockerClient?: Docker;
      hostId?: string;
    }
  }
}

const router = Router();

// Any authenticated user can see which hosts exist
router.get('/', c.list);
router.post('/', requireAdmin, c.create);
router.post('/test', requireAdmin, c.test);
router.put('/:id', requireAdmin, c.update);
router.delete('/:id', requireAdmin, c.remove);
router.post('/:id/test', requireAdmin, c.testExisting);

async function requireHost(req: Request<{ hostId: string }>, res: Response, next: NextFunction): Promise<void> {
  const client = await hostManager.getClient(req.params.hostId);
  if (!client) {
    res.status(404).json({ error: 'Host not found or unreachable' });
    return;
  }
  req.dockerClient = client;
  req.hostId = req.params.hostId;
  next();
}

router.use('/:hostId/containers', requireHost, containerRoutes);
router.use('/:hostId/images', requireHost, imageRoutes);
router.use('/:hostId/volumes', requireHost, volumeRoutes);
router.use('/:hostId/networks', requireHost, networkRoutes);
router.use('/:hostId/system', requireHost, systemRoutes);

export default router;
