import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { getPortainerStackFile, listPortainerStacks } from '../integrations/portainer/portainer.js';
import { stackService } from '../stacks.js';
import { stackWebhookRepository } from '../stackWebhooks.js';
import { createSchema, portainerCredsSchema, portainerImportSchema, updateSchema } from './schemas/stacks.schema.js';

class StacksController {
  /**
   * List all stacks
   * @param req Request
   * @param res Response
   */
  list = async (_req: Request, res: Response): Promise<void> => {
    res.json(await stackService.list());
  };

  /**
   * Create stack
   * @param req Request
   * @param res Response
   * @returns void
   */
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

  /**
   * List stacks available on a Portainer instance
   * @param req Request
   * @param res Response
   */
  listPortainer = async (req: Request, res: Response): Promise<void> => {
    const creds = portainerCredsSchema.parse(req.body);

    try {
      res.json(await listPortainerStacks(creds.baseUrl, creds.username, creds.password));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  };

  /**
   * Import a stack from a Portainer instance
   * @param req Request
   * @param res Response
   * @returns void
   */
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

  /**
   * Get a stack's compose file
   * @param req Request<{ name: string }>
   * @param res Response
   */
  getOne = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    res.json({ name: req.params.name, compose: await stackService.read(req.params.name) });
  };

  /**
   * Get what redeploying a stack would change
   * @param req Request<{ name: string }>
   * @param res Response
   */
  drift = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    res.json(await stackService.drift(req.params.name));
  };

  /**
   * Update a stack's compose file
   * @param req Request<{ name: string }>
   * @param res Response
   */
  update = async (req: Request<{ name: string }>, res: Response): Promise<void> => {
    const body = updateSchema.parse(req.body);
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

  /**
   * Deploy a stack
   * @param req Request<{ name: string }>
   * @param res Response
   */
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

  /**
   * Take a stack down
   * @param req Request<{ name: string }>
   * @param res Response
   */
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

  /**
   * Remove a stack
   * @param req Request<{ name: string }>
   * @param res Response
   */
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

  /**
   * Get a stack's deploy webhook status
   * @param req Request<{ name: string }>
   * @param res Response
   */
  getWebhook = (req: Request<{ name: string }>, res: Response): void => {
    res.json(stackWebhookRepository.status(req.params.name));
  };

  /**
   * Regenerate a stack's deploy webhook token
   * @param req Request<{ name: string }>
   * @param res Response
   */
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

  /**
   * Revoke a stack's deploy webhook token
   * @param req Request<{ name: string }>
   * @param res Response
   */
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
