import type { Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../notifications.js';

const testSchema = z.object({
  webhookUrl: z.string().url(),
  format: z.enum(['generic', 'discord', 'slack']),
});

const testNtfySchema = z.object({
  serverUrl: z.string().url(),
  topic: z.string().min(1),
  username: z.string(),
  password: z.string(),
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

  testNtfy = async (req: Request, res: Response): Promise<void> => {
    const body = testNtfySchema.parse(req.body);
    try {
      await notificationService.sendNtfyTest(body);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: `Could not reach ntfy: ${(err as Error).message}` });
    }
  };
}

export const notificationsController = new NotificationsController();
