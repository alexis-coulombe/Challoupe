import type { WebSocket } from 'ws';
import { docker } from './docker.js';
import { notificationService } from './integrations/notifications/notifications.js';

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
 * @returns DockerNotification | null
 */
export function classifyEvent(event: RawDockerEvent): DockerNotification | null {
  if (event.Type !== 'container' || !event.Action || !event.Actor?.ID) return null;
  const containerId = event.Actor.ID;
  const containerName = event.Actor.Attributes?.name ?? containerId.slice(0, 12);
  const time = event.time ?? Math.floor(Date.now() / 1000);

  if (event.Action === 'die') {
    const exitCode = Number(event.Actor.Attributes?.exitCode ?? '0');
    if (exitCode === 0) return null;
    return { type: 'container_event', action: 'crashed', containerId, containerName, exitCode, time };
  }
  if (event.Action === 'oom') {
    return { type: 'container_event', action: 'oom', containerId, containerName, time };
  }
  if (event.Action === 'health_status: unhealthy') {
    return { type: 'container_event', action: 'unhealthy', containerId, containerName, time };
  }
  return null;
}

/**
 * Fans a single upstream Docker event stream out to every subscribed WebSocket client,
 * replacing what used to be a module-level subscribers Set + streamStarted flag.
 */
export class DockerEventBroadcaster {
  private readonly subscribers = new Set<WebSocket>();
  private streamStarted = false;

  private broadcast(notification: DockerNotification): void {
    void notificationService.notifyContainerEvent(
      notification.containerName,
      EVENT_DETAIL[notification.action](notification)
    );
    const payload = JSON.stringify(notification);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private scheduleRetry(): void {
    this.streamStarted = false;
    setTimeout(() => this.start(), 5000).unref?.();
  }

  private async startEventStream(): Promise<void> {
    try {
      const stream = await docker.getEvents({ filters: { type: ['container'] } });
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
            const notification = classifyEvent(JSON.parse(line));
            if (notification) {
              this.broadcast(notification);
            }
          } catch {
            // Ignore a line that didn't parse as a complete event object.
          }
        }
      });
      stream.on('error', () => {
        console.error('Docker event stream error, reconnecting shortly');
        this.scheduleRetry();
      });
      stream.on('end', () => {
        this.scheduleRetry();
      });
    } catch (err) {
      console.error('Failed to attach to the Docker event stream:', err);
      this.scheduleRetry();
    }
  }

  /**
   * Starts consuming the Docker event stream if it isn't already running, independent of
   * whether any WebSocket client is subscribed, so background notifications keep working
   * with no browser tab open.
   */
  start(): void {
    if (this.streamStarted) return;
    this.streamStarted = true;
    void this.startEventStream();
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
