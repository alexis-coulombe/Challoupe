import { z } from 'zod';
import { SCHEDULED_BACKUP_FILENAME_RE } from '../../scheduledBackups.js';

export const restoreSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  settings: z.array(z.object({ key: z.string(), value: z.string() })),
  users: z.array(z.record(z.string(), z.unknown())),
  stacks: z.array(z.object({ name: z.string(), compose: z.string() })),
});

export const filenameSchema = z.object({ filename: z.string().regex(SCHEDULED_BACKUP_FILENAME_RE) });
