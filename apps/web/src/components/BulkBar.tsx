import type { ReactNode } from 'react';
import { Button, Space, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface BulkBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
}

// Bulk action bar shown when table rows are selected.
export default function BulkBar({ count, onClear, children }: BulkBarProps) {
  if (count === 0) return null;
  return (
    <Space
      wrap
      style={{
        width: '100%',
        marginBottom: 12,
        padding: '8px 12px',
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: 8,
      }}
    >
      <Typography.Text strong>{count} selected</Typography.Text>
      {children}
      <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClear}>
        Clear
      </Button>
    </Space>
  );
}
