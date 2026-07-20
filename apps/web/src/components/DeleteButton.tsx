import type { ReactNode } from 'react';
import { Button, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

interface DeleteButtonProps {
  confirmTitle: string;
  onConfirm: () => void;
  loading?: boolean;
  disabled?: boolean;
  size?: 'small' | 'middle';
  children?: ReactNode;
}

// A danger button behind a confirmation prompt — icon-only for table rows and
// bulk bars, or with a label when passed children (e.g. page-level actions).
export default function DeleteButton({
  confirmTitle,
  onConfirm,
  loading,
  disabled,
  size = 'small',
  children,
}: DeleteButtonProps) {
  return (
    <Popconfirm title={confirmTitle} onConfirm={onConfirm}>
      <Button size={size} danger icon={<DeleteOutlined />} loading={loading} disabled={disabled}>
        {children}
      </Button>
    </Popconfirm>
  );
}
