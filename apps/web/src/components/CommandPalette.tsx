import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, Input, Modal, Typography, type InputRef } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BlockOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  SearchOutlined,
  SettingOutlined,
  StarFilled,
  TeamOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth';
import { useFavorites, type FavoriteType } from '../hooks/useFavorites';
import { containersApi } from '../services/containersApi';
import { stacksApi } from '../services/stacksApi';

interface PaletteItem {
  key: string;
  group: string;
  icon: ReactNode;
  label: string;
  sublabel?: string;
  path: string;
  favorite?: { type: FavoriteType; id: string };
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { favorites, isFavorite } = useFavorites();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<InputRef>(null);

  const { data: containers } = useQuery({
    queryKey: ['containers'],
    queryFn: () => containersApi.list(),
    enabled: open,
  });
  const { data: stacks } = useQuery({
    queryKey: ['stacks'],
    queryFn: () => stacksApi.list(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const pageItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { key: 'page-/', group: 'Pages', icon: <DashboardOutlined />, label: 'Dashboard', path: '/' },
      { key: 'page-/containers', group: 'Pages', icon: <ContainerOutlined />, label: 'Containers', path: '/containers' },
      { key: 'page-/images', group: 'Pages', icon: <BlockOutlined />, label: 'Images', path: '/images' },
      { key: 'page-/volumes', group: 'Pages', icon: <DatabaseOutlined />, label: 'Volumes', path: '/volumes' },
      { key: 'page-/networks', group: 'Pages', icon: <ApartmentOutlined />, label: 'Networks', path: '/networks' },
      { key: 'page-/stacks', group: 'Pages', icon: <AppstoreOutlined />, label: 'Stacks', path: '/stacks' },
    ];
    if (user?.role === 'admin') {
      items.push({ key: 'page-/users', group: 'Pages', icon: <TeamOutlined />, label: 'Users', path: '/users' });
      items.push({
        key: 'page-/audit-log',
        group: 'Pages',
        icon: <HistoryOutlined />,
        label: 'Audit Log',
        path: '/audit-log',
      });
    }
    items.push({ key: 'page-/settings', group: 'Pages', icon: <SettingOutlined />, label: 'Settings', path: '/settings' });
    return items;
  }, [user]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const containerItems: PaletteItem[] = (containers ?? []).map((c) => ({
      key: `container-${c.id}`,
      group: 'Containers',
      icon: <ContainerOutlined />,
      label: c.name,
      sublabel: c.image,
      path: `/containers/${c.id}`,
      favorite: { type: 'container', id: c.id },
    }));
    const stackItems: PaletteItem[] = (stacks ?? []).map((s) => ({
      key: `stack-${s.name}`,
      group: 'Stacks',
      icon: <AppstoreOutlined />,
      label: s.name,
      sublabel: s.services ? `${s.running}/${s.services} running` : undefined,
      path: `/stacks/${s.name}`,
      favorite: { type: 'stack', id: s.name },
    }));
    return [...pageItems, ...containerItems, ...stackItems];
  }, [pageItems, containers, stacks]);

  const results = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const favoriteItems = favorites
        .map((f) => allItems.find((i) => i.favorite?.type === f.type && i.favorite.id === f.id))
        .filter((i): i is PaletteItem => !!i)
        .map((i) => ({ ...i, group: 'Favorites' }));
      return [...favoriteItems, ...pageItems];
    }
    return allItems
      .filter((i) => `${i.label} ${i.sublabel ?? ''}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query, allItems, pageItems, favorites]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, query]);

  const select = (item: PaletteItem) => {
    navigate(item.path);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[activeIndex]) select(results[activeIndex]);
    }
  };

  let lastGroup = '';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2733' }}>
        <Input
          ref={inputRef}
          size="large"
          variant="borderless"
          prefix={<SearchOutlined style={{ marginRight: 4 }} />}
          placeholder="Search containers, stacks, pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div style={{ maxHeight: 420, overflow: 'auto', padding: '4px 0' }}>
        {results.length === 0 && <Empty description="No results" style={{ margin: '32px 0' }} />}
        {results.map((item, idx) => {
          const showHeader = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <div key={item.key}>
              {showHeader && (
                <Typography.Text
                  type="secondary"
                  style={{
                    display: 'block',
                    padding: '8px 16px 4px',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {item.group}
                </Typography.Text>
              )}
              <div
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => select(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 16px',
                  cursor: 'pointer',
                  background: idx === activeIndex ? 'rgba(59, 130, 246, 0.14)' : 'transparent',
                }}
              >
                {item.icon}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </div>
                  {item.sublabel && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.sublabel}
                    </Typography.Text>
                  )}
                </div>
                {item.favorite && isFavorite(item.favorite.type, item.favorite.id) && (
                  <StarFilled style={{ color: '#faad14' }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
