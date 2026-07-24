import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceAlertSettings } from '../src/settings.js';

const mockInfo = vi.fn();
const mockListContainers = vi.fn();
const mockContainerStats = vi.fn();
const mockGetContainer = vi.fn(() => ({ stats: mockContainerStats }));
const mockSummarizeStats = vi.fn();

vi.mock('../src/docker.js', () => ({
  docker: { info: mockInfo, listContainers: mockListContainers, getContainer: mockGetContainer },
  summarizeStats: mockSummarizeStats,
}));

const mockCpuUsagePercent = vi.fn();
const mockRamUsage = vi.fn();
const mockDiskUsage = vi.fn();
vi.mock('../src/hostStats.js', () => ({
  cpuUsagePercent: mockCpuUsagePercent,
  ramUsage: mockRamUsage,
  diskUsage: mockDiskUsage,
}));

const mockNotifyResourceThreshold = vi.fn();
vi.mock('../src/integrations/notifications/notifications.js', () => ({
  notificationService: { notifyResourceThreshold: mockNotifyResourceThreshold },
}));

const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');
const { detectResourceAlerts, ResourceWatchdogService } = await import('../src/resourceWatchdog.js');

const THRESHOLDS: ResourceAlertSettings = {
  enabled: true,
  checkIntervalMinutes: 5,
  hostCpuPercent: 90,
  hostMemoryPercent: 90,
  hostDiskPercent: 90,
  containerCpuPercent: 90,
  containerMemoryPercent: 90,
};

describe('detectResourceAlerts', () => {
  const okHost = { cpuPercent: 10, memoryPercent: 10, diskPercent: 10 };

  it('returns nothing when everything is under threshold', () => {
    expect(detectResourceAlerts(okHost, [], THRESHOLDS)).toEqual([]);
  });

  it('flags host CPU over threshold', () => {
    expect(detectResourceAlerts({ ...okHost, cpuPercent: 95 }, [], THRESHOLDS)).toEqual([
      { signature: 'host:cpu', message: 'Host CPU usage at 95% (threshold 90%)' },
    ]);
  });

  it('flags host memory over threshold', () => {
    expect(detectResourceAlerts({ ...okHost, memoryPercent: 95 }, [], THRESHOLDS)).toEqual([
      { signature: 'host:memory', message: 'Host memory usage at 95% (threshold 90%)' },
    ]);
  });

  it('flags host disk over threshold', () => {
    expect(detectResourceAlerts({ ...okHost, diskPercent: 95 }, [], THRESHOLDS)).toEqual([
      { signature: 'host:disk', message: 'Host disk usage at 95% (threshold 90%)' },
    ]);
  });

  it('flags a container over its CPU threshold', () => {
    const containers = [{ id: 'abc123', name: 'myapp', cpuPercent: 97, memoryPercent: 10 }];
    expect(detectResourceAlerts(okHost, containers, THRESHOLDS)).toEqual([
      { signature: 'container:abc123:cpu', message: 'Container "myapp" CPU usage at 97% (threshold 90%)' },
    ]);
  });

  it('flags a container over its memory threshold', () => {
    const containers = [{ id: 'abc123', name: 'myapp', cpuPercent: 10, memoryPercent: 96 }];
    expect(detectResourceAlerts(okHost, containers, THRESHOLDS)).toEqual([
      { signature: 'container:abc123:memory', message: 'Container "myapp" memory usage at 96% (threshold 90%)' },
    ]);
  });

  it('does not combine thresholds across different containers', () => {
    const containers = [
      { id: 'abc', name: 'a', cpuPercent: 95, memoryPercent: 10 },
      { id: 'def', name: 'b', cpuPercent: 10, memoryPercent: 10 },
    ];
    expect(detectResourceAlerts(okHost, containers, THRESHOLDS)).toEqual([
      { signature: 'container:abc:cpu', message: 'Container "a" CPU usage at 95% (threshold 90%)' },
    ]);
  });

  it('can flag host and container findings at once', () => {
    const containers = [{ id: 'abc', name: 'a', cpuPercent: 95, memoryPercent: 96 }];
    expect(detectResourceAlerts({ ...okHost, cpuPercent: 95 }, containers, THRESHOLDS)).toHaveLength(3);
  });
});

