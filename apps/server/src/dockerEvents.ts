import type { WebSocket } from 'ws';
import { docker } from './docker.js';

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
    const payload = JSON.stringify(notification);
    for (const ws of this.subscribers) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
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
        this.streamStarted = false;
        console.error('Docker event stream error, will retry on next subscriber');
      });
      stream.on('end', () => {
        this.streamStarted = false;
      });
    } catch (err) {
      this.streamStarted = false;
      console.error('Failed to attach to the Docker event stream:', err);
    }
  }

  /**
   * Adds a WS client to the notification fan-out
   * @param ws WebSocket
   */
  subscribe(ws: WebSocket): void {
    this.subscribers.add(ws);
    ws.on('close', () => this.subscribers.delete(ws));
    if (!this.streamStarted) {
      this.streamStarted = true;
      void this.startEventStream();
    }
  }
}

export const dockerEventBroadcaster = new DockerEventBroadcaster();
