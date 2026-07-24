import { useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClearOutlined, PlusOutlined } from '@ant-design/icons';
import { hasPermission, type VolumeSummary } from '../api';
import { formatBytes, fromISO, TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useBulkAction } from '../hooks/useBulkAction';
import { volumesApi } from '../services/volumesApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

export default function Volumes() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageVolumes');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<{ name: string; driver: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['volumes', hostId],
    queryFn: () => volumesApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['volumes', hostId] });

  const createMutation = useMutation({
    mutationFn: (values: { name: string; driver: string }) => volumesApi.create(hostId, values),
    onSuccess: () => {
      message.success('Volume created');
      setCreateOpen(false);
      form.resetFields();
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) => volumesApi.remove(hostId, name),
    onSuccess: () => {
      message.success('Volume deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const pruneMutation = useMutation({
    mutationFn: () => volumesApi.prune(hostId),
    onSuccess: (result) => {
      message.success(`Prune complete: ${formatBytes(result.spaceReclaimed)} reclaimed`);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const bulkRemoveMutation = useBulkAction<string>({
    queryKey: ['volumes', hostId],
    run: (name) => volumesApi.remove(hostId, name),
    successLabel: (count) => `${count} volume(s) deleted`,
    onSettled: () => setSelectedKeys([]),
  });

  const columns: ColumnsType<VolumeSummary> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string) => <Typography.Text copyable>{name}</Typography.Text>,
    },
    { title: 'Driver', dataIndex: 'driver' },
    {
      title: 'Mount point',
      dataIndex: 'mountpoint',
      ellipsis: true,
      render: (m: string) => <Typography.Text type="secondary">{m}</Typography.Text>,
    },
    {
      title: 'Created',
      dataIndex: 'created',
      render: (created: string | null) => (created ? fromISO(created) : '—'),
    },
    {
      title: 'Actions',
      render: (_, record) =>
        canManage && (
          <DeleteButton
            confirmTitle="Delete this volume? Its data will be lost."
            onConfirm={() => removeMutation.mutate(record.name)}
            loading={removeMutation.isPending && removeMutation.variables === record.name}
          />
        ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Volumes">
        {canManage && (
          <Space wrap>
            <Popconfirm title="Remove unused volumes?" onConfirm={() => pruneMutation.mutate()}>
              <Button icon={<ClearOutlined />} loading={pruneMutation.isPending}>
                Prune
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Create volume
            </Button>
          </Space>
        )}
      </ListPageHeader>
      {canManage && (
        <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} volume(s)? Their data will be lost.`}
            onConfirm={() => bulkRemoveMutation.mutate(selectedKeys as string[])}
            loading={bulkRemoveMutation.isPending}
          >
            Delete
          </DeleteButton>
        </BulkBar>
      )}
      <Table
        rowKey="name"
        columns={columns}
        dataSource={[...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
        loading={isLoading}
        size="middle"
        rowSelection={canManage ? { selectedRowKeys: selectedKeys, onChange: setSelectedKeys } : undefined}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
      <Modal
        title="Create volume"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create"
        confirmLoading={createMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ driver: 'local' }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true },
              { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, message: 'Invalid name' },
            ]}
          >
            <Input placeholder="my-volume" />
          </Form.Item>
          <Form.Item name="driver" label="Driver">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
