import { api } from '../../api';
import type { VolumeSummary } from '../../models/VolumeSummary';
import type { VolumeCreateRequest } from '../../models/VolumeCreateRequest';

class VolumesApi {
  /**
   * Get all volumes
   * @param hostId string
   * @returns Volumes list
   */
  list(hostId: string) {
    return api.get<VolumeSummary[]>(`/hosts/${hostId}/volumes`);
  }

  /**
   * Create new volume
   * @param hostId string
   * @param values VolumeCreateRequest
   * @returns Creation response
   */
  create(hostId: string, values: VolumeCreateRequest) {
    return api.post(`/hosts/${hostId}/volumes`, values);
  }

  /**
   * Remove volume
   * @param hostId string 
   * @param name string
   * @returnsvoid 
   */
  remove(hostId: string, name: string) {
    return api.delete(`/hosts/${hostId}/volumes/${encodeURIComponent(name)}`);
  }

  /**
   * Prune volumes
   * @param hostId string 
   * @returns Prune response
   */
  prune(hostId: string) {
    return api.post<{ spaceReclaimed: number }>(`/hosts/${hostId}/volumes/prune`);
  }
}

export const volumesApi = new VolumesApi();
