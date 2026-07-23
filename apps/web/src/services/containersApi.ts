import { api } from '../api';
import type { ContainerInspect, ContainerSummary } from '../api';

export interface ContainerCreateRequest {
  name?: string;
  image: string;
  network?: string;
  command: string[];
  workingDir?: string;
  user?: string;
  labels: string[];
  env: string[];
  ports: Array<{ host: number; container: number; protocol: 'tcp' | 'udp' }>;
  volumes: Array<{ host: string; container: string }>;
  restartPolicy: string;
  privileged: boolean;
  autoRemove: boolean;
  memoryMb?: number;
  cpus?: number;
}

export class ContainersApi {
  list() {
    return api.get<ContainerSummary[]>('/containers');
  }

  get(id: string) {
    return api.get<ContainerInspect>(`/containers/${id}`);
  }

  create(body: ContainerCreateRequest) {
    return api.post<{ id: string }>('/containers', body);
  }

  action(id: string, action: string) {
    return api.post(`/containers/${id}/actions/${action}`);
  }

  // Always force-removed, the only mode any page uses.
  remove(id: string) {
    return api.delete(`/containers/${id}?force=true`);
  }
}

export const containersApi = new ContainersApi();
