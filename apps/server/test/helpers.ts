import request from 'supertest';
import type { Express } from 'express';
import type { User } from '../src/auth.js';
import type { Permissions } from '../src/permissions.js';

export async function createAdminAgent(
  app: Express,
  username = 'admin',
  password = 'password123'
): Promise<{ agent: ReturnType<typeof request.agent>; user: User }> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/setup').send({ username, password });
  return { agent, user: res.body.user as User };
}

export async function createUserAgent(
  app: Express,
  adminAgent: ReturnType<typeof request.agent>,
  username: string,
  password = 'password123',
  role: 'admin' | 'user' = 'user',
  permissions: Partial<Permissions> = {}
): Promise<ReturnType<typeof request.agent>> {
  await adminAgent.post('/api/users').send({ username, password, role, permissions });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password });
  return agent;
}
