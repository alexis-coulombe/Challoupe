import { api } from '../api';
import type { HostSummary } from '../api';

export interface HostFormValues {
  name: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKey: string;
  sshPassphrase?: string;
}

export type HostUpdate = Partial<HostFormValues>;

export interface HostTestResult {
  ok: boolean;
  error?: string;
}

export class HostsApi {
  list() {
    return api.get<HostSummary[]>('/hosts');
  }

  create(values: HostFormValues) {
    return api.post<HostSummary>('/hosts', values);
  }

  update(id: number, values: HostUpdate) {
    return api.put<HostSummary>(`/hosts/${id}`, values);
  }

  remove(id: number) {
    return api.delete(`/hosts/${id}`);
  }

  test(values: HostFormValues) {
    return api.post<HostTestResult>('/hosts/test', values);
  }

  testExisting(id: number) {
    return api.post<HostTestResult>(`/hosts/${id}/test`);
  }
}

export const hostsApi = new HostsApi();
