import type Docker from 'dockerode';
import { hostManager } from './hostManager.js';
import { allHostIds } from './hosts.js';
import { notificationService } from './integrations/notifications/notifications.js';
import { getRemoteDigest } from './integrations/registry/registry.js';
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
  // Keyed by `${hostId}:${reference}` since the same image reference can independently exist
  // on different hosts, each with its own update status.
  private readonly statusCache = new Map<string, ImageUpdateStatus>();
  private schedulerTimer: NodeJS.Timeout | null = null;

  private cacheKey(hostId: string, reference: string): string {
    return `${hostId}:${reference}`;
  }

  /**
   * Check local digest against remote digest
   * @param hostId string
   * @param reference string
   * @param repoDigests string[] | undefined
   * @returns ImageUpdateStatus
   */
  async checkOne(hostId: string, reference: string, repoDigests: string[] | undefined): Promise<ImageUpdateStatus> {
    const checkedAt = new Date().toISOString();
    const localDigest = localDigestFor(repoDigests, reference);
    if (!localDigest) {
      const status: ImageUpdateStatus = {
        updateAvailable: null,
        checkedAt,
        error: 'No recorded pull digest to compare (built locally, or never pulled from a registry)',
      };
      this.statusCache.set(this.cacheKey(hostId, reference), status);
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
    this.statusCache.set(this.cacheKey(hostId, reference), status);
    return status;
  }

  getCachedStatus(hostId: string, reference: string): ImageUpdateStatus | undefined {
    return this.statusCache.get(this.cacheKey(hostId, reference));
  }

  /**
   * Checks every tagged image on the given host in parallel and reports a summary
   * @param hostId string
   * @param client Docker
   * @param ids string[]
   * @returns CheckAllResult
   */
  async checkAll(hostId: string, client: Docker, ids?: string[]): Promise<CheckAllResult> {
    const images = await client.listImages();
    const idFilter = ids ? new Set(ids) : null;
    const targets = images
      .filter((i) => !idFilter || idFilter.has(i.Id))
      .map((i) => ({
        reference: i.RepoTags?.find((t) => t !== '<none>:<none>'),
        repoDigests: i.RepoDigests,
      }))
      .filter((t): t is { reference: string; repoDigests: string[] | undefined } => !!t.reference);

    const results = await Promise.allSettled(
      targets.map((t) => this.checkOne(hostId, t.reference, t.repoDigests))
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

  private async runScheduledCheck(): Promise<void> {
    let totalUpdatesAvailable = 0;
    for (const hostId of allHostIds()) {
      try {
        const client = await hostManager.getClient(hostId);
        if (!client) continue;
        const result = await this.checkAll(hostId, client);
        totalUpdatesAvailable += result.updatesAvailable;
      } catch (err) {
        console.error(`Background image update check failed for host ${hostId}`, err);
      }
    }
    if (totalUpdatesAvailable > 0) void notificationService.notifyImageUpdates(totalUpdatesAvailable);
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
      void this.runScheduledCheck();
    }, intervalMs);
    this.schedulerTimer.unref?.();
  }
}

export const imageUpdateService = new ImageUpdateService();
