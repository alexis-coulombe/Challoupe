import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { getSettings } from '../settings.js';
import { listOllamaModels } from '../ollama.js';

const router = Router();

const testConnectionSchema = z.object({ baseUrl: z.string().trim().url().optional() });

// `baseUrl` lets Settings' "Test connection" button check the value currently typed in
// the form, before it's saved — otherwise this would only ever be able to test whatever
// was last persisted, which is misleading right after editing the field.
router.get('/models', requirePermission('useAi'), async (req, res) => {
  const { ollamaBaseUrl, featureFlags } = getSettings();
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
});

export default router;
