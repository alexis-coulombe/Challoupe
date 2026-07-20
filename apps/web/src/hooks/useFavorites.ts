import { useCallback, useEffect, useState } from 'react';

export type FavoriteType = 'container' | 'stack';

export interface FavoriteItem {
  type: FavoriteType;
  id: string;
  label: string;
}

const STORAGE_KEY = 'challoupe.favorites';

function load(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FavoriteItem[]) : [];
  } catch {
    return [];
  }
}

// Module-level cache + listener set so every component using this hook stays in
// sync (e.g. a star button in a table row and the Dashboard's Favorites card)
// without needing a React context provider for what's otherwise a tiny, purely
// local (per-browser) preference.
let cache = load();
const listeners = new Set<() => void>();

function persist(items: FavoriteItem[]): void {
  cache = items;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  listeners.forEach((listener) => listener());
}

export function useFavorites() {
  const [items, setItems] = useState(cache);

  useEffect(() => {
    const listener = () => setItems(cache);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const isFavorite = useCallback(
    (type: FavoriteType, id: string) => items.some((f) => f.type === type && f.id === id),
    [items]
  );

  const toggle = useCallback((type: FavoriteType, id: string, label: string) => {
    const exists = cache.some((f) => f.type === type && f.id === id);
    persist(exists ? cache.filter((f) => !(f.type === type && f.id === id)) : [...cache, { type, id, label }]);
  }, []);

  return { favorites: items, isFavorite, toggle };
}
