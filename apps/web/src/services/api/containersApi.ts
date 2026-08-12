import { api } from '../../api';
import type { ContainerSummary } from '../../models/ContainerSummary';
import type { ContainerCreateRequest } from '../../models/ContainerCreateRequest';

interface ContainerInspect {
  Id: string;
  Name: string;
  Created: string;
  State: { Status: string; StartedAt: string; ExitCode: number };
  Config: { Image: string; Env: string[]; Tty: boolean };
  HostConfig: { RestartPolicy: { Name: string } };
  NetworkSettings: {
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  Mounts: Array<{ Type: string; Source: string; Destination: string; Name?: string }>;
}

class ContainersApi {
  /**
   * List all containers
   * @param hostId string
   * @returns Container list
   */
  list(hostId: string) {
    return api.get<ContainerSummary[]>(`/hosts/${hostId}/containers`);
  }

  /**
   * Get a container by id
   * @param hostId string
   * @param id string
   * @returns Container response
   */
  get(hostId: string, id: string) {
    return api.get<ContainerInspect>(`/hosts/${hostId}/containers/${id}`);
  }

  /**
   * Create a new container
   * @param hostId string
   * @param body ContainerCreateRequest
   * @returns New container response
   */
  create(hostId: string, body: ContainerCreateRequest) {
    return api.post<{ id: string }>(`/hosts/${hostId}/containers`, body);
  }

  action(hostId: string, id: string, action: string) {
    return api.post(`/hosts/${hostId}/containers/${id}/actions/${action}`);
  }

  /**
   * Remove a container
   * @param hostId string
   * @param id string
   * @returns void
   */
  remove(hostId: string, id: string) {
    return api.delete(`/hosts/${hostId}/containers/${id}?force=true`);
  }
}

export const containersApi = new ContainersApi();
