import { api } from '../api';
import type { TrivyScanResult } from '../api';

export class TrivyApi {
  scan(image: string) {
    return api.post<TrivyScanResult>('/trivy/scan', { image });
  }
}

export const trivyApi = new TrivyApi();
