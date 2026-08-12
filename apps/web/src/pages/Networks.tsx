import { useState, type Key } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { hasPermission } from '../models/permissions';
import type { NetworkSummary } from '../models/NetworkSummary';
import { TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useNetworksService, networksService } from '../services/NetworksService';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

export default function Networks() {
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageNetworks');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<{ name: string; driver: string }>();

  const {
    networks: data,
    isLoading,
    create: createMutation,
    remove: removeMutation,
    bulkRemove: bulkRemoveMutation,
  } = useNetworksService(hostId, { onBulkRemoved: () => setSelectedKeys([]) });

  const columns: ColumnsType<NetworkSummary> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string) => (
        <Space>
          {name}
          {networksService.isBuiltin(name) && <Tag>system</Tag>}
        </Space>
      ),
    },
    { title: 'Driver', dataIndex: 'driver' },
    { title: 'Scope', dataIndex: 'scope' },
    { title: 'Subnet', dataIndex: 'subnet', render: (s: string | null) => s ?? '—' },
    {
      title: 'Actions',
      render: (_, record) =>
        canManage && !networksService.isBuiltin(record.name) && (
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
            Permanently delete
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
                  disabled: networksService.isBuiltin(record.name),
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
          onFinish={(values) =>
            createMutation.mutate(values, {
              onSuccess: () => {
                setCreateOpen(false);
                form.resetFields();
              },
            })
          }
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true },
              { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, message: 'Invalid name' },
            ]}
          >
            <Input placeholder="my-network-name" />
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
