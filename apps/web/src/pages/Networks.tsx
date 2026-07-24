import { useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { hasPermission, type NetworkSummary } from '../api';
import { TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useBulkAction } from '../hooks/useBulkAction';
import { networksApi } from '../services/networksApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

const BUILTIN_NETWORKS = ['bridge', 'host', 'none'];

export default function Networks() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageNetworks');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<{ name: string; driver: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['networks', hostId],
    queryFn: () => networksApi.list(hostId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['networks', hostId] });

  const createMutation = useMutation({
    mutationFn: (values: { name: string; driver: string }) => networksApi.create(hostId, values),
    onSuccess: () => {
      message.success('Network created');
      setCreateOpen(false);
      form.resetFields();
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => networksApi.remove(hostId, id),
    onSuccess: () => {
      message.success('Network deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const bulkRemoveMutation = useBulkAction<string>({
    queryKey: ['networks', hostId],
    run: (id) => networksApi.remove(hostId, id),
    successLabel: (count) => `${count} network(s) deleted`,
    onSettled: () => setSelectedKeys([]),
  });

  const columns: ColumnsType<NetworkSummary> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string) => (
        <Space>
          {name}
          {BUILTIN_NETWORKS.includes(name) && <Tag>system</Tag>}
        </Space>
      ),
    },
    { title: 'Driver', dataIndex: 'driver' },
    { title: 'Scope', dataIndex: 'scope' },
    { title: 'Subnet', dataIndex: 'subnet', render: (s: string | null) => s ?? '—' },
    {
      title: 'Actions',
      render: (_, record) =>
        canManage && !BUILTIN_NETWORKS.includes(record.name) && (
          <DeleteButton
            confirmTitle="Delete this network?"
            onConfirm={() => removeMutation.mutate(record.id)}
            loading={removeMutation.isPending && removeMutation.variables === record.id}
          />
        ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Networks">
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Create network
          </Button>
        )}
      </ListPageHeader>
      {canManage && (
        <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} network(s)?`}
            onConfirm={() => bulkRemoveMutation.mutate(selectedKeys as string[])}
            loading={bulkRemoveMutation.isPending}
          >
            Delete
          </DeleteButton>
        </BulkBar>
      )}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={[...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
        loading={isLoading}
        size="middle"
        rowSelection={
          canManage
            ? {
                selectedRowKeys: selectedKeys,
                onChange: setSelectedKeys,
                getCheckboxProps: (record) => ({
                  disabled: BUILTIN_NETWORKS.includes(record.name),
                }),
              }
            : undefined
        }
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
      <Modal
        title="Create network"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create"
        confirmLoading={createMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ driver: 'bridge' }}
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
            <Input placeholder="my-network" />
          </Form.Item>
          <Form.Item name="driver" label="Driver">
            <Select
              options={['bridge', 'overlay', 'macvlan', 'ipvlan'].map((d) => ({ value: d }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
