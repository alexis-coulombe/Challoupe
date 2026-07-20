import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { cpuUsagePercent, diskUsage, ramUsage } from './hostStats.js';

describe('ramUsage', () => {
  it('reports a percentage consistent with total and used', () => {
    const { total, used, percent } = ramUsage();
    expect(total).toBeGreaterThan(0);
    expect(used).toBeGreaterThanOrEqual(0);
    expect(used).toBeLessThanOrEqual(total);
    expect(percent).toBeCloseTo((used / total) * 100, 0);
  });
});

describe('cpuUsagePercent', () => {
  it('returns a value between 0 and 100', async () => {
    const percent = await cpuUsagePercent(20);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  });
});

describe('diskUsage', () => {
  it('reports a percentage consistent with total and used for a real path', async () => {
    const { total, used, percent } = await diskUsage(os.tmpdir());
    expect(total).toBeGreaterThan(0);
    expect(used).toBeGreaterThanOrEqual(0);
    expect(used).toBeLessThanOrEqual(total);
    expect(percent).toBeCloseTo((used / total) * 100, 0);
  });
});
