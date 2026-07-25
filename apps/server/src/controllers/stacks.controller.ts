import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { getPortainerStackFile, listPortainerStacks } from '../integrations/portainer/portainer.js';
import { STACK_NAME_RE, stackService } from '../stacks.js';
import { stackWebhookRepository } from '../stackWebhooks.js';

const createSchema = z.object({
  name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
  compose: z.string().min(1),
  deploy: z.boolean().default(false),
});

const portainerCredsSchema = z.object({
  baseUrl: z.string().trim().url(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const portainerImportSchema = portainerCredsSchema.extend({
  id: z.number().int(),
  name: z.string().regex(STACK_NAME_RE, 'Lowercase letters, digits, - and _ only'),
});

export class StacksController {
  list = async (_req: Request, res: Response): Promise<void> => {
    res.json(await stackService.list());
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = createSchema.parse(req.body);
    if (await stackService.exists(body.name)) {
      res.status(409).json({ error: 'A stack with this name already exists' });
      return;
    }
    await stackService.write(body.name, body.compose);
    const result = body.deploy ? await stackService.deploy(body.name) : null;
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.create',
      target: body.name,
      detail: body.deploy ? (result?.ok ? 'deployed immediately' : 'deploy failed') : undefined,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json({ name: body.name, deploy: result });
  };

  listPortainer = async (req: Request, res: Response): Promise<void> => {
    const creds = portainerCredsSchema.parse(req.body);
    try {
      res.json(await listPortainerStacks(creds.baseUrl, creds.username, creds.password));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  };

  importPortainer = async (req: Request, res: Response): Promise<void> => {
    const body = portainerImportSchema.parse(req.body);
    if (await stackService.exists(body.name)) {
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
    await stackService.write(body.name, compose);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.import',
      target: body.name,
      detail: `from Portainer stack #${body.id}`,
      status: 'success',
      ip: req.ip,
    });
    res.status(201).json({ name: body.name });
  };

  getOne = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    res.json({ name: req.params.name, compose: await stackService.read(req.params.name) });
  };

  // Read-only, same access level as GET /:name. Surfaces what redeploying would change
  // without actually running `docker compose up`.
  drift = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    res.json(await stackService.drift(req.params.name));
  };

  update = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const body = z.object({ compose: z.string().min(1) }).parse(req.body);
    await stackService.write(req.params.name, body.compose);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.update',
      target: req.params.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  // Unlike a container start/stop (bounded by config only a manageContainers holder could
  // have set), deploying a stack that was created-but-never-deployed effectively creates
  // brand-new containers from whatever the compose file says. Equivalent to container
  // create, not container start. So this needs manageStacks, not just stack existence.
  deploy = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const result = await stackService.deploy(req.params.name);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.deploy',
      target: req.params.name,
      detail: result.ok ? undefined : result.output.slice(0, 300),
      status: result.ok ? 'success' : 'failure',
      ip: req.ip,
    });
    res.json(result);
  };

  down = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const result = await stackService.down(req.params.name);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.down',
      target: req.params.name,
      detail: result.ok ? undefined : result.output.slice(0, 300),
      status: result.ok ? 'success' : 'failure',
      ip: req.ip,
    });
    res.json(result);
  };

  remove = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    await stackService.delete(req.params.name);
    stackWebhookRepository.revoke(req.params.name);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.delete',
      target: req.params.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };

  getWebhook = (req: Request<{ name: string }>, res: Response): void => {
    res.json(stackWebhookRepository.status(req.params.name));
  };

  // Returns the plaintext token exactly once — only its hash is ever persisted, so this is
  // the only chance to see or copy it. Calling this again invalidates the previous token.
  regenerateWebhook = (req: Request<{ name: string }>, res: Response): void => {
    const token = stackWebhookRepository.regenerate(req.params.name);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.webhook-regenerate',
      target: req.params.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ token });
  };

  revokeWebhook = (req: Request<{ name: string }>, res: Response): void => {
    stackWebhookRepository.revoke(req.params.name);
    auditLog.record({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'stack.webhook-revoke',
      target: req.params.name,
      status: 'success',
      ip: req.ip,
    });
    res.json({ ok: true });
  };
}

export const stacksController = new StacksController();
