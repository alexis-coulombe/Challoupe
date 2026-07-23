import { useEffect, useRef, useState } from 'react';
import { Button, Card, Select, Space, Typography } from 'antd';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsUrl, type TerminalShell, type TerminalThemeSettings } from '../api';

const SHELLS: TerminalShell[] = ['/bin/sh', '/bin/bash', '/bin/ash'];

const DEFAULT_THEME: TerminalThemeSettings = {
  background: '#0b0e14',
  foreground: '#c9d1d9',
  cursor: '#3b82f6',
};

export default function ContainerTerminal({
  containerId,
  running,
  defaultShell,
  theme,
}: {
  containerId: string;
  running: boolean;
  defaultShell: TerminalShell;
  theme?: TerminalThemeSettings;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [shell, setShell] = useState<TerminalShell>(defaultShell);
  const [shellTouched, setShellTouched] = useState(false);
  const [connected, setConnected] = useState(false);

  // Adopt the configured default shell once it loads, unless the user already picked one.
  useEffect(() => {
    if (!shellTouched) setShell(defaultShell);
  }, [defaultShell, shellTouched]);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: theme ?? DEFAULT_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      wsRef.current?.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Settings can load after the terminal is first created, or change while it's open, so
  // keep applying them. xterm re-renders in place when `.options.theme` is reassigned.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = theme ?? DEFAULT_THEME;
  }, [theme]);

  const connect = () => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    const ws = new WebSocket(wsUrl(`/containers/${containerId}/exec?shell=${encodeURIComponent(shell)}`));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      fitRef.current?.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (event) => term.write(event.data as string);
    ws.onclose = () => setConnected(false);

    const dataListener = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const resizeListener = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
    ws.addEventListener('close', () => {
      dataListener.dispose();
      resizeListener.dispose();
    });
  };

  if (!running) {
    return (
      <Card size="small">
        <Typography.Text type="secondary">Start the container to open a shell.</Typography.Text>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title="Terminal"
      extra={
        <Space wrap size={8}>
          <Select
            size="small"
            value={shell}
            onChange={(v) => {
              setShell(v);
              setShellTouched(true);
            }}
            disabled={connected}
            options={SHELLS.map((s) => ({ value: s, label: s }))}
            style={{ width: 110 }}
          />
          {connected ? (
            <Button size="small" danger onClick={() => wsRef.current?.close()}>
              Disconnect
            </Button>
          ) : (
            <Button size="small" type="primary" onClick={connect}>
              Connect
            </Button>
          )}
        </Space>
      }
    >
      <div ref={containerRef} style={{ height: 360 }} />
    </Card>
  );
}
