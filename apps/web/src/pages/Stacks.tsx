import { useState, type Key } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  EditOutlined,
  ImportOutlined,
  PlusOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { hasPermission, type ComposeResult, type StackSummary } from '../api';
import { runBulk, STACK_STATUS, TABLE_PAGINATION } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { stacksApi } from '../services/stacksApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';
import ImportFromPortainerModal from '../components/ImportFromPortainerModal';
import ListPageHeader from '../components/ListPageHeader';

export default function Stacks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'manageStacks');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const { data: settings } = useAppSettings();

  const { data, isLoading } = useQuery({
    queryKey: ['stacks'],
    queryFn: () => stacksApi.list(),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stacks'] });

  const showResult = (title: string, result: ComposeResult) => {
    if (result.ok) {
      message.success(title);
    } else {
      modal.error({
        title: `${title}: failed`,
        width: 720,
        content: (
          <pre style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {result.output}
          </pre>
        ),
      });
    }
    invalidate();
  };

  const deployMutation = useMutation({
    mutationFn: (name: string) => stacksApi.deploy(name),
    onSuccess: (result) => showResult('Deployment', result),
    onError: (err) => message.error(err.message),
  });

  const downMutation = useMutation({
    mutationFn: (name: string) => stacksApi.down(name),
    onSuccess: (result) => showResult('Stop', result),
    onError: (err) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => stacksApi.remove(name),
    onSuccess: () => {
      message.success('Stack deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const bulkMutation = useMutation({
    mutationFn: (action: 'deploy' | 'down' | 'delete') =>
      runBulk(selectedKeys as string[], async (name) => {
        if (action === 'delete') {
          await stacksApi.remove(name);
          return;
        }
        const result = action === 'deploy' ? await stacksApi.deploy(name) : await stacksApi.down(name);
        if (!result.ok) throw new Error(`${name}: ${result.output.slice(0, 200)}`);
      }),
    onSuccess: ({ ok, errors }, action) => {
      const labels = { deploy: 'deployed', down: 'stopped', delete: 'deleted' };
      if (ok) message.success(`${ok} stack(s) ${labels[action]}`);
      if (errors.length) message.error(`${errors.length} failure(s) : ${errors[0]}`);
      setSelectedKeys([]);
      invalidate();
    },
  });

  const busy = deployMutation.isPending || downMutation.isPending || bulkMutation.isPending;

  const columns: ColumnsType<StackSummary> = [
    {
      key: 'favorite',
      width: 40,
      render: (_, record) => <FavoriteButton type="stack" id={record.name} label={record.name} />,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string) => <Link to={`/stacks/${name}`}>{name}</Link>,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'State',
      dataIndex: 'status',
      render: (status: StackSummary['status'], record) => (
        <Space size={4}>
          <Tag color={STACK_STATUS[status].color}>{STACK_STATUS[status].label}</Tag>
          {record.drifted && (
            <Tooltip title="Running containers no longer match this stack's compose file — open the stack for details">
              <Tag color="orange" icon={<WarningOutlined />}>
                Drifted
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Services',
      render: (_, record) => (record.services ? `${record.running}/${record.services}` : '—'),
    },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space size="small">
          {canManage && (
            <Tooltip title="Deploy (up -d)">
              <Button
                size="small"
                icon={<CaretRightOutlined />}
                loading={deployMutation.isPending && deployMutation.variables === record.name}
                disabled={busy}
                onClick={() => deployMutation.mutate(record.name)}
              />
            </Tooltip>
          )}
          {canManage && (
            <Tooltip title="Stop (down)">
              <Button
                size="small"
                icon={<StopOutlined />}
                loading={downMutation.isPending && downMutation.variables === record.name}
                disabled={busy}
                onClick={() => downMutation.mutate(record.name)}
              />
            </Tooltip>
          )}
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/stacks/${record.name}`)}
            />
          </Tooltip>
          {canManage && (
            <DeleteButton
              confirmTitle="Delete this stack? Its containers will be stopped."
              onConfirm={() => deleteMutation.mutate(record.name)}
              loading={deleteMutation.isPending && deleteMutation.variables === record.name}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Stacks">
        {canManage && (
          <Space>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              Import from Portainer
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/stacks/new')}>
              New stack
            </Button>
          </Space>
        )}
      </ListPageHeader>
      {canManage && <ImportFromPortainerModal open={importOpen} onClose={() => setImportOpen(false)} />}
      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        {canManage && (
          <Button
            size="small"
            icon={<CaretRightOutlined />}
            loading={bulkMutation.isPending && bulkMutation.variables === 'deploy'}
            disabled={busy}
            onClick={() => bulkMutation.mutate('deploy')}
          >
            Deploy
          </Button>
        )}
        {canManage && (
          <Button
            size="small"
            icon={<StopOutlined />}
            loading={bulkMutation.isPending && bulkMutation.variables === 'down'}
            disabled={busy}
            onClick={() => bulkMutation.mutate('down')}
          >
            Stop
          </Button>
        )}
        {canManage && (
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} stack(s)? Their containers will be stopped.`}
            onConfirm={() => bulkMutation.mutate('delete')}
            loading={bulkMutation.isPending && bulkMutation.variables === 'delete'}
            disabled={busy}
          >
            Delete
          </DeleteButton>
        )}
      </BulkBar>
      <Table
        rowKey="name"
        columns={columns}
        dataSource={data}
        loading={isLoading}
        size="middle"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}
