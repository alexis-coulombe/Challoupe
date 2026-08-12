import { api } from '../../api';
import type { ImageSummary } from '../../models/ImageSummary';
import type { ImageUpdateStatus } from '../../models/ImageUpdateStatus';
import type { ImageUpdateCheckSummary } from '../../models/ImageUpdateCheckSummary';

interface GitBuildRequest {
  repoUrl: string;
  ref?: string;
  subdir?: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: string[];
}

interface GitBuildResult {
  ok: boolean;
  tag: string;
  log: string;
  error?: string;
}

class ImagesApi {
  /**
   * List all images
   * @param hostId string
   * @returns Image list
   */
  list(hostId: string) {
    return api.get<ImageSummary[]>(`/hosts/${hostId}/images`);
  }

  /**
   * Pull an image from registry
   * @param hostId string
   * @param reference string
   * @returns Pull response
   */
  pull(hostId: string, reference: string) {
    return api.post(`/hosts/${hostId}/images/pull`, { reference });
  }

  /**
   * Delete an image
   * @param hostId string
   * @param ref string
   * @returns void
   */
  remove(hostId: string, ref: string) {
    return api.delete(`/hosts/${hostId}/images?ref=${encodeURIComponent(ref)}`);
  }

  /**
   * Prune images
   * @param hostId string
   * @returns Prune response
   */
  prune(hostId: string) {
    return api.post<{ spaceReclaimed: number }>(`/hosts/${hostId}/images/prune`);
  }

  /**
   * Check updates for an image
   * @param hostId string
   * @param id string
   * @returns Update response
   */
  checkUpdate(hostId: string, id: string) {
    return api.post<ImageUpdateStatus>(`/hosts/${hostId}/images/${id}/check-update`);
  }

  /**
   * Check updated for all images
   * @param hostId string
   * @returns Update response
   */
  checkUpdates(hostId: string) {
    return api.post<ImageUpdateCheckSummary>(`/hosts/${hostId}/images/check-updates`);
  }

  /**
   * Build image from git repository
   * @param hostId string
   * @param body GitBuildRequest
   * @returns Build response
   */
  buildFromGit(hostId: string, body: GitBuildRequest) {
    return api.post<GitBuildResult>(`/hosts/${hostId}/images/build-from-git`, body);
  }
}

export const imagesApi = new ImagesApi();
