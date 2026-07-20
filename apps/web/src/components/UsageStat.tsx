import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { usageColor } from '../utils';

interface UsageStatProps {
  icon: ReactNode;
  label: string;
  percent: number | undefined;
  detail?: string;
}

// Compact icon + label + mini progress bar, used for host resource stats in the header.
export default function UsageStat({ icon, label, percent, detail }: UsageStatProps) {
  const value = percent ?? 0;
  const color = usageColor(value);

  return (
    <Tooltip title={detail}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 108 }}>
        <span style={{ fontSize: 16, color: 'rgba(255, 255, 255, 0.65)' }}>{icon}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 76 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              lineHeight: 1,
              color: 'rgba(255, 255, 255, 0.5)',
            }}
          >
            <span>{label}</span>
            <span style={{ color: '#e6e8eb', fontWeight: 600 }}>
              {percent === undefined ? '—' : `${value.toFixed(0)}%`}
            </span>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, value))}%`,
                borderRadius: 2,
                background: color,
                transition: 'width 0.5s ease, background-color 0.5s ease',
              }}
            />
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
