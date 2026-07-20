import { useEffect, useRef } from 'react';
import { App as AntApp } from 'antd';
import { useNavigate } from 'react-router-dom';
import { wsUrl } from '../api';

type DockerEventAction = 'crashed' | 'oom' | 'unhealthy';

interface DockerEventMessage {
  type: 'container_event';
  action: DockerEventAction;
  containerId: string;
  containerName: string;
  exitCode?: number;
  time: number;
}

const DESCRIPTION: Record<DockerEventAction, (m: DockerEventMessage) => string> = {
  crashed: (m) => `Exited unexpectedly with code ${m.exitCode}.`,
  oom: () => 'Killed by the kernel — out of memory.',
  unhealthy: () => 'Health check is now failing.',
};

const KIND: Record<DockerEventAction, 'error' | 'warning'> = {
  crashed: 'error',
  oom: 'error',
  unhealthy: 'warning',
};

// Live-notifies on container crashes/OOM-kills/failing health checks via the
// /ws/events feed, so a problem surfaces immediately instead of only being
// noticed next time someone happens to look at the Dashboard.
export function useDockerEventNotifications(): void {
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const notificationRef = useRef(notification);
  notificationRef.current = notification;

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const connect = () => {
      ws = new WebSocket(wsUrl('/events'));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as DockerEventMessage;
        const key = `docker-event-${msg.containerId}-${msg.time}`;
        notificationRef.current[KIND[msg.action]]({
          key,
          message: msg.containerName,
          description: (
            <>
              {DESCRIPTION[msg.action](msg)}{' '}
              {/* A router <Link> can't be used here — antd's notification content
                  renders outside the <BrowserRouter> tree, so it must navigate
                  imperatively instead of relying on router context at render time. */}
              <a
                onClick={() => {
                  navigate(`/containers/${msg.containerId}`);
                  notificationRef.current.destroy(key);
                }}
              >
                View container
              </a>
            </>
          ),
          placement: 'bottomRight',
        });
      };
      ws.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 3000);
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      ws.close();
    };
  }, []);
}
