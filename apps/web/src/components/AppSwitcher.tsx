import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Button, Popover, Typography } from 'antd';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';
import { useAppSettings } from '../hooks/useAppSettings';
import { useConnectedAppsVisible } from '../hooks/useConnectedAppsVisible';

const TILE_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#14b8a6', '#eab308'];

function tileColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

const tileStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '10px 4px',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  width: 68,
};

const tileIconStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontWeight: 600,
  fontSize: 15,
};

const tileLabelStyle: CSSProperties = {
  fontSize: 12,
  textAlign: 'center',
  lineHeight: 1.2,
  maxWidth: 68,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// A small "app launcher" grid, same idea as Google's own switcher: jump to another
// self-hosted app whose URL was added on the App links tab in Settings.
export default function AppSwitcher() {
  const { user } = useAuth();
  const { data: settings } = useAppSettings();
  const [open, setOpen] = useState(false);
  const [visible] = useConnectedAppsVisible();
  const appLinks = settings?.appLinks ?? [];
  const isAdmin = user?.role === 'admin';

  if (!visible) return null;

  const caption =
    appLinks.length > 0 ? 'Your apps' : isAdmin ? 'Connect another app to switch between them' : 'No apps linked yet';

  const content = (
    <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {caption}
      </Typography.Text>
      {(appLinks.length > 0 || isAdmin) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {appLinks.map((link) => (
            <a
              key={link.url}
              style={tileStyle}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              <span style={{ ...tileIconStyle, background: tileColor(link.label) }}>
                {link.label.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <span style={tileLabelStyle}>{link.label}</span>
            </a>
          ))}
          {isAdmin && (
            <Link style={tileStyle} to="/settings?tab=applinks" onClick={() => setOpen(false)}>
              <span style={{ ...tileIconStyle, background: 'transparent', border: '1.5px dashed #424242', color: '#8c8c8c' }}>
                <PlusOutlined />
              </span>
              <span style={tileLabelStyle}>Add app</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight" arrow={false}>
      <Button type="text" icon={<AppstoreOutlined />} aria-label="Switch apps" />
    </Popover>
  );
}
