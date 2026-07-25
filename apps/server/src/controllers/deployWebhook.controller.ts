import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { STACK_NAME_RE, stackService } from '../stacks.js';
import { stackWebhookRepository } from '../stackWebhooks.js';

export class DeployWebhookController {
  trigger = async (req: Request<{ name: string; token: string }>, res: Response): Promise<void> => {
    const { name, token } = req.params;
    // Same response for a malformed name, an unknown stack, and a wrong token — an
    // unauthenticated caller shouldn't be able to distinguish "no such stack" from "wrong
    // token" for one that exists.
    if (
      !STACK_NAME_RE.test(name) ||
      !(await stackService.exists(name)) ||
      !stackWebhookRepository.verify(name, token)
    ) {
      auditLog.record({
        userId: null,
        username: 'webhook',
        action: 'stack.webhook-deploy',
        target: name,
        detail: 'Invalid or unknown deploy token',
        status: 'failure',
        ip: req.ip,
      });
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const result = await stackService.deployWithPull(name);
    auditLog.record({
      userId: null,
      username: 'webhook',
      action: 'stack.webhook-deploy',
      target: name,
      detail: result.ok ? undefined : result.output.slice(0, 300),
      status: result.ok ? 'success' : 'failure',
      ip: req.ip,
    });
    res.json(result);
  };
}

export const deployWebhookController = new DeployWebhookController();
