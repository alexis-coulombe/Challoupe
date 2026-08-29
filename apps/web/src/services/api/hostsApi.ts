import { api } from '../../api';
import type { HostSummary } from '../../models/HostSummary';
import type { HostFormValues } from '../../models/HostFormValues';

export type HostUpdate = Partial<HostFormValues>;

interface HostTestResult {
  ok: boolean;
  error?: string;
}

class HostsApi {
  /**
   * List all hosts
   * @returns Hosts list
   */
  list() {
    return api.get<HostSummary[]>('/hosts');
  }

  /**
   * Create a new host
   * @param values HostFormValues
   * @returns New host response
   */
  create(values: HostFormValues) {
    return api.post<HostSummary>('/hosts', values);
  }

  /**
   * Update a host
   * @param id number
   * @param values HostUpdate
   * @returns Update host response
   */
  update(id: number, values: HostUpdate) {
    return api.put<HostSummary>(`/hosts/${id}`, values);
  }

  /**
   * Remove a host
   * @param id number
   * @returns void
   */
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