describe('ResourceWatchdogService.checkNow', () => {
  beforeEach(() => {
    db.exec('DELETE FROM settings');
    vi.clearAllMocks();
    mockInfo.mockResolvedValue({ DockerRootDir: '/var/lib/docker' });
    mockCpuUsagePercent.mockResolvedValue(10);
    mockRamUsage.mockReturnValue({ total: 100, used: 10, percent: 10 });
    mockDiskUsage.mockResolvedValue({ total: 100, used: 10, percent: 10 });
    mockListContainers.mockResolvedValue([]);
  });

  it('does nothing when disabled (the default)', async () => {
    const service = new ResourceWatchdogService();
    await service.checkNow();
    expect(mockNotifyResourceThreshold).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it('notifies once when host CPU crosses the configured threshold', async () => {
    settingsService.update({ resourceAlerts: { enabled: true, hostCpuPercent: 90 } });
    mockCpuUsagePercent.mockResolvedValue(95);
    const service = new ResourceWatchdogService();
    await service.checkNow();
    expect(mockNotifyResourceThreshold).toHaveBeenCalledOnce();
    expect(mockNotifyResourceThreshold).toHaveBeenCalledWith(expect.stringContaining('Host CPU usage at 95%'));
  });

  it('notifies for a container that crosses its CPU threshold', async () => {
    settingsService.update({ resourceAlerts: { enabled: true, containerCpuPercent: 90 } });
    mockListContainers.mockResolvedValue([{ Id: 'abc123', Names: ['/myapp'] }]);
    mockContainerStats.mockResolvedValue({});
    mockSummarizeStats.mockReturnValue({ cpuPercent: 97, memoryPercent: 10 });
    const service = new ResourceWatchdogService();
    await service.checkNow();
    expect(mockNotifyResourceThreshold).toHaveBeenCalledWith(
      expect.stringContaining('Container "myapp" CPU usage at 97%')
    );
  });

  it('does not re-notify for the same ongoing alert on a later check', async () => {
    settingsService.update({ resourceAlerts: { enabled: true, hostCpuPercent: 90 } });
    mockCpuUsagePercent.mockResolvedValue(95);
    const service = new ResourceWatchdogService();
    await service.checkNow();
    await service.checkNow();
    expect(mockNotifyResourceThreshold).toHaveBeenCalledOnce();
  });

  it('swallows a per-container stats failure instead of throwing', async () => {
    settingsService.update({ resourceAlerts: { enabled: true } });
    mockListContainers.mockResolvedValue([{ Id: 'abc123', Names: ['/myapp'] }]);
    mockContainerStats.mockRejectedValue(new Error('no such container'));
    const service = new ResourceWatchdogService();
    await expect(service.checkNow()).resolves.toBeUndefined();
    expect(mockNotifyResourceThreshold).not.toHaveBeenCalled();
  });
});

describe('ResourceWatchdogService.restartScheduler', () => {
  beforeEach(() => {
    db.exec('DELETE FROM settings');
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockInfo.mockResolvedValue({ DockerRootDir: '/var/lib/docker' });
    mockCpuUsagePercent.mockResolvedValue(95);
    mockRamUsage.mockReturnValue({ total: 100, used: 10, percent: 10 });
    mockDiskUsage.mockResolvedValue({ total: 100, used: 10, percent: 10 });
    mockListContainers.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule a background check when disabled (the default)', async () => {
    const service = new ResourceWatchdogService();
    service.restartScheduler();
    await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000);
    expect(mockNotifyResourceThreshold).not.toHaveBeenCalled();
  });

  it('runs a check on the configured interval once enabled', async () => {
    settingsService.update({ resourceAlerts: { enabled: true, checkIntervalMinutes: 10, hostCpuPercent: 90 } });
    const service = new ResourceWatchdogService();
    service.restartScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(mockNotifyResourceThreshold).toHaveBeenCalledOnce();
  });
});
