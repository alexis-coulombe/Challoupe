import { api } from '../api';

export class AiApi {
  models(baseUrl: string) {
    return api.get<{ models: string[] }>(`/ai/models?baseUrl=${encodeURIComponent(baseUrl)}`);
  }
}

export const aiApi = new AiApi();
