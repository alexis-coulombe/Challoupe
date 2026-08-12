import { z } from 'zod';

export const hostQuerySchema = z.object({ host: z.string().trim().min(1).default('local') });
