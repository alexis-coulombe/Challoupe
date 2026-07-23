import { describe, expect, it, vi } from 'vitest';
import { formatBytes, runBulk, stripCodeFence } from '../src/utils';

describe('formatBytes', () => {
  it('renders zero bytes as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('renders whole bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('picks the right unit and rounds to one decimal above bytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('runBulk', () => {
  it('reports every item as ok when all succeed', async () => {
    const result = await runBulk([1, 2, 3], async () => undefined);
    expect(result).toEqual({ ok: 3, errors: [] });
  });

  it('collects error messages without stopping on failure', async () => {
    const fn = vi.fn(async (n: number) => {
      if (n === 2) throw new Error('boom');
    });
    const result = await runBulk([1, 2, 3], fn);
    expect(result.ok).toBe(2);
    expect(result.errors).toEqual(['boom']);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns zero ok and no errors for an empty list', async () => {
    const result = await runBulk([], async () => undefined);
    expect(result).toEqual({ ok: 0, errors: [] });
  });
});

describe('stripCodeFence', () => {
  it('returns plain text unchanged when there is no fence', () => {
    expect(stripCodeFence('services:\n  web:\n    image: nginx\n')).toBe(
      'services:\n  web:\n    image: nginx'
    );
  });

  it('strips a fence with a language tag', () => {
    expect(stripCodeFence('```yaml\nservices:\n  web:\n    image: nginx\n```')).toBe(
      'services:\n  web:\n    image: nginx'
    );
  });

  it('strips a bare fence with no language tag', () => {
    expect(stripCodeFence('```\nservices:\n  web:\n    image: nginx\n```')).toBe(
      'services:\n  web:\n    image: nginx'
    );
  });

  it('discards prose surrounding the fenced block', () => {
    const text =
      "Here's your compose file:\n```yaml\nservices:\n  web:\n    image: nginx\n```\nLet me know if you need changes!";
    expect(stripCodeFence(text)).toBe('services:\n  web:\n    image: nginx');
  });
});
