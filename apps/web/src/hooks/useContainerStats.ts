import { useEffect, useRef, useState } from 'react';
import { wsUrl, type StatsSample } from '../api';

const HISTORY_LENGTH = 60;

export interface StatsHistory {
  cpuPercent: number[];
  memoryPercent: number[];
  memoryUsage: number[];
  memoryLimit: number;
  networkRx: number[];
  networkTx: number[];
  latest: StatsSample | null;
  connected: boolean;
}

const EMPTY: StatsHistory = {
  cpuPercent: [],
  memoryPercent: [],
  memoryUsage: [],
  memoryLimit: 0,
  networkRx: [],
  networkTx: [],
  latest: null,
  connected: false,
};

// Tracks a rolling window of live `docker stats` samples over a WebSocket,
// converting cumulative network byte counters into an instantaneous rate.
export function useContainerStats(containerId: string, enabled: boolean): StatsHistory {
  const [history, setHistory] = useState<StatsHistory>(EMPTY);
  const prevNetRef = useRef<{ rx: number; tx: number; t: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHistory(EMPTY);
      return;
    }
    prevNetRef.current = null;
    setHistory(EMPTY);
    const ws = new WebSocket(wsUrl(`/containers/${containerId}/stats`));

    ws.onopen = () => setHistory((prev) => ({ ...prev, connected: true }));
    ws.onclose = () => setHistory((prev) => ({ ...prev, connected: false }));
    ws.onmessage = (event) => {
      const sample = JSON.parse(event.data as string) as StatsSample;
      const now = Date.now();
      let rxRate = 0;
      let txRate = 0;
      if (prevNetRef.current) {
        const dt = (now - prevNetRef.current.t) / 1000;
        if (dt > 0) {
          rxRate = Math.max(0, (sample.networkRx - prevNetRef.current.rx) / dt);
          txRate = Math.max(0, (sample.networkTx - prevNetRef.current.tx) / dt);
        }
      }
      prevNetRef.current = { rx: sample.networkRx, tx: sample.networkTx, t: now };

      setHistory((prev) => ({
        cpuPercent: [...prev.cpuPercent, sample.cpuPercent].slice(-HISTORY_LENGTH),
        memoryPercent: [...prev.memoryPercent, sample.memoryPercent].slice(-HISTORY_LENGTH),
        memoryUsage: [...prev.memoryUsage, sample.memoryUsage].slice(-HISTORY_LENGTH),
        memoryLimit: sample.memoryLimit,
        networkRx: [...prev.networkRx, rxRate].slice(-HISTORY_LENGTH),
        networkTx: [...prev.networkTx, txRate].slice(-HISTORY_LENGTH),
        latest: sample,
        connected: true,
      }));
    };

    return () => ws.close();
  }, [containerId, enabled]);

  return history;
}
