import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { containersApi } from './api/containersApi';
import { networksApi } from './api/networksApi';
import { runBulk } from '../utils';
import type { ContainerSummary } from '../models/ContainerSummary';
import type { ContainerCreateRequest } from '../models/ContainerCreateRequest';
import type { ContainerFormValues } from '../models/ContainerFormValues';

/**
 * Framework-agnostic container domain logic
 */
class ContainersService {
  private readonly pastTense: Record<string, string> = {
    start: 'started',
    stop: 'stopped',
    restart: 'restarted',
    pause: 'paused',
    kill: 'killed',
    remove: 'deleted',
  };

  bulkActionLabel(action: string, count: number): string {
    return `${count} container(s) ${this.pastTense[action] ?? action}`;
  }

  /**
   * Distinct container states present, for the State column's filter dropdown.
   * @param containers ContainerSummary[]
   * @returns Filtered containers
   */
  stateFilters(containers: ContainerSummary[]): Array<{ text: string; value: string }> {
    return [...new Set(containers.map((c) => c.state))].map((state) => ({ text: state, value: state }));
  }

  /**
   * Format port as "8080→80/tcp, 8443→443/tcp"
   * @param ports ContainerSummary['ports']
   * @returns Formatted ports
   */
  formatPorts(ports: ContainerSummary['ports']): string {
    return [
      ...new Set(
        ports
          .filter((p) => p.PublicPort)
          .sort((a, b) => (a.PublicPort ?? 0) - (b.PublicPort ?? 0))
          .map((p) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`)
      ),
    ].join(', ');
  }

  buildCreateRequest(values: ContainerFormValues): ContainerCreateRequest {
    return {
      name: values.name || undefined,
      image: values.image,
      network: values.network || undefined,
      command: values.command ? values.command.trim().split(/\s+/) : [],
      workingDir: values.workingDir || undefined,
      user: values.user || undefined,
      labels: (values.labels ?? []).map((l) => l.value),
      ports: values.ports ?? [],
      env: (values.env ?? []).map((e) => e.value),
      volumes: values.volumes ?? [],
      restartPolicy: values.restartPolicy,
      privileged: values.privileged ?? false,
      autoRemove: values.autoRemove ?? false,
      memoryMb: values.memoryMb || undefined,
      cpus: values.cpus || undefined,
    };
  }
}

export const containersService = new ContainersService();

interface UseContainersServiceOptions {
  onCreated: () => void;
  onBulkDone: () => void;
}

/**
 * React Query adapter around ContainersService
 * @param hostId string
 * @param refreshIntervalMs number
 * @returns Adapter object
 */
export function useContainersService(
  hostId: string,
  refreshIntervalMs: number | undefined,
  { onCreated, onBulkDone }: UseContainersServiceOptions
) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data, isLoading } = useQuery({
    queryKey: ['containers', hostId],
    queryFn: () => containersApi.list(hostId),
    refetchInterval: refreshIntervalMs ?? 5000,
  });

  const { data: networks } = useQuery({
    queryKey: ['networks', hostId],
    queryFn: () => networksApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['containers', hostId] });

  const action = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => containersApi.action(hostId, id, action),
    onSuccess: invalidate,
    onError: (err: Error) => message.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => containersApi.remove(hostId, id),
    onSuccess: () => {
      message.success('Container deleted');
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const create = useMutation({
    mutationFn: (values: ContainerFormValues) =>
      containersApi.create(hostId, containersService.buildCreateRequest(values)),
    onSuccess: () => {
      message.success('Container created and started');
      onCreated();
      invalidate();
    },
    onError: (err: Error) => message.error(err.message),
  });

  const bulk = useMutation({
    mutationFn: ({ action, ids }: { action: string; ids: string[] }) =>
      runBulk(ids, (id) => (action === 'remove' ? containersApi.remove(hostId, id) : containersApi.action(hostId, id, action))),
    onSuccess: ({ ok, errors }, { action }) => {
      if (ok) message.success(containersService.bulkActionLabel(action, ok));
      if (errors.length) message.error(`${errors.length} failure(s) : ${errors[0]}`);
      onBulkDone();
      invalidate();
    },
  });

  return {
    containers: data,
    isLoading,
    networks,
    invalidate,
    action,
    remove,
    create,
    bulk,
  };
}
