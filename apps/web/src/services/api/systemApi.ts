import { api } from '../api';
import type { SystemInfo } from '../api';

export class SystemApi {
  info(hostId: string) {
    return api.get<SystemInfo>(`/hosts/${hostId}/system/info`);
  }
}

export const systemApi = new SystemApi();
