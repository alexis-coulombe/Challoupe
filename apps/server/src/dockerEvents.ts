import type { WebSocket } from 'ws';
import { hostManager } from './hostManager.js';
import { allHostIds } from './hosts.js';
import { notificationService } from './integrations/notifications/notifications.js';
import { settingsService } from './settings.js';
import { containerWatchdog } from './containerWatchdog.js';

const EVENT_DETAIL: Record<DockerEventAction, (notification: DockerNotification) => string> = {
  crashed: (n) => `crashed (exit code ${n.exitCode})`,
  oom: () => 'was killed by the OOM killer',
  unhealthy: () => 'failed its health check',
};

export type DockerEventAction = 'crashed' | 'oom' | 'unhealthy';

export interface DockerNotification {
  type: 'container_event';
  action: DockerEventAction;
  containerId: string;
  containerName: string;
  exitCode?: number;
  time: number;
  hostId: string;
}

interface RawDockerEvent {
  Type?: string;
  Action?: string;
  Actor?: { ID?: string; Attributes?: Record<string, string> };
  time?: number;
}

/**
 * Turns a raw Docker event into a user-facing notification
 * @param event RawDockerEvent
 * @param hostId string
 * @returns DockerNotification | null
 */
export function classifyEvent(event: RawDockerEvent, hostId: string): DockerNotification | null {
  if (event.Type !== 'container' || !event.Action || !event.Actor?.ID) return null;
  const containerId = event.Actor.ID;
  const containerName = event.Actor.Attributes?.name ?? containerId.slice(0, 12);
  const time = event.time ?? Math.floor(Date.now() / 1000);

  if (event.Action === 'die') {
    const exitCode = Number(event.Actor.Attributes?.exitCode ?? '0');
    if (exitCode === 0) return null;
    return { type: 'container_event', action: 'crashed', containerId, containerName, exitCode, time, hostId };
  }
  if (event.Action === 'oom') {
    return { type: 'container_event', action: 'oom', containerId, containerName, time, hostId };
  }
  if (event.Action === 'health_status: unhealthy') {
    return { type: 'container_event', action: 'unhealthy', containerId, containerName, time, hostId };
  }
  return null;
}

/**
 * Fans out to every subscribed WebSocket client, from one upstream Docker event stream per
 * registered host — replacing what used to be a single global stream + streamStarted flag.
 */
export class DockerEventBroadcaster {
  private readonly subscribers = new Set<WebSocket>();
  private readonly activeHosts = new Set<string>();

  private broadcast(notification: DockerNotification): void {
    void this.notify(notification);
    const payload = JSON.stringify(notification);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  // Runs separately from the instant WS fan-out above, since an AI diagnosis can take a
  // few seconds and shouldn't delay the live toast in the UI.
  private async notify(notification: DockerNotification): Promise<void> {
    const baseDetail = EVENT_DETAIL[notification.action](notification);
    const { aiWatchdog, featureFlags } = settingsService.get();
    if (aiWatchdog.enabled && aiWatchdog.checkContainerEvents && featureFlags.aiAssistant) {
      const diagnosis = await containerWatchdog.diagnose(
        notification.hostId,
        notification.containerId,
        notification.containerName,
        baseDetail
      );
      if (diagnosis) {
        await notificationService.notifyContainerEvent(notification.containerName, `${baseDetail} AI diagnosis: ${diagnosis}`);
        return;
      }
    }

    await notificationService.notifyContainerEvent(notification.containerName, baseDetail);
  }

  private scheduleRetry(hostId: string): void {
    this.activeHosts.delete(hostId);
    setTimeout(() => this.startHost(hostId), 5000).unref?.();
  }

  private async startEventStream(hostId: string): Promise<void> {
    try {
      const client = await hostManager.getClient(hostId);
      if (!client) {
        // The host was removed (or never existed) — don't keep retrying a dead id.
        this.activeHosts.delete(hostId);
        return;
      }
      const stream = await client.getEvents({ filters: { type: ['container'] } });
      let buffer = '';
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          try {
            const notification = classifyEvent(JSON.parse(line), hostId);
            if (notification) {
              this.broadcast(notification);
            }
          } catch {
            // Ignore a line that didn't parse as a complete event object.
          }
        }
      });
      stream.on('error', () => {
        console.error(`Docker event stream error for host ${hostId}, reconnecting shortly`);
        this.scheduleRetry(hostId);
      });
      stream.on('end', () => {
        this.scheduleRetry(hostId);
      });
    } catch (err) {
      console.error(`Failed to attach to the Docker event stream for host ${hostId}:`, err);
      this.scheduleRetry(hostId);
    }
  }

  /**
   * Starts consuming the given host's event stream if it isn't already running. Idempotent,
   * so it's safe to call both from `start()` (every registered host) and right after a new
   * host is created, without double-subscribing.
   */
  startHost(hostId: string): void {
    if (this.activeHosts.has(hostId)) return;
    this.activeHosts.add(hostId);
    void this.startEventStream(hostId);
  }

  /**
   * Starts consuming every registered host's event stream that isn't already running,
   * independent of whether any WebSocket client is subscribed, so background notifications
   * keep working with no browser tab open.
   */
  start(): void {
    for (const hostId of allHostIds()) this.startHost(hostId);
  }

  /**
   * Adds a WS client to the notification fan-out
   * @param ws WebSocket
   */
  subscribe(ws: WebSocket): void {
    this.subscribers.add(ws);
    ws.on('close', () => this.subscribers.delete(ws));
    this.start();
  }
}

export const dockerEventBroadcaster = new DockerEventBroadcaster();
