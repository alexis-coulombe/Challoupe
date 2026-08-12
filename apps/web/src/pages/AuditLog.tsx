import { Button, Card, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import type { AuditLogEntry } from '../models/AuditLogEntry';
import { formatDateTime, TABLE_PAGINATION } from '../utils';
import { useAuditLogService, auditLogService } from '../services/AuditLogService';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

export default function AuditLog() {
  const {
    entries: data,
    isLoading,
    isFetching,
    refetch,
    enabled,
    toggle: toggleMutation,
    clear: clearMutation,
  } = useAuditLogService();

  const columns: ColumnsType<AuditLogEntry> = [
    { title: 'Time', dataIndex: 'created_at', render: formatDateTime, width: 170 },
    { title: 'User', dataIndex: 'username' },
    {
      title: 'Action',
      dataIndex: 'action',
      render: (action: string) => <Typography.Text code>{action}</Typography.Text>,
      filters: auditLogService.actionFilters(data ?? []),
      onFilter: (value, record) => record.action === value,
    },
    {
      title: 'Target',
      dataIndex: 'target',
      ellipsis: true,
      width: 220,
      render: (t: string | null) => t ?? '—',
    },
    {
      title: 'Detail',
      dataIndex: 'detail',
      ellipsis: true,
      render: (d: string | null) => d ?? '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (status: 'success' | 'failure') => (
        <Tag color={status === 'success' ? 'green' : 'red'}>{status}</Tag>
      ),
      filters: [
        { text: 'success', value: 'success' },
        { text: 'failure', value: 'failure' },
      ],
      onFilter: (value, record) => record.status === value,
    },
    { title: 'IP', dataIndex: 'ip', render: (ip: string | null) => ip ?? '—' },
  ];

  return (
    <div>
      <ListPageHeader title="Audit Log">
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
            Refresh
          </Button>

          <DeleteButton
            confirmTitle="Clear the audit log? This permanently deletes all recorded entries."
            onConfirm={() => clearMutation.mutate()}
            loading={clearMutation.isPending}
            disabled={!data?.length}
            size="middle"
          >
            Clear all
          </DeleteButton>
        </Space>
      </ListPageHeader>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space align="center">
          <Switch
            checked={enabled}
            loading={toggleMutation.isPending}
            onChange={(value) => toggleMutation.mutate(value)}
          />
          <Typography.Text strong>Record actions to the audit log</Typography.Text>
        </Space>

        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Tracks users actions. Turning this off stops new entries; 
          history already recorded stays visible.
        </Typography.Paragraph>
      </Card>
      
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={isLoading}
        size="middle"
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}
