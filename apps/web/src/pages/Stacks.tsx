import { useState, type Key } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  EditOutlined,
  ImportOutlined,
  PlusOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { hasPermission } from '../models/permissions';
import type { StackSummary } from '../models/StackSummary';
import { STACK_STATUS, TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useStacksService } from '../services/StacksService';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';
import ImportFromPortainerModal from '../components/ImportFromPortainerModal';
import ListPageHeader from '../components/ListPageHeader';

export default function Stacks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageStacks');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [importOpen, setImportOpen] = useState(false);

  const {
    stacks: data,
    isLoading,
    deploy: deployMutation,
    down: downMutation,
    remove: deleteMutation,
    bulk: bulkMutation,
  } = useStacksService({ onBulkDone: () => setSelectedKeys([]) });

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
            <Tooltip title="Running containers no longer match this stack's compose file">
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
            <Tooltip title="Deploy">
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
            <Tooltip title="Stop">
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

      {hostId !== 'local' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Stacks always run on the local host"
          description="Compose deployments shell out to the docker compose CLI directly, which can't ride the SSH connection used for remote hosts yet. This list and its actions only ever affect stacks on Local, regardless of the host selected above."
        />
      )}

      {canManage && <ImportFromPortainerModal open={importOpen} onClose={() => setImportOpen(false)} />}

      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        {canManage && (
          <Button
            size="small"
            icon={<CaretRightOutlined />}
            loading={bulkMutation.isPending && bulkMutation.variables?.action === 'deploy'}
            disabled={busy}
            onClick={() => bulkMutation.mutate({ action: 'deploy', names: selectedKeys as string[] })}
          >
            Deploy all
          </Button>
        )}

        {canManage && (
          <Button
            size="small"
            icon={<StopOutlined />}
            loading={bulkMutation.isPending && bulkMutation.variables?.action === 'down'}
            disabled={busy}
            onClick={() => bulkMutation.mutate({ action: 'down', names: selectedKeys as string[] })}
          >
            Stop all
          </Button>
        )}

        {canManage && (
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} stack(s)? Their containers will be stopped.`}
            onConfirm={() => bulkMutation.mutate({ action: 'delete', names: selectedKeys as string[] })}
            loading={bulkMutation.isPending && bulkMutation.variables?.action === 'delete'}
            disabled={busy}
          >
            Permanently delete
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
