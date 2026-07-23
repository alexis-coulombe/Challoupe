import { Router, type NextFunction, type Request, type Response } from 'express';
import { requirePermission } from '../auth.js';
import { STACK_NAME_RE, stackService } from '../stacks.js';
import { stacksController as c } from '../controllers/stacks.controller.js';

const router = Router();

router.param('name', (req, res, next, name: string) => {
  if (!STACK_NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid stack name (lowercase letters, digits, - and _)' });
    return;
  }
  next();
});

async function requireStack(
  req: Request<{ name: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!(await stackService.exists(req.params.name))) {
    res.status(404).json({ error: 'Stack not found' });
    return;
  }
  next();
}

router.get('/', c.list);
router.post('/', requirePermission('manageStacks'), c.create);
router.post('/portainer/list', requirePermission('manageStacks'), c.listPortainer);
router.post('/portainer/import', requirePermission('manageStacks'), c.importPortainer);
router.get('/:name', requireStack, c.getOne);
router.get('/:name/drift', requireStack, c.drift);
router.put('/:name', requireStack, requirePermission('manageStacks'), c.update);
router.post('/:name/deploy', requireStack, requirePermission('manageStacks'), c.deploy);
router.post('/:name/down', requireStack, requirePermission('manageStacks'), c.down);
router.delete('/:name', requireStack, requirePermission('manageStacks'), c.remove);

export default router;
