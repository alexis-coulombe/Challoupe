import { describe, expect, it } from 'vitest';
import { buildGitRemote, createLogDemuxer, demuxLogs, summarizeStats } from './docker.js';

function frame(streamType: number, payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe('demuxLogs', () => {
  it('decodes a single multiplexed frame', () => {
    const buf = frame(1, 'hello\n');
    expect(demuxLogs(buf)).toBe('hello\n');
  });

  it('concatenates multiple frames from stdout and stderr', () => {
    const buf = Buffer.concat([frame(1, 'stdout line\n'), frame(2, 'stderr line\n')]);
    expect(demuxLogs(buf)).toBe('stdout line\nstderr line\n');
  });

  it('returns an empty string for an empty buffer', () => {
    expect(demuxLogs(Buffer.alloc(0))).toBe('');
  });

  it('ignores a trailing partial frame', () => {
    const buf = Buffer.concat([frame(1, 'complete\n'), Buffer.from([1, 0, 0, 0])]);
    expect(demuxLogs(buf)).toBe('complete\n');
  });
});

describe('createLogDemuxer', () => {
  it('decodes a frame split across two push calls', () => {
    const demux = createLogDemuxer();
    const buf = frame(1, 'hello streaming world\n');
    const first = demux.push(buf.subarray(0, 5));
    const second = demux.push(buf.subarray(5));
    expect(first).toBe('');
    expect(second).toBe('hello streaming world\n');
  });

  it('decodes several complete frames pushed in one call', () => {
    const demux = createLogDemuxer();
    const buf = Buffer.concat([frame(1, 'one\n'), frame(1, 'two\n')]);
    expect(demux.push(buf)).toBe('one\ntwo\n');
  });

  it('holds back an incomplete trailing frame until completed', () => {
    const demux = createLogDemuxer();
    const buf = frame(1, 'complete\n');
    expect(demux.push(buf.subarray(0, buf.length - 2))).toBe('');
    expect(demux.push(buf.subarray(buf.length - 2))).toBe('complete\n');
  });
});

describe('buildGitRemote', () => {
  it('returns the plain URL when no ref or subdir is given', () => {
    expect(buildGitRemote('https://github.com/user/repo.git')).toBe(
      'https://github.com/user/repo.git'
    );
  });

  it('appends #ref when only a ref is given', () => {
    expect(buildGitRemote('https://github.com/user/repo.git', { ref: 'main' })).toBe(
      'https://github.com/user/repo.git#main'
    );
  });

  it('appends #:subdir when only a subdirectory is given', () => {
    expect(buildGitRemote('https://github.com/user/repo.git', { subdir: 'backend' })).toBe(
      'https://github.com/user/repo.git#:backend'
    );
  });

  it('appends #ref:subdir when both are given', () => {
    expect(
      buildGitRemote('https://github.com/user/repo.git', { ref: 'main', subdir: 'backend' })
    ).toBe('https://github.com/user/repo.git#main:backend');
  });
});

describe('summarizeStats', () => {
  it('computes CPU percent using the docker-stats-cli formula', () => {
    const sample = summarizeStats({
      read: '2026-01-01T00:00:00Z',
      cpu_stats: {
        cpu_usage: { total_usage: 2_000_000_000 },
        system_cpu_usage: 20_000_000_000,
        online_cpus: 2,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 1_000_000_000 },
        system_cpu_usage: 10_000_000_000,
      },
      memory_stats: { usage: 100_000_000, limit: 500_000_000, stats: { cache: 20_000_000 } },
      networks: { eth0: { rx_bytes: 1000, tx_bytes: 2000 } },
    });

    // cpuDelta=1e9, systemDelta=1e10 -> (1e9/1e10)*2*100 = 20%
    expect(sample.cpuPercent).toBeCloseTo(20, 5);
    expect(sample.memoryUsage).toBe(80_000_000); // usage minus cache
    expect(sample.memoryPercent).toBeCloseTo(16, 5); // 80e6 / 500e6
    expect(sample.networkRx).toBe(1000);
    expect(sample.networkTx).toBe(2000);
  });

  it('sums network bytes across multiple interfaces', () => {
    const sample = summarizeStats({
      read: '2026-01-01T00:00:00Z',
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: { usage: 0, limit: 0 },
      networks: {
        eth0: { rx_bytes: 100, tx_bytes: 200 },
        eth1: { rx_bytes: 50, tx_bytes: 25 },
      },
    });
    expect(sample.networkRx).toBe(150);
    expect(sample.networkTx).toBe(225);
  });

  it('returns zero percentages when deltas or limits are zero', () => {
    const sample = summarizeStats({
      read: '2026-01-01T00:00:00Z',
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: { usage: 0, limit: 0 },
    });
    expect(sample.cpuPercent).toBe(0);
    expect(sample.memoryPercent).toBe(0);
  });
});
