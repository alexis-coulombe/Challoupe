import type { Request, Response } from 'express';
import { auditLog } from '../audit.js';
import { STACK_NAME_RE, stackService } from '../stacks.js';
import { stackWebhookRepository } from '../stackWebhooks.js';

class DeployWebhookController {
  /**
   * Trigger a stack deploy via webhook token
   * @param req Request<{ name: string; token: string }>
   * @param res Response
   * @returns void
   */
  trigger = async (req: Request<{ name: string; token: string }>, res: Response): Promise<void> => {
    const { name, token } = req.params;

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

    const result = await stackService.deploy(name);
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
