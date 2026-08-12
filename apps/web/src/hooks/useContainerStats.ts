import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api';
import type { StatsSample } from '../models/StatsSample';

const HISTORY_LENGTH = 60;

export interface StatsHistory {
  cpuPercent: number[];
  memoryPercent: number[];
  memoryUsage: number[];
  memoryLimit: number;
  networkRx: number[];
  networkTx: number[];
  blockRead: number[];
  blockWrite: number[];
  pids: number[];
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
  blockRead: [],
  blockWrite: [],
  pids: [],
  latest: null,
  connected: false,
};

// Tracks a rolling window of live `docker stats` samples over a WebSocket, converting
// cumulative network and block I/O byte counters into an instantaneous rate.
export function useContainerStats(hostId: string, containerId: string, enabled: boolean): StatsHistory {
  const [history, setHistory] = useState<StatsHistory>(EMPTY);
  const prevRef = useRef<{ rx: number; tx: number; read: number; write: number; t: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHistory(EMPTY);
      return;
    }
    prevRef.current = null;
    setHistory(EMPTY);
    const ws = new WebSocket(wsUrl(`/hosts/${hostId}/containers/${containerId}/stats`));

    ws.onopen = () => setHistory((prev) => ({ ...prev, connected: true }));
    ws.onclose = () => setHistory((prev) => ({ ...prev, connected: false }));
    ws.onmessage = (event) => {
      const sample = JSON.parse(event.data as string) as StatsSample;
      const now = Date.now();
      let rxRate = 0;
      let txRate = 0;
      let readRate = 0;
      let writeRate = 0;
      if (prevRef.current) {
        const dt = (now - prevRef.current.t) / 1000;
        if (dt > 0) {
          rxRate = Math.max(0, (sample.networkRx - prevRef.current.rx) / dt);
          txRate = Math.max(0, (sample.networkTx - prevRef.current.tx) / dt);
          readRate = Math.max(0, (sample.blockRead - prevRef.current.read) / dt);
          writeRate = Math.max(0, (sample.blockWrite - prevRef.current.write) / dt);
        }
      }
      prevRef.current = { rx: sample.networkRx, tx: sample.networkTx, read: sample.blockRead, write: sample.blockWrite, t: now };

      setHistory((prev) => ({
        cpuPercent: [...prev.cpuPercent, sample.cpuPercent].slice(-HISTORY_LENGTH),
        memoryPercent: [...prev.memoryPercent, sample.memoryPercent].slice(-HISTORY_LENGTH),
        memoryUsage: [...prev.memoryUsage, sample.memoryUsage].slice(-HISTORY_LENGTH),
        memoryLimit: sample.memoryLimit,
        networkRx: [...prev.networkRx, rxRate].slice(-HISTORY_LENGTH),
        networkTx: [...prev.networkTx, txRate].slice(-HISTORY_LENGTH),
        blockRead: [...prev.blockRead, readRate].slice(-HISTORY_LENGTH),
        blockWrite: [...prev.blockWrite, writeRate].slice(-HISTORY_LENGTH),
        pids: [...prev.pids, sample.pids].slice(-HISTORY_LENGTH),
        latest: sample,
        connected: true,
      }));
    };

    return () => ws.close();
  }, [hostId, containerId, enabled]);

  return history;
}
