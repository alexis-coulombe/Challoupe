import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Card, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type AppSettings, type AuditLogEntry } from '../api';
import { formatDateTime, TABLE_PAGINATION } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import ListPageHeader from '../components/ListPageHeader';

export default function AuditLog() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { data: settings } = useAppSettings();
  const enabled = settings?.featureFlags.auditLog !== false;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api.get<AuditLogEntry[]>('/audit-log'),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const toggleMutation = useMutation({
    mutationFn: (value: boolean) => api.put<AppSettings>('/settings', { featureFlags: { auditLog: value } }),
    onSuccess: () => {
      message.success('Setting saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => message.error(err.message),
  });

  const columns: ColumnsType<AuditLogEntry> = [
    { title: 'Time', dataIndex: 'created_at', render: formatDateTime, width: 170 },
    { title: 'User', dataIndex: 'username' },
    {
      title: 'Action',
      dataIndex: 'action',
      render: (action: string) => <Typography.Text code>{action}</Typography.Text>,
      filters: [...new Set((data ?? []).map((e) => e.action))].map((a) => ({ text: a, value: a })),
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
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
          Refresh
        </Button>
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
          Tracks who did what and when — container/image/volume/network/stack changes, user
          management, settings updates, security scans, sign-ins, and denied actions. Turning this
          off stops new entries; history already recorded stays visible below.
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
