import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { recordAudit } from '../audit.js';
import { getPortainerStackFile, listPortainerStacks } from '../portainer.js';
import {
  STACK_NAME_RE,
  deleteStack,
  deployStack,
  downStack,
  getStackDrift,
  listStacks,
  readStack,
  stackExists,
  writeStack,
} from '../stacks.js';

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
  if (!(await stackExists(req.params.name))) {
    res.status(404).json({ error: 'Stack not found' });
    return;
  }
  next();
}

router.get('/', async (_req, res) => {
  res.json(await listStacks());
});

router.post('/', requirePermission('manageStacks'), async (req, res) => {
  const body = z
    .object({
      name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
      compose: z.string().min(1),
      deploy: z.boolean().default(false),
    })
    .parse(req.body);
  if (await stackExists(body.name)) {
    res.status(409).json({ error: 'A stack with this name already exists' });
    return;
  }
  await writeStack(body.name, body.compose);
  const result = body.deploy ? await deployStack(body.name) : null;
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.create',
    target: body.name,
    detail: body.deploy ? (result?.ok ? 'deployed immediately' : 'deploy failed') : undefined,
    status: 'success',
    ip: req.ip,
  });
  res.status(201).json({ name: body.name, deploy: result });
});

const portainerCredsSchema = z.object({
  baseUrl: z.string().trim().url(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

router.post('/portainer/list', requirePermission('manageStacks'), async (req, res) => {
  const creds = portainerCredsSchema.parse(req.body);
  try {
    res.json(await listPortainerStacks(creds.baseUrl, creds.username, creds.password));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post('/portainer/import', requirePermission('manageStacks'), async (req, res) => {
  const body = portainerCredsSchema
    .extend({
      id: z.number().int(),
      name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
    })
    .parse(req.body);
  if (await stackExists(body.name)) {
    res.status(409).json({ error: 'A stack with this name already exists' });
    return;
  }
  let compose: string;
  try {
    compose = await getPortainerStackFile(body.baseUrl, body.username, body.password, body.id);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  await writeStack(body.name, compose);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.import',
    target: body.name,
    detail: `from Portainer stack #${body.id}`,
    status: 'success',
    ip: req.ip,
  });
  res.status(201).json({ name: body.name });
});

router.get('/:name', requireStack, async (req, res) => {
  res.json({ name: req.params.name, compose: await readStack(req.params.name) });
});

// Read-only, same access level as GET /:name — surfaces what redeploying would change
// without actually running `docker compose up`.
router.get('/:name/drift', requireStack, async (req, res) => {
  res.json(await getStackDrift(req.params.name));
});

router.put('/:name', requireStack, requirePermission('manageStacks'), async (req, res) => {
  const body = z.object({ compose: z.string().min(1) }).parse(req.body);
  await writeStack(req.params.name, body.compose);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.update',
    target: req.params.name,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

// Unlike a container start/stop (bounded by config only a manageContainers holder could
// have set), deploying a stack that was created-but-never-deployed effectively creates
// brand-new containers from whatever the compose file says — equivalent to container
// create, not container start. So this needs manageStacks, not just stack existence.
router.post('/:name/deploy', requireStack, requirePermission('manageStacks'), async (req, res) => {
  const result = await deployStack(req.params.name);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.deploy',
    target: req.params.name,
    detail: result.ok ? undefined : result.output.slice(0, 300),
    status: result.ok ? 'success' : 'failure',
    ip: req.ip,
  });
  res.json(result);
});

router.post('/:name/down', requireStack, requirePermission('manageStacks'), async (req, res) => {
  const result = await downStack(req.params.name);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.down',
    target: req.params.name,
    detail: result.ok ? undefined : result.output.slice(0, 300),
    status: result.ok ? 'success' : 'failure',
    ip: req.ip,
  });
  res.json(result);
});

router.delete('/:name', requireStack, requirePermission('manageStacks'), async (req, res) => {
  await deleteStack(req.params.name);
  recordAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'stack.delete',
    target: req.params.name,
    status: 'success',
    ip: req.ip,
  });
  res.json({ ok: true });
});

export default router;
