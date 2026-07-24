import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDocker = { listImages: vi.fn() };
vi.mock('../src/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docker.js')>();
  return { ...actual, docker: mockDocker };
});

const mockGetRemoteDigest = vi.fn();
vi.mock('../src/integrations/registry/registry.js', () => ({ getRemoteDigest: mockGetRemoteDigest }));

const mockNotifyImageUpdates = vi.fn();
vi.mock('../src/integrations/notifications/notifications.js', () => ({
  notificationService: { notifyImageUpdates: mockNotifyImageUpdates },
}));

const { imageUpdateService } = await import('../src/imageUpdates.js');
const { db } = await import('../src/db.js');
const { settingsService } = await import('../src/settings.js');
const { hostManager } = await import('../src/hostManager.js');
const { hostRepository } = await import('../src/hosts.js');

beforeEach(() => {
  db.exec('DELETE FROM settings');
  vi.clearAllMocks();
});

describe('checkImageUpdate', () => {
  it('reports an available update when the remote digest differs from the local one', async () => {
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    const status = await imageUpdateService.checkOne('local', 'app-a:v1', ['app-a@sha256:old']);
    expect(status.updateAvailable).toBe(true);
    expect(status.error).toBeUndefined();
  });

  it('reports up to date when the digests match', async () => {
    mockGetRemoteDigest.mockResolvedValue('sha256:same');
    const status = await imageUpdateService.checkOne('local', 'app-b:v1', ['app-b@sha256:same']);
    expect(status.updateAvailable).toBe(false);
  });

  it('reports unknown when there is no matching local RepoDigest to compare against', async () => {
    const status = await imageUpdateService.checkOne('local', 'app-c:v1', undefined);
    expect(status.updateAvailable).toBeNull();
    expect(status.error).toMatch(/No recorded pull digest/);
    expect(mockGetRemoteDigest).not.toHaveBeenCalled();
  });

  it('reports unknown when the registry could not be reached', async () => {
    mockGetRemoteDigest.mockResolvedValue(null);
    const status = await imageUpdateService.checkOne('local', 'app-d:v1', ['app-d@sha256:old']);
    expect(status.updateAvailable).toBeNull();
    expect(status.error).toMatch(/Could not reach/);
  });

  it('reports unknown and captures the error when the registry check throws', async () => {
    mockGetRemoteDigest.mockRejectedValue(new Error('network down'));
    const status = await imageUpdateService.checkOne('local', 'app-e:v1', ['app-e@sha256:old']);
    expect(status.updateAvailable).toBeNull();
    expect(status.error).toBe('network down');
  });

  it('caches the result for later retrieval by reference', async () => {
    mockGetRemoteDigest.mockResolvedValue('sha256:same');
    await imageUpdateService.checkOne('local', 'app-f:v1', ['app-f@sha256:same']);
    expect(imageUpdateService.getCachedStatus('local', 'app-f:v1')?.updateAvailable).toBe(false);
  });

  it('caches independently per host, since the same reference can exist on different hosts', async () => {
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    await imageUpdateService.checkOne('local', 'app-shared:v1', ['app-shared@sha256:old']);
    expect(imageUpdateService.getCachedStatus('local', 'app-shared:v1')?.updateAvailable).toBe(true);
    expect(imageUpdateService.getCachedStatus('7', 'app-shared:v1')).toBeUndefined();
  });
});

describe('checkImageUpdates', () => {
  it('checks every locally tagged image and summarizes the results, skipping untagged ones', async () => {
    mockDocker.listImages.mockResolvedValue([
      { Id: 'i1', RepoTags: ['app-g:v1'], RepoDigests: ['app-g@sha256:old'] },
      { Id: 'i2', RepoTags: ['<none>:<none>'], RepoDigests: undefined },
      { Id: 'i3', RepoTags: ['app-h:v1'], RepoDigests: ['app-h@sha256:same'] },
    ]);
    mockGetRemoteDigest.mockImplementation(async (ref: string) =>
      ref === 'app-g:v1' ? 'sha256:new' : 'sha256:same'
    );
    const result = await imageUpdateService.checkAll('local', mockDocker as never);
    expect(result.checked).toBe(2);
    expect(result.updatesAvailable).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('restricts the check to the given image ids', async () => {
    mockDocker.listImages.mockResolvedValue([
      { Id: 'i1', RepoTags: ['app-i:v1'], RepoDigests: ['app-i@sha256:old'] },
      { Id: 'i2', RepoTags: ['app-j:v1'], RepoDigests: ['app-j@sha256:old'] },
    ]);
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    const result = await imageUpdateService.checkAll('local', mockDocker as never, ['i2']);
    expect(result.checked).toBe(1);
    expect(mockGetRemoteDigest).toHaveBeenCalledWith('app-j:v1');
  });
});

describe('restartImageUpdateScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule a background check when disabled (the default)', () => {
    imageUpdateService.restartScheduler();
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
    expect(mockDocker.listImages).not.toHaveBeenCalled();
  });

  it('runs a check on the configured interval once enabled', async () => {
    settingsService.update({ imageUpdateCheck: { enabled: true, intervalHours: 2 } });
    mockDocker.listImages.mockResolvedValue([]);
    imageUpdateService.restartScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(mockDocker.listImages).toHaveBeenCalledTimes(1);
  });

  it('sends a notification when the scheduled check finds an update, not when it finds none', async () => {
    settingsService.update({ imageUpdateCheck: { enabled: true, intervalHours: 1 } });
    mockDocker.listImages.mockResolvedValue([
      { Id: 'i1', RepoTags: ['app-k:v1'], RepoDigests: ['app-k@sha256:old'] },
    ]);
    mockGetRemoteDigest.mockResolvedValue('sha256:new');
    imageUpdateService.restartScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockNotifyImageUpdates).toHaveBeenCalledWith(1);

    mockNotifyImageUpdates.mockClear();
    mockGetRemoteDigest.mockResolvedValue('sha256:old');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockNotifyImageUpdates).not.toHaveBeenCalled();
  });

  it('sums updatesAvailable across every registered host, not just local', async () => {
    db.exec('DELETE FROM hosts');
    const host = hostRepository.create({
      name: 'remote-1',
      sshHost: '10.0.0.5',
      sshPort: 22,
      sshUsername: 'deploy',
      sshPrivateKey: 'key',
      createdBy: 1,
    });

    mockDocker.listImages.mockResolvedValue([
      { Id: 'i1', RepoTags: ['app-local:v1'], RepoDigests: ['app-local@sha256:old'] },
    ]);
    const remoteListImages = vi
      .fn()
      .mockResolvedValue([{ Id: 'i2', RepoTags: ['app-remote:v1'], RepoDigests: ['app-remote@sha256:old'] }]);
    const remoteClient = { listImages: remoteListImages };
    vi.spyOn(hostManager, 'getClient').mockImplementation(async (hostId: string) => {
      if (hostId === 'local') return mockDocker as never;
      if (hostId === String(host.id)) return remoteClient as never;
      return null;
    });
    mockGetRemoteDigest.mockResolvedValue('sha256:new');

    settingsService.update({ imageUpdateCheck: { enabled: true, intervalHours: 1 } });
    imageUpdateService.restartScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(remoteListImages).toHaveBeenCalledOnce();
    expect(mockNotifyImageUpdates).toHaveBeenCalledWith(2);

    vi.restoreAllMocks();
    db.exec('DELETE FROM hosts');
  });
});
