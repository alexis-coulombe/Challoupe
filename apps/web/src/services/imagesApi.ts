import { api } from '../api';
import type {
  GitBuildRequest,
  GitBuildResult,
  ImageSummary,
  ImageUpdateCheckSummary,
  ImageUpdateStatus,
} from '../api';

export class ImagesApi {
  list() {
    return api.get<ImageSummary[]>('/images');
  }

  pull(reference: string) {
    return api.post('/images/pull', { reference });
  }

  remove(ref: string) {
    return api.delete(`/images?ref=${encodeURIComponent(ref)}`);
  }

  prune() {
    return api.post<{ spaceReclaimed: number }>('/images/prune');
  }

  checkUpdate(id: string) {
    return api.post<ImageUpdateStatus>(`/images/${id}/check-update`);
  }

  checkUpdates() {
    return api.post<ImageUpdateCheckSummary>('/images/check-updates');
  }

  buildFromGit(body: GitBuildRequest) {
    return api.post<GitBuildResult>('/images/build-from-git', body);
  }
}

export const imagesApi = new ImagesApi();
