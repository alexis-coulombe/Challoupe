import { useState, type Key } from 'react';
import { AutoComplete, Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClearOutlined, PlusOutlined } from '@ant-design/icons';
import { hasPermission } from '../models/permissions';
import type { VolumeSummary } from '../models/VolumeSummary';
import { fromISO, TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useVolumesService, volumesService } from '../services/VolumesService';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

const DRIVER_OPTIONS = [{ value: 'local' }];

interface VolumeFormValues {
  name: string;
  driver: string;
  bindMount?: boolean;
  hostPath?: string;
}

export default function Volumes() {
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageVolumes');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<VolumeFormValues>();
  const bindMount = Form.useWatch('bindMount', form);

  const {
    volumes: data,
    isLoading,
    create: createMutation,
    remove: removeMutation,
    prune: pruneMutation,
    bulkRemove: bulkRemoveMutation,
  } = useVolumesService(hostId, { onBulkRemoved: () => setSelectedKeys([]) });

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
            Permanently delete
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
          onFinish={(values) =>
            createMutation.mutate(
              {
                name: values.name,
                driver: values.bindMount ? 'local' : values.driver,
                driverOpts: values.bindMount ? volumesService.bindMountOpts(values.hostPath!) : undefined,
              },
              {
                onSuccess: () => {
                  setCreateOpen(false);
                  form.resetFields();
                },
              }
            )
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
            <Input placeholder="my-volume-name" />
          </Form.Item>

          <Form.Item name="driver" label="Driver">
            <AutoComplete
              options={DRIVER_OPTIONS}
              disabled={bindMount}
              placeholder="local"
              filterOption={(input, option) => !!option?.value.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>

          <Form.Item name="bindMount" valuePropName="checked" style={{ marginBottom: bindMount ? 8 : 0 }}>
            <Checkbox onChange={(e) => e.target.checked && form.setFieldValue('driver', 'local')}>
              Bind to a host path
            </Checkbox>
          </Form.Item>

          {bindMount && (
            <Form.Item
              name="hostPath"
              label="Host path"
              tooltip="An absolute path on the host. The volume's data will live there instead of Docker's own storage area."
              rules={[{ required: true, message: 'Enter a host path' }]}
            >
              <Input placeholder="/data/my-volume" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
