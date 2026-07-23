import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { HOST, PORT, TLS_CERT_FILE, TLS_KEY_FILE, TRUST_PROXY, WEB_DIST } from './config.js';
import { requireAdmin, requireAuth, sessionMiddleware } from './auth.js';
import { attachWebSocketServer } from './ws.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import containerRoutes from './routes/containers.js';
import imageRoutes from './routes/images.js';
import volumeRoutes from './routes/volumes.js';
import networkRoutes from './routes/networks.js';
import stackRoutes from './routes/stacks.js';
import systemRoutes from './routes/system.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import trivyRoutes from './routes/trivy.js';
import auditLogRoutes from './routes/auditLog.js';
import backupRoutes from './routes/backup.js';
import notificationsRoutes from './routes/notifications.js';
import { imageUpdateService } from './imageUpdates.js';
import { scheduledBackupService } from './scheduledBackups.js';
import { dockerEventBroadcaster } from './dockerEvents.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
app.use('/api/backup', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/users', requireAuth, requireAdmin, userRoutes);
app.use('/api/containers', requireAuth, containerRoutes);
app.use('/api/images', requireAuth, imageRoutes);
app.use('/api/volumes', requireAuth, volumeRoutes);
app.use('/api/networks', requireAuth, networkRoutes);
app.use('/api/stacks', requireAuth, stackRoutes);
app.use('/api/system', requireAuth, systemRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/trivy', requireAuth, trivyRoutes);
app.use('/api/audit-log', requireAuth, requireAdmin, auditLogRoutes);
app.use('/api/backup', requireAuth, requireAdmin, backupRoutes);
app.use('/api/notifications', requireAuth, requireAdmin, notificationsRoutes);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production the server also serves the built frontend (SPA).
if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }
  
  const e = err as { statusCode?: number; message?: string; json?: { message?: string } };
  const status = Number.isInteger(e.statusCode) ? (e.statusCode as number) : 500;
  const message = e.json?.message || e.message || 'Server error';
  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({ error: message });
});

const tlsEnabled = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);
const server = tlsEnabled
  ? createHttpsServer({ cert: readFileSync(TLS_CERT_FILE), key: readFileSync(TLS_KEY_FILE) }, app)
  : createHttpServer(app);
attachWebSocketServer(server);

export { app, server };

// Guard so importing this module in tests doesn't also start a real listener.
if (import.meta.url === `file://${process.argv[1]}`) {
  imageUpdateService.restartScheduler();
  scheduledBackupService.restartScheduler();
  dockerEventBroadcaster.start();
  server.listen(PORT, HOST, () => {
    console.log(`Challoupe listening on ${tlsEnabled ? 'https' : 'http'}://${HOST}:${PORT}`);
  });
}
