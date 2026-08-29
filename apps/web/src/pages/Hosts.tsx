import { useState, type Key } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { ApiError } from '../api';
import type { HostSummary } from '../models/HostSummary';
import type { HostTestState } from '../models/HostTestState';
import { fromISO, TABLE_PAGINATION } from '../utils';
import { hostsApi } from '../services/api/hostsApi';
import { useHostsService, hostsService } from '../services/HostsService';
import type { HostFormValues } from '../models/HostFormValues';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

export default function Hosts() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<HostSummary | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [createForm] = Form.useForm<HostFormValues>();
  const [editForm] = Form.useForm<HostFormValues>();
  const [createTest, setCreateTest] = useState<HostTestState>(hostsService.idleTestState);
  const [editTest, setEditTest] = useState<HostTestState>(hostsService.idleTestState);

  const {
    hosts: data,
    isLoading,
    create: createMutation,
    update: updateMutation,
    remove: deleteMutation,
    testStored: testStoredMutation,
    bulkRemove: bulkRemoveMutation,
  } = useHostsService({ onBulkRemoved: () => setSelectedKeys([]) });

  const testDraft = async () => {
    setCreateTest({ status: 'testing' });
    try {
      const values = await createForm.validateFields();
      const result = await hostsApi.test(values);
      setCreateTest(hostsService.testResultState(result));
    } catch (err) {
      if (err instanceof ApiError) setCreateTest({ status: 'error', error: err.message });
    }
  };

  const testEditing = async () => {
    if (!editing) return;
    setEditTest({ status: 'testing' });
    const result = await hostsApi.testExisting(editing.id);
    setEditTest(hostsService.testResultState(result));
  };

  const columns: ColumnsType<HostSummary> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 90,
      render: (host_id: number) => (
        <Typography.Text code copyable={{ text: String(host_id) }}>
          {host_id}
        </Typography.Text>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'SSH connection',
      render: (_, record) => (
        <Typography.Text code>
          {record.sshUsername}@{record.sshHost}:{record.sshPort}
        </Typography.Text>
      ),
    },
    {
      title: 'Passphrase',
      dataIndex: 'hasPassphrase',
      render: (has: boolean) => (has ? <Tag>set</Tag> : <Typography.Text type="secondary">none</Typography.Text>),
    },
    { title: 'Added', dataIndex: 'createdAt', render: fromISO },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Test connection">
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={testStoredMutation.isPending && testStoredMutation.variables === record.id}
              onClick={() => testStoredMutation.mutate(record.id)}
            />
          </Tooltip>

          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              setEditTest(hostsService.idleTestState);
              editForm.setFieldsValue({
                name: record.name,
                sshHost: record.sshHost,
                sshPort: record.sshPort,
                sshUsername: record.sshUsername,
                sshPrivateKey: '',
                sshPassphrase: '',
              });
            }}
          />

          <DeleteButton
            confirmTitle="Delete this host? Containers running there are unaffected, only Challoupe's connection to it is removed."
            onConfirm={() => deleteMutation.mutate(record.id)}
            loading={deleteMutation.isPending && deleteMutation.variables === record.id}
          />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Hosts">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setCreateTest(hostsService.idleTestState);
            setCreateOpen(true);
          }}
        >
          Add SSH host
        </Button>
      </ListPageHeader>

      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        <DeleteButton
          confirmTitle={`Delete ${selectedKeys.length} host(s)?`}
          onConfirm={() => bulkRemoveMutation.mutate(selectedKeys as number[])}
          loading={bulkRemoveMutation.isPending}
        >
          Permanently delete
        </DeleteButton>
      </BulkBar>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={[...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
        loading={isLoading}
        size="middle"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title="Add a Docker host"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="Add host"
        confirmLoading={createMutation.isPending}
        width={640}
      >
        <Typography.Paragraph type="secondary">
          Connects over SSH to run Docker commands remotely.
          The connecting user needs the <code>docker</code> CLI in <code>PATH</code>{' '}
          and access to the Docker socket (root or the <code>docker</code> group) on that host.
        </Typography.Paragraph>

        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ sshPort: 22 }}
          onFinish={(values) =>
            createMutation.mutate(values, {
              onSuccess: () => {
                setCreateOpen(false);
                createForm.resetFields();
                setCreateTest(hostsService.idleTestState);
              },
            })
          }
        >
          <Form.Item name="name" label="Display name" rules={[{ required: true }]}>
            <Input placeholder="Production server" />
          </Form.Item>

          <Space size="large" wrap align="start">
            <Form.Item name="sshHost" label="Hostname or IP" rules={[{ required: true }]}>
              <Input placeholder="192.168.1.50" style={{ width: 220 }} />
            </Form.Item>

            <Form.Item name="sshPort" label="Port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} step={1} style={{ width: 100 }} />
            </Form.Item>

            <Form.Item name="sshUsername" label="SSH username" rules={[{ required: true }]}>
              <Input placeholder="deploy" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="sshPrivateKey"
            label="Private key"
            tooltip="Generate a dedicated keypair for this host using ssh-keygen -t ed25519 -N ''"
            rules={[{ required: true }]}
          >
            <Input.TextArea
              rows={6}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </Form.Item>

          <Form.Item name="sshPassphrase" label="Passphrase (optional)">
            <Input.Password placeholder="Only if the key above is encrypted" />
          </Form.Item>
        </Form>
        <Space align="center">
          <Button loading={createTest.status === 'testing'} onClick={testDraft}>
            Test connection
          </Button>

          {createTest.status === 'ok' && <Tag color="green">Connected</Tag>}
        </Space>

        {createTest.status === 'error' && (
          <Alert
            type="error"
            showIcon
            message="Could not connect"
            description={createTest.error}
            style={{ marginTop: 12 }}
          />
        )}
      </Modal>

      <Modal
        title={`Editing: ${editing?.name ?? ''}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        okText="Save"
        confirmLoading={updateMutation.isPending}
        width={640}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) =>
            updateMutation.mutate(
              { id: editing!.id, ...values },
              {
                onSuccess: () => {
                  setEditing(null);
                  editForm.resetFields();
                  setEditTest(hostsService.idleTestState);
                },
              }
            )
          }
        >
          <Form.Item name="name" label="Display name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Space size="large" wrap align="start">
            <Form.Item name="sshHost" label="Hostname or IP" rules={[{ required: true }]}>
              <Input style={{ width: 220 }} />
            </Form.Item>

            <Form.Item name="sshPort" label="Port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} step={1} style={{ width: 100 }} />
            </Form.Item>

            <Form.Item name="sshUsername" label="SSH username" rules={[{ required: true }]}>
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>

          <Form.Item
            name="sshPrivateKey"
            label="Private key"
            tooltip="Leave blank to keep the currently stored key"
          >
            <Input.TextArea
              rows={6}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder="Leave blank to keep current"
            />
          </Form.Item>

          <Form.Item
            name="sshPassphrase"
            label="Passphrase"
            tooltip="Leave blank to keep the currently stored passphrase"
          >
            <Input.Password placeholder="Leave blank to keep current" />
          </Form.Item>
        </Form>
        <Space align="center">
          <Button loading={editTest.status === 'testing'} onClick={testEditing}>
            Test connection
          </Button>

          {editTest.status === 'ok' && <Tag color="green">Connected</Tag>}
        </Space>
        
        {editTest.status === 'error' && (
          <Alert
            type="error"
            showIcon
            message="Could not connect"
            description={editTest.error}
            style={{ marginTop: 12 }}
          />
        )}
      </Modal>
    </div>
  );
}
