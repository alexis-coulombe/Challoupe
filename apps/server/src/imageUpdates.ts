import { docker } from './docker.js';
import { getRemoteDigest } from './registry.js';
import { getSettings } from './settings.js';

export interface ImageUpdateStatus {
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
}

const statusCache = new Map<string, ImageUpdateStatus>();

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

/**
 * Check local digest against remote digest
 * @param reference string
 * @param repoDigests string[] | undefined
 * @returns ImageUpdateStatus
 */
export async function checkImageUpdate(
  reference: string,
  repoDigests: string[] | undefined
): Promise<ImageUpdateStatus> {
  const checkedAt = new Date().toISOString();
  const localDigest = localDigestFor(repoDigests, reference);
  if (!localDigest) {
    const status: ImageUpdateStatus = {
      updateAvailable: null,
      checkedAt,
      error: 'No recorded pull digest to compare (built locally, or never pulled from a registry)',
    };
    statusCache.set(reference, status);
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
  statusCache.set(reference, status);
  return status;
}

export function getCachedUpdateStatus(reference: string): ImageUpdateStatus | undefined {
  return statusCache.get(reference);
}

interface CheckAllResult {
  checked: number;
  updatesAvailable: number;
  errors: string[];
}

/**
 * Checks every locally tagged image in parallel and reports a summary
 * @param ids string[]
 * @returns CheckAllResult
 */
export async function checkImageUpdates(ids?: string[]): Promise<CheckAllResult> {
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
    targets.map((t) => checkImageUpdate(t.reference, t.repoDigests))
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

let schedulerTimer: NodeJS.Timeout | null = null;

// Re-reads settings and (re)starts the background interval accordingly — called once at
// server startup and again after any settings update that touches `imageUpdateCheck`, the
// same cache-invalidation pattern as oidc.ts's resetOidcConfigCache().
export function restartImageUpdateScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  schedulerTimer = null;

  const { imageUpdateCheck } = getSettings();
  if (!imageUpdateCheck.enabled) {
    return;
  }

  const intervalMs = Math.max(1, imageUpdateCheck.intervalHours) * 60 * 60 * 1000;
  schedulerTimer = setInterval(() => {
    checkImageUpdates().catch((err) => console.error('Background image update check failed', err));
  }, intervalMs);
  schedulerTimer.unref?.();
}
