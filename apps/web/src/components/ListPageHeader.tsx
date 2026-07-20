import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

// The title-plus-actions row repeated at the top of every list page (Containers, Images,
// Volumes, Networks, Stacks, Users, Audit Log) — `wrap` lets the actions drop to their own
// line instead of overflowing on a narrow screen.
export default function ListPageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {children}
    </Space>
  );
}
