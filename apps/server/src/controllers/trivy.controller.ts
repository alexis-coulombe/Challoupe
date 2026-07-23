import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditLog } from '../audit.js';
import { settingsService } from '../settings.js';
import { scanImage } from '../trivy.js';
import { IMAGE_REF_RE } from '../validators.js';

const scanSchema = z.object({
  image: z.string().trim().min(1).max(255).regex(IMAGE_REF_RE, 'Invalid image reference'),
});

export class TrivyController {
  scan = async (req: Request, res: Response): Promise<void> => {
    const { featureFlags, trivyImage } = settingsService.get();
    if (!featureFlags.vulnerabilityScanner) {
      res.status(403).json({ error: 'Vulnerability scanning is disabled in Settings.' });
      return;
    }
    const { image } = scanSchema.parse(req.body);
    try {
      const result = await scanImage(image, trivyImage);
      const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
      auditLog.record({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'security.scan',
        target: image,
        detail: `${total} vulnerabilities found`,
        status: 'success',
        ip: req.ip,
      });
      res.json(result);
    } catch (err) {
      auditLog.record({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'security.scan',
        target: image,
        detail: (err as Error).message,
        status: 'failure',
        ip: req.ip,
      });
      res.status(502).json({ error: `Scan failed: ${(err as Error).message}` });
    }
  };
}

export const trivyController = new TrivyController();
