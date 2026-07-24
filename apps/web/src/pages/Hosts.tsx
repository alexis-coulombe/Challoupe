import { useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
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
import { ApiError, type HostSummary } from '../api';
import { fromISO, TABLE_PAGINATION } from '../utils';
import { useBulkAction } from '../hooks/useBulkAction';
import { hostsApi, type HostFormValues } from '../services/hostsApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  error?: string;
}

const IDLE: TestState = { status: 'idle' };

export default function Hosts() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<HostSummary | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [createForm] = Form.useForm<HostFormValues>();
  const [editForm] = Form.useForm<HostFormValues>();
  const [createTest, setCreateTest] = useState<TestState>(IDLE);
  const [editTest, setEditTest] = useState<TestState>(IDLE);
  const [rowTestingId, setRowTestingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hosts'],
    queryFn: () => hostsApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['hosts'] });

  const createMutation = useMutation({
    mutationFn: (values: HostFormValues) => hostsApi.create(values),
    onSuccess: () => {
      message.success('Host added');
      setCreateOpen(false);
      createForm.resetFields();
      setCreateTest(IDLE);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: HostFormValues & { id: number }) => hostsApi.update(id, values),
    onSuccess: () => {
      message.success('Host updated');
      setEditing(null);
      editForm.resetFields();
      setEditTest(IDLE);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => hostsApi.remove(id),
    onSuccess: () => {
      message.success('Host deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const bulkRemoveMutation = useBulkAction<number>({
    queryKey: ['hosts'],
    run: (id) => hostsApi.remove(id),
    successLabel: (count) => `${count} host(s) deleted`,
    onSettled: () => setSelectedKeys([]),
  });

  const testDraft = async () => {
    setCreateTest({ status: 'testing' });
    try {
      const values = await createForm.validateFields();
      const result = await hostsApi.test(values);
      setCreateTest(result.ok ? { status: 'ok' } : { status: 'error', error: result.error });
    } catch (err) {
      if (err instanceof ApiError) setCreateTest({ status: 'error', error: err.message });
    }
  };

  const testStoredMutation = useMutation({
    mutationFn: (id: number) => hostsApi.testExisting(id),
    onMutate: (id) => setRowTestingId(id),
    onSettled: () => setRowTestingId(null),
    onSuccess: (result) => {
      if (result.ok) message.success('Connected successfully');
      else message.error(result.error ?? 'Could not connect');
    },
    onError: (err) => message.error(err.message),
  });

  const testEditing = async () => {
    if (!editing) return;
    setEditTest({ status: 'testing' });
    const result = await hostsApi.testExisting(editing.id);
    setEditTest(result.ok ? { status: 'ok' } : { status: 'error', error: result.error });
  };

  const columns: ColumnsType<HostSummary> = [
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
              loading={testStoredMutation.isPending && rowTestingId === record.id}
              onClick={() => testStoredMutation.mutate(record.id)}
            />
          </Tooltip>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              setEditTest(IDLE);
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
            setCreateTest(IDLE);
            setCreateOpen(true);
          }}
        >
          Add host
        </Button>
      </ListPageHeader>
      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        <DeleteButton
          confirmTitle={`Delete ${selectedKeys.length} host(s)?`}
          onConfirm={() => bulkRemoveMutation.mutate(selectedKeys as number[])}
          loading={bulkRemoveMutation.isPending}
        >
          Delete
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
          Connects over SSH to run Docker commands remotely — no need to expose the remote
          daemon's API. The connecting user needs the <code>docker</code> CLI in <code>PATH</code>{' '}
          and access to the Docker socket (root or the <code>docker</code> group) on that host.
        </Typography.Paragraph>
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ sshPort: 22 }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item name="name" label="Display name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Production server" />
          </Form.Item>
          <Space size="large" wrap align="start">
            <Form.Item name="sshHost" label="Hostname or IP" rules={[{ required: true }]}>
              <Input placeholder="192.168.1.50" style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="sshPort" label="Port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="sshUsername" label="SSH username" rules={[{ required: true }]}>
              <Input placeholder="deploy" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="sshPrivateKey"
            label="Private key"
            tooltip="Generate a dedicated keypair for this host, e.g. ssh-keygen -t ed25519 -N ''"
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
        title={`Edit ${editing?.name ?? ''}`}
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
          onFinish={(values) => updateMutation.mutate({ id: editing!.id, ...values })}
        >
          <Form.Item name="name" label="Display name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space size="large" wrap align="start">
            <Form.Item name="sshHost" label="Hostname or IP" rules={[{ required: true }]}>
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="sshPort" label="Port" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="sshUsername" label="SSH username" rules={[{ required: true }]}>
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="sshPrivateKey"
            label="Private key"
            tooltip="Never sent back to the browser, leave blank to keep the currently stored key"
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
            tooltip="Never sent back to the browser, leave blank to keep the currently stored passphrase"
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
