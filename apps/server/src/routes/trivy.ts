import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth.js';
import { recordAudit } from '../audit.js';
import { getSettings } from '../settings.js';
import { scanImage } from '../trivy.js';
import { IMAGE_REF_RE } from '../validators.js';

const router = Router();

router.post('/scan', requirePermission('useSecurityScanner'), async (req, res) => {
  const { featureFlags, trivyImage } = getSettings();
  if (!featureFlags.vulnerabilityScanner) {
    res.status(403).json({ error: 'Vulnerability scanning is disabled in Settings.' });
    return;
  }
  const { image } = z
    .object({ image: z.string().trim().min(1).max(255).regex(IMAGE_REF_RE, 'Invalid image reference') })
    .parse(req.body);
  try {
    const result = await scanImage(image, trivyImage);
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    recordAudit({
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
    recordAudit({
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
});

export default router;
