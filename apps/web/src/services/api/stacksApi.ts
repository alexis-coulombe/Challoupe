import { api } from '../../api';
import type { StackSummary } from '../../models/StackSummary';
import type { ComposeResult } from '../../models/ComposeResult';
import type { PortainerStackRef } from '../../models/PortainerStackRef';

interface StackDriftResult {
  inSync: boolean;
  missingServices: string[];
  orphanedContainers: Array<{ id: string; name: string; service: string | null }>;
  imageMismatches: Array<{ service: string; expectedImage: string; actualImage: string }>;
}

interface PortainerCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export class StacksApi {
  /**
   * Get all stacks
   * @returns Stack list
   */
  list() {
    return api.get<StackSummary[]>('/stacks');
  }

  /**
   * Get a stack
   * @param name string
   * @returns Create response
   */
  get(name: string) {
    return api.get<{ name: string; compose: string }>(`/stacks/${name}`);
  }

  /**
   * Check stack drift
   * @param name string
   * @returns Stack drift response
   */
  drift(name: string) {
    return api.get<StackDriftResult>(`/stacks/${name}/drift`);
  }

  /**
   * Create a stack
   * @param body { name: string; compose: string; deploy: boolean }
   * @returns Stack creation response
   */
  create(body: { name: string; compose: string; deploy: boolean }) {
    return api.post<{ name: string; deploy: ComposeResult | null }>('/stacks', body);
  }

  /**
   * Update a stack
   * @param name string
   * @param compose string
   * @returns Update stack response
   */
  update(name: string, compose: string) {
    return api.put(`/stacks/${name}`, { compose });
  }

  /**
   * Deploy a stack
   * @param name string
   * @returns Deploy response
   */
  deploy(name: string) {
    return api.post<ComposeResult>(`/stacks/${name}/deploy`);
  }

  /**
   * Down a stack
   * @param name string
   * @returns Down response
   */
  down(name: string) {
    return api.post<ComposeResult>(`/stacks/${name}/down`);
  }

  /**
   * Delete stack
   * @param name string
   * @returns void
   */
  remove(name: string) {
    return api.delete(`/stacks/${name}`);
  }

  /**
   * Get stack webhook
   * @param name string
   * @returns Stack webhook response
   */
  getWebhook(name: string) {
    return api.get<{ configured: boolean; createdAt?: string }>(`/stacks/${name}/webhook`);
  }

  /**
   * Regenerate stack webhook
   * @param name string
   * @returns Regenerate response
   */
  regenerateWebhook(name: string) {
    return api.post<{ token: string }>(`/stacks/${name}/webhook`);
  }

  /**
   * Revoke stack webhook
   * @param name string
   * @returns void
   */
  revokeWebhook(name: string) {
    return api.delete(`/stacks/${name}/webhook`);
  }

  /**
   * Get stacks from portainer
   * @param creds PortainerCredentials
   * @returns Portainer stacks list
   */
  listPortainer(creds: PortainerCredentials) {
    return api.post<PortainerStackRef[]>('/stacks/portainer/list', creds);
  }

  /**
   * Import stack from portainer
   * @param body PortainerCredentials
   * @returns Import response
   */
  importPortainer(body: PortainerCredentials & { id: number; name: string }) {
    return api.post<{ name: string }>('/stacks/portainer/import', body);
  }
}

export const stacksApi = new StacksApi();
