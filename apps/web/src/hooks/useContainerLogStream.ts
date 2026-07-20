import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api';

const MAX_LINES = 5000;

// Streams demultiplexed log text over a WebSocket instead of polling, keeping
// only the most recent MAX_LINES lines so a noisy container can't grow this forever.
export function useContainerLogStream(containerId: string, tail: number, enabled: boolean): string {
  const [text, setText] = useState('');
  const bufferRef = useRef('');

  useEffect(() => {
    if (!enabled) return;
    bufferRef.current = '';
    setText('');
    const ws = new WebSocket(wsUrl(`/containers/${containerId}/logs?tail=${tail}`));
    ws.onmessage = (event) => {
      bufferRef.current += event.data as string;
      const lines = bufferRef.current.split('\n');
      if (lines.length > MAX_LINES) bufferRef.current = lines.slice(-MAX_LINES).join('\n');
      setText(bufferRef.current);
    };
    return () => ws.close();
  }, [containerId, tail, enabled]);

  return text;
}
