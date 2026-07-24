import { api } from '../api';
import type {
  GitBuildRequest,
  GitBuildResult,
  ImageSummary,
  ImageUpdateCheckSummary,
  ImageUpdateStatus,
} from '../api';

export class ImagesApi {
  list(hostId: string) {
    return api.get<ImageSummary[]>(`/hosts/${hostId}/images`);
  }

  pull(hostId: string, reference: string) {
    return api.post(`/hosts/${hostId}/images/pull`, { reference });
  }

  remove(hostId: string, ref: string) {
    return api.delete(`/hosts/${hostId}/images?ref=${encodeURIComponent(ref)}`);
  }

  prune(hostId: string) {
    return api.post<{ spaceReclaimed: number }>(`/hosts/${hostId}/images/prune`);
  }

  checkUpdate(hostId: string, id: string) {
    return api.post<ImageUpdateStatus>(`/hosts/${hostId}/images/${id}/check-update`);
  }

  checkUpdates(hostId: string) {
    return api.post<ImageUpdateCheckSummary>(`/hosts/${hostId}/images/check-updates`);
  }

  buildFromGit(hostId: string, body: GitBuildRequest) {
    return api.post<GitBuildResult>(`/hosts/${hostId}/images/build-from-git`, body);
  }
}

export const imagesApi = new ImagesApi();
