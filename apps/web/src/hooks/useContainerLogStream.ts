import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api';

const MAX_LINES = 5000;
// A backlog can take a moment to arrive for a very active container; past this, assume
// there's simply nothing to show yet rather than spinning forever.
const LOADING_TIMEOUT_MS = 3000;

export interface LogStream {
  text: string;
  loading: boolean;
}

// Streams demultiplexed log text over a WebSocket instead of polling, keeping
// only the most recent MAX_LINES lines so a noisy container can't grow this forever.
export function useContainerLogStream(
  hostId: string,
  containerId: string,
  tail: number,
  enabled: boolean
): LogStream {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const bufferRef = useRef('');

  useEffect(() => {
    if (!enabled) return;
    bufferRef.current = '';
    setText('');
    setLoading(true);
    const ws = new WebSocket(wsUrl(`/hosts/${hostId}/containers/${containerId}/logs?tail=${tail}`));
    const timeout = setTimeout(() => setLoading(false), LOADING_TIMEOUT_MS);
    ws.onmessage = (event) => {
      setLoading(false);
      bufferRef.current += event.data as string;
      const lines = bufferRef.current.split('\n');
      if (lines.length > MAX_LINES) bufferRef.current = lines.slice(-MAX_LINES).join('\n');
      setText(bufferRef.current);
    };
    ws.onclose = () => setLoading(false);
    return () => {
      clearTimeout(timeout);
      ws.close();
    };
  }, [hostId, containerId, tail, enabled]);

  return { text, loading };
}
