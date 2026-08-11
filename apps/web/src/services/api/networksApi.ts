import { api } from '../api';
import type { NetworkSummary } from '../api';

export class NetworksApi {
  list(hostId: string) {
    return api.get<NetworkSummary[]>(`/hosts/${hostId}/networks`);
  }

  create(hostId: string, values: { name: string; driver: string }) {
    return api.post(`/hosts/${hostId}/networks`, values);
  }

  remove(hostId: string, id: string) {
    return api.delete(`/hosts/${hostId}/networks/${id}`);
  }
}

export const networksApi = new NetworksApi();
