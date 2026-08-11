import { api } from '../api';
import type { VolumeSummary } from '../api';

export class VolumesApi {
  list(hostId: string) {
    return api.get<VolumeSummary[]>(`/hosts/${hostId}/volumes`);
  }

  create(hostId: string, values: { name: string; driver: string }) {
    return api.post(`/hosts/${hostId}/volumes`, values);
  }

  remove(hostId: string, name: string) {
    return api.delete(`/hosts/${hostId}/volumes/${encodeURIComponent(name)}`);
  }

  prune(hostId: string) {
    return api.post<{ spaceReclaimed: number }>(`/hosts/${hostId}/volumes/prune`);
  }
}

export const volumesApi = new VolumesApi();
