import type { IncomingMessage, ServerResponse } from 'node:http';
import { sessionMiddleware, userRepository, type User } from './auth.js';

// A WebSocket upgrade request has no real HTTP response to write to, but
// express-session needs a (req, res, next)-shaped call to read the session.
// This stub satisfies the methods it touches on a read-only pass (no new
// cookie is ever issued here, since we only ever read an existing session).
function fakeResponse(): ServerResponse {
  const res: Record<string, (...args: unknown[]) => unknown> = {};
  const noop = () => res;
  for (const method of ['getHeader', 'setHeader', 'end', 'on', 'once', 'removeHeader', 'writeHead']) {
    res[method] = noop;
  }
  res.emit = () => false;
  return res as unknown as ServerResponse;
}

export function authenticateUpgrade(req: IncomingMessage): Promise<User | null> {
  return new Promise((resolve) => {
    sessionMiddleware(req as never, fakeResponse() as never, () => {
      const userId = (req as unknown as { session?: { userId?: number } }).session?.userId;
      resolve(userId ? (userRepository.getById(userId) ?? null) : null);
    });
  });
}
