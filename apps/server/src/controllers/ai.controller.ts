import type { Request, Response } from 'express';
import { z } from 'zod';
import { settingsService } from '../settings.js';
import { listOllamaModels } from '../ollama.js';

const testConnectionSchema = z.object({ baseUrl: z.string().trim().url().optional() });

export class AiController {
  // `baseUrl` lets Settings' "Test connection" button check the value currently typed in
  // the form, before it's saved — otherwise this would only ever be able to test whatever
  // was last persisted, which is misleading right after editing the field.
  models = async (req: Request, res: Response): Promise<void> => {
    const { ollamaBaseUrl, featureFlags } = settingsService.get();
    if (!featureFlags.aiAssistant) {
      res.status(403).json({ error: 'The AI Assistant feature is disabled in Settings.' });
      return;
    }
    const { baseUrl } = testConnectionSchema.parse(req.query);
    const target = baseUrl || ollamaBaseUrl;
    try {
      const models = await listOllamaModels(target);
      res.json({ models });
    } catch (err) {
      res.status(502).json({ error: `Could not reach Ollama at ${target}: ${(err as Error).message}` });
    }
  };
}

export const aiController = new AiController();
