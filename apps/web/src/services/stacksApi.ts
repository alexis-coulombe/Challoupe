import { api } from '../api';
import type { ComposeResult, PortainerStackRef, StackDriftResult, StackSummary } from '../api';

export interface PortainerCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export class StacksApi {
  list() {
    return api.get<StackSummary[]>('/stacks');
  }

  get(name: string) {
    return api.get<{ name: string; compose: string }>(`/stacks/${name}`);
  }

  drift(name: string) {
    return api.get<StackDriftResult>(`/stacks/${name}/drift`);
  }

  create(body: { name: string; compose: string; deploy: boolean }) {
    return api.post<{ name: string; deploy: ComposeResult | null }>('/stacks', body);
  }

  update(name: string, compose: string) {
    return api.put(`/stacks/${name}`, { compose });
  }

  deploy(name: string) {
    return api.post<ComposeResult>(`/stacks/${name}/deploy`);
  }

  down(name: string) {
    return api.post<ComposeResult>(`/stacks/${name}/down`);
  }

  remove(name: string) {
    return api.delete(`/stacks/${name}`);
  }

  listPortainer(creds: PortainerCredentials) {
    return api.post<PortainerStackRef[]>('/stacks/portainer/list', creds);
  }

  importPortainer(body: PortainerCredentials & { id: number; name: string }) {
    return api.post<{ name: string }>('/stacks/portainer/import', body);
  }
}

export const stacksApi = new StacksApi();
