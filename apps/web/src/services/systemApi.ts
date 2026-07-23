import { api } from '../api';
import type { SystemInfo } from '../api';

export class SystemApi {
  info() {
    return api.get<SystemInfo>('/system/info');
  }
}

export const systemApi = new SystemApi();
