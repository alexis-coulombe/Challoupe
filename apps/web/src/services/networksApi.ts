import { api } from '../api';
import type { NetworkSummary } from '../api';

export class NetworksApi {
  list() {
    return api.get<NetworkSummary[]>('/networks');
  }

  create(values: { name: string; driver: string }) {
    return api.post('/networks', values);
  }

  remove(id: string) {
    return api.delete(`/networks/${id}`);
  }
}

export const networksApi = new NetworksApi();
