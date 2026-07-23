import type { Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../notifications.js';

const testSchema = z.object({
  webhookUrl: z.string().url(),
  format: z.enum(['generic', 'discord', 'slack']),
});

export class NotificationsController {
  // Tests the webhook URL/format currently typed in the form, before it's saved, same
  // pattern as the AI "test connection" endpoint.
  test = async (req: Request, res: Response): Promise<void> => {
    const body = testSchema.parse(req.body);
    try {
      await notificationService.sendTest(body);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: `Could not reach the webhook: ${(err as Error).message}` });
    }
  };
}

export const notificationsController = new NotificationsController();
