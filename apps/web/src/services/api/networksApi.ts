import { api } from '../../api';
import type { NetworkSummary } from '../../models/NetworkSummary';
import type { NetworkCreateRequest } from '../../models/NetworkCreateRequest';

class NetworksApi {
  /**
   * List all networks
   * @param hostId string
   * @returns Network list
   */
  list(hostId: string) {
    return api.get<NetworkSummary[]>(`/hosts/${hostId}/networks`);
  }

  /**
   * Create new network
   * @param hostId string
   * @param values NetworkCreateRequest
   * @returns Create response
   */
  create(hostId: string, values: NetworkCreateRequest) {
    return api.post(`/hosts/${hostId}/networks`, values);
  }

  /**
   * Delete a network
   * @param hostId string
   * @param id string
   * @returns void
   */
  remove(hostId: string, id: string) {
    return api.delete(`/hosts/${hostId}/networks/${id}`);
  }
}

export const networksApi = new NetworksApi();
