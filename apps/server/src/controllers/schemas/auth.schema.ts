import { z } from 'zod';

export const usernameSchema = z.string().trim().min(1).max(64);
export const newPasswordSchema = z.string().min(8).max(128);
export const setupSchema = z.object({ username: usernameSchema, password: newPasswordSchema });
export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });
export const totpVerifySchema = z.object({ token: z.string().trim().min(6).max(11) });
export const totpConfirmSchema = z.object({ token: z.string().trim().length(6) });
export const passwordConfirmSchema = z.object({ password: z.string() });
export const changePasswordSchema = z.object({ current: z.string(), next: newPasswordSchema });
