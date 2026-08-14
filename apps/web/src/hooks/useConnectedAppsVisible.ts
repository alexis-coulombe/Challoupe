import { useEffect, useState } from 'react';

const STORAGE_KEY = 'challoupe.connectedAppsVisible';
const listeners = new Set<() => void>();

function readVisible(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

let visible = readVisible();

function setVisible(next: boolean): void {
  visible = next;
  localStorage.setItem(STORAGE_KEY, String(next));
  listeners.forEach((listener) => listener());
}

// Whether the "Connected apps" grid icon shows in the header. A per-browser preference
// (not synced to the server or other users), so components stay in sync with each other
// through this in-memory subscriber list rather than a "storage" event, which only fires
// in other tabs, never the one that made the change.
export function useConnectedAppsVisible() {
  const [value, setValue] = useState(visible);

  useEffect(() => {
    const listener = () => setValue(visible);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return [value, setVisible] as const;
}
