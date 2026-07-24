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
  list(hostId: string) {
    return api.get<ContainerSummary[]>(`/hosts/${hostId}/containers`);
  }

  get(hostId: string, id: string) {
    return api.get<ContainerInspect>(`/hosts/${hostId}/containers/${id}`);
  }

  create(hostId: string, body: ContainerCreateRequest) {
    return api.post<{ id: string }>(`/hosts/${hostId}/containers`, body);
  }

  action(hostId: string, id: string, action: string) {
    return api.post(`/hosts/${hostId}/containers/${id}/actions/${action}`);
  }

  // Always force-removed, the only mode any page uses.
  remove(hostId: string, id: string) {
    return api.delete(`/hosts/${hostId}/containers/${id}?force=true`);
  }
}

export const containersApi = new ContainersApi();
