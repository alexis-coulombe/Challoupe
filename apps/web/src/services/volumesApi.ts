import { api } from '../api';
import type { VolumeSummary } from '../api';

export class VolumesApi {
  list() {
    return api.get<VolumeSummary[]>('/volumes');
  }

  create(values: { name: string; driver: string }) {
    return api.post('/volumes', values);
  }

  remove(name: string) {
    return api.delete(`/volumes/${encodeURIComponent(name)}`);
  }

  prune() {
    return api.post<{ spaceReclaimed: number }>('/volumes/prune');
  }
}

export const volumesApi = new VolumesApi();
