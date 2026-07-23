import { docker } from './docker.js';
import { notificationService } from './notifications.js';
import { getRemoteDigest } from './registry.js';
import { settingsService } from './settings.js';

export interface ImageUpdateStatus {
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
}

/**
 * Get local digest for the given reference
 * @param repoDigests string[] | undefined
 * @param reference string
 * @returns string | null
 */
function localDigestFor(repoDigests: string[] | undefined, reference: string): string | null {
  if (!repoDigests?.length) return null;
  const lastColon = reference.lastIndexOf(':');
  const lastSlash = reference.lastIndexOf('/');
  const repo = lastColon > lastSlash ? reference.slice(0, lastColon) : reference;
  const match = repoDigests.find((d) => d.startsWith(`${repo}@`));
  return match ? match.slice(match.indexOf('@') + 1) : null;
}

interface CheckAllResult {
  checked: number;
  updatesAvailable: number;
  errors: string[];
}

/**
 * Tracks per-image update-check results and the background polling interval that
 * refreshes them, replacing what used to be a module-level cache Map + timer variable.
 */
export class ImageUpdateService {
  private readonly statusCache = new Map<string, ImageUpdateStatus>();
  private schedulerTimer: NodeJS.Timeout | null = null;

  /**
   * Check local digest against remote digest
   * @param reference string
   * @param repoDigests string[] | undefined
   * @returns ImageUpdateStatus
   */
  async checkOne(reference: string, repoDigests: string[] | undefined): Promise<ImageUpdateStatus> {
    const checkedAt = new Date().toISOString();
    const localDigest = localDigestFor(repoDigests, reference);
    if (!localDigest) {
      const status: ImageUpdateStatus = {
        updateAvailable: null,
        checkedAt,
        error: 'No recorded pull digest to compare (built locally, or never pulled from a registry)',
      };
      this.statusCache.set(reference, status);
      return status;
    }

    let status: ImageUpdateStatus;
    try {
      const remoteDigest = await getRemoteDigest(reference);
      status = remoteDigest
        ? { updateAvailable: remoteDigest !== localDigest, checkedAt }
        : { updateAvailable: null, checkedAt, error: 'Could not reach the registry' };
    } catch (err) {
      status = { updateAvailable: null, checkedAt, error: (err as Error).message };
    }
    this.statusCache.set(reference, status);
    return status;
  }

  getCachedStatus(reference: string): ImageUpdateStatus | undefined {
    return this.statusCache.get(reference);
  }

  /**
   * Checks every locally tagged image in parallel and reports a summary
   * @param ids string[]
   * @returns CheckAllResult
   */
  async checkAll(ids?: string[]): Promise<CheckAllResult> {
    const images = await docker.listImages();
    const idFilter = ids ? new Set(ids) : null;
    const targets = images
      .filter((i) => !idFilter || idFilter.has(i.Id))
      .map((i) => ({
        reference: i.RepoTags?.find((t) => t !== '<none>:<none>'),
        repoDigests: i.RepoDigests,
      }))
      .filter((t): t is { reference: string; repoDigests: string[] | undefined } => !!t.reference);

    const results = await Promise.allSettled(
      targets.map((t) => this.checkOne(t.reference, t.repoDigests))
    );

    const errors: string[] = [];
    let updatesAvailable = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.updateAvailable) updatesAvailable++;
        if (result.value.error) errors.push(result.value.error);
      } else {
        errors.push((result.reason as Error).message);
      }
    }
    return { checked: targets.length, updatesAvailable, errors };
  }

  /**
   * Re-reads settings and (re)starts the background interval accordingly
   * @returns void
   */
  restartScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
    }

    this.schedulerTimer = null;

    const { imageUpdateCheck } = settingsService.get();
    if (!imageUpdateCheck.enabled) {
      return;
    }

    const intervalMs = Math.max(1, imageUpdateCheck.intervalHours) * 60 * 60 * 1000;
    this.schedulerTimer = setInterval(() => {
      this.checkAll()
        .then((result) => {
          if (result.updatesAvailable > 0) void notificationService.notifyImageUpdates(result.updatesAvailable);
        })
        .catch((err) => console.error('Background image update check failed', err));
    }, intervalMs);
    this.schedulerTimer.unref?.();
  }
}

export const imageUpdateService = new ImageUpdateService();
