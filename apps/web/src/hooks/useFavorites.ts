import { useCallback, useEffect, useState } from 'react';

export type FavoriteType = 'container' | 'stack';

export interface FavoriteItem {
  type: FavoriteType;
  id: string;
  label: string;
}

const STORAGE_KEY = 'challoupe.favorites';

/**
 * Persists favorites to localStorage and fans out changes to every subscriber (e.g. a star
 * button in a table row and the Dashboard's Favorites card) — a module-level singleton
 * since this is a per-browser preference with no need for a React context provider.
 */
class FavoritesStore {
  private items: FavoriteItem[];
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.items = this.load();
  }

  private load(): FavoriteItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as FavoriteItem[]) : [];
    } catch {
      return [];
    }
  }

  getItems(): FavoriteItem[] {
    return this.items;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(items: FavoriteItem[]): void {
    this.items = items;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    this.listeners.forEach((listener) => listener());
  }

  toggle(type: FavoriteType, id: string, label: string): void {
    const exists = this.items.some((f) => f.type === type && f.id === id);
    this.persist(
      exists ? this.items.filter((f) => !(f.type === type && f.id === id)) : [...this.items, { type, id, label }]
    );
  }
}

const favoritesStore = new FavoritesStore();

export function useFavorites() {
  const [items, setItems] = useState(favoritesStore.getItems());

  useEffect(() => favoritesStore.subscribe(() => setItems(favoritesStore.getItems())), []);

  const isFavorite = useCallback(
    (type: FavoriteType, id: string) => items.some((f) => f.type === type && f.id === id),
    [items]
  );

  const toggle = useCallback((type: FavoriteType, id: string, label: string) => {
    favoritesStore.toggle(type, id, label);
  }, []);

  return { favorites: items, isFavorite, toggle };
}
