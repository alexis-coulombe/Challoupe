import { api } from '../../api';

interface SystemInfo {
  name: string;
  containers: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  serverVersion: string;
  apiVersion: string;
  os: string;
  kernel: string;
  arch: string;
  cpus: number;
  memory: number;
  cpuPercent: number | null;
  memoryUsed: number | null;
  memoryPercent: number | null;
  storageUsed: number | null;
  storageTotal: number | null;
  storagePercent: number | null;
  dockerSock: string | null;
  dataDir: string | null;
}

class SystemApi {
  /**
   * Get system info
   * @param hostId string
   * @returns System info response
   */
  info(hostId: string) {
    return api.get<SystemInfo>(`/hosts/${hostId}/system/info`);
  }
}

export const systemApi = new SystemApi();
