import { api } from '../../api';

class AiApi {
  /**
   * Get models from ollama instance
   * @param baseUrl string
   * @returns Models list
   */
  models(baseUrl: string) {
    return api.get<{ models: string[] }>(`/ai/models?baseUrl=${encodeURIComponent(baseUrl)}`);
  }
}

export const aiApi = new AiApi();
