import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import type { StackSummary, TrivySeverity } from './api';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Strips a ```lang fence from LLM output, in case it added one anyway.
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /```[^\n]*\n([\s\S]*?)```/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

// Shared severity color scale for usage meters and sparklines: blue < 60% < orange < 85% < red.
export function usageColor(percent: number): string {
  if (percent >= 85) return '#ff4d4f';
  if (percent >= 60) return '#faad14';
  return '#3b82f6';
}

export function fromUnix(seconds: number): string {
  return dayjs.unix(seconds).fromNow();
}

// SQLite's `datetime('now')` returns UTC with no timezone marker (e.g. "2026-07-17
// 23:56:30"); parsed as plain dayjs() that reads as local time instead, so it must be
// parsed as UTC explicitly before converting to the browser's local time.
function parseUtc(date: string) {
  return dayjs.utc(date).local();
}

export function fromISO(date: string): string {
  return parseUtc(date).fromNow();
}

export function formatDateTime(date: string): string {
  return parseUtc(date).format('YYYY-MM-DD HH:mm:ss');
}

export interface BulkResult {
  ok: number;
  errors: string[];
}

// Run an operation on each item sequentially, collecting failures.
export async function runBulk<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>
): Promise<BulkResult> {
  let ok = 0;
  const errors: string[] = [];
  for (const item of items) {
    try {
      await fn(item);
      ok++;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { ok, errors };
}

// Shared antd Table pagination config: a page of 20, hidden entirely for shorter lists.
export const TABLE_PAGINATION = { pageSize: 20, hideOnSinglePage: true } as const;

// The one accent reserved for AI/Ollama-powered features, kept distinct from the blue
// brand/primary color so an "AI" touchpoint is recognizable at a glance.
export const AI_COLOR = '#8b5cf6';
export const AI_COLOR_SOFT = 'rgba(139, 92, 246, 0.14)';
export const AI_COLOR_BORDER = 'rgba(139, 92, 246, 0.35)';

// The accent reserved for the Trivy-powered vulnerability scanner, distinct from the blue
// brand color and the violet AI accent.
export const SECURITY_COLOR = '#14b8a6';
export const SECURITY_COLOR_BORDER = 'rgba(20, 184, 166, 0.35)';

// Shared "console output" look for command/build/log text (container logs, stack deploy
// output, AI-generated stacks, git build logs). Pair with a feature's own *_BORDER token
// instead of CONSOLE_BORDER when the box should read as belonging to that feature.
export const CONSOLE_BG = '#0b0e14';
export const CONSOLE_BORDER = '#1f2733';
export const CONSOLE_TEXT = '#c9d1d9';

// Traffic-light scale for vulnerability severities, independent of the usage-meter scale above.
export const SEVERITY_COLORS: Record<TrivySeverity, string> = {
  CRITICAL: 'red',
  HIGH: 'orange',
  MEDIUM: 'gold',
  LOW: 'blue',
  UNKNOWN: 'default',
};

export const STACK_STATUS: Record<StackSummary['status'], { color: string; label: string }> = {
  running: { color: 'green', label: 'running' },
  partial: { color: 'orange', label: 'partial' },
  stopped: { color: 'red', label: 'stopped' },
  inactive: { color: 'default', label: 'inactive' },
};

export const CONTAINER_STATE_COLORS: Record<string, string> = {
  running: 'green',
  exited: 'red',
  paused: 'orange',
  created: 'blue',
  restarting: 'gold',
  removing: 'volcano',
  dead: 'magenta',
};
