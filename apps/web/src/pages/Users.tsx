import { useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined, SafetyOutlined } from '@ant-design/icons';
import { api, PERMISSIONS, type Permission, type Permissions, type User } from '../api';
import { fromISO, TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useBulkAction } from '../hooks/useBulkAction';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';
import PasswordInput from '../components/PasswordInput';

const PERMISSION_LABELS: Record<Permission, string> = {
  manageContainers: 'Manage containers — create & delete',
  manageImages: 'Manage images — pull, delete, prune',
  manageVolumes: 'Manage volumes — create, delete, prune',
  manageNetworks: 'Manage networks — create & delete',
  manageStacks: 'Manage stacks — create, edit, delete',
  exec: 'Terminal — shell access into containers',
  useAi: 'AI Assistant',
  useSecurityScanner: 'Vulnerability scanner',
};

const PERMISSION_SHORT_LABELS: Record<Permission, string> = {
  manageContainers: 'Containers',
  manageImages: 'Images',
  manageVolumes: 'Volumes',
  manageNetworks: 'Networks',
  manageStacks: 'Stacks',
  exec: 'Terminal',
  useAi: 'AI',
  useSecurityScanner: 'Security',
};

// Mirrors the server's defaults: AI and the security scanner stay on since every
// authenticated user could already use them (gated only by the app-wide feature flag);
// everything that creates/destroys Docker resources or opens a shell starts off.
const DEFAULT_FORM_PERMISSIONS: Permissions = {
  manageContainers: false,
  manageImages: false,
  manageVolumes: false,
  manageNetworks: false,
  manageStacks: false,
  exec: false,
  useAi: true,
  useSecurityScanner: true,
};

function PermissionFields({ disabled }: { disabled: boolean }) {
  return (
    <Form.Item
      label="Permissions"
      tooltip={disabled ? 'Administrators always have every permission' : undefined}
    >
      <Space direction="vertical" size={4}>
        {PERMISSIONS.map((p) => (
          <Form.Item key={p} name={['permissions', p]} valuePropName="checked" noStyle>
            <Checkbox disabled={disabled}>{PERMISSION_LABELS[p]}</Checkbox>
          </Form.Item>
        ))}
      </Space>
    </Form.Item>
  );
}

interface UserFormValues {
  username: string;
  password: string;
  role: 'admin' | 'user';
  permissions: Permissions;
}

export default function Users() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [createForm] = Form.useForm<UserFormValues>();
  const [editForm] = Form.useForm<Omit<UserFormValues, 'username' | 'password'> & { password?: string }>();
  const createRole = Form.useWatch('role', createForm);
  const editRole = Form.useWatch('role', editForm);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: (values: UserFormValues) => api.post('/users', values),
    onSuccess: () => {
      message.success('User created');
      setCreateOpen(false);
      createForm.resetFields();
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...values }: { id: number; password?: string; role: string; permissions: Permissions }) =>
      api.put(`/users/${id}`, values),
    onSuccess: () => {
      message.success('User updated');
      setEditing(null);
      editForm.resetFields();
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      message.success('User deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const resetTotpMutation = useMutation({
    mutationFn: (id: number) => api.post(`/users/${id}/totp/disable`),
    onSuccess: () => {
      message.success('Two-factor authentication reset for this user');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const bulkRemoveMutation = useBulkAction<number>({
    queryKey: ['users'],
    run: (id) => api.delete(`/users/${id}`),
    successLabel: (count) => `${count} user(s) deleted`,
    onSettled: () => setSelectedKeys([]),
  });

  const columns: ColumnsType<User> = [
    {
      title: 'Username',
      dataIndex: 'username',
      sorter: (a, b) => a.username.localeCompare(b.username),
      render: (username: string, record) => (
        <Space>
          {username}
          {record.id === me?.id && <Tag color="blue">you</Tag>}
          {record.authProvider === 'oidc' && <Tag color="purple">SSO</Tag>}
          {record.totpEnabled && <Tag color="green">2FA</Tag>}
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (role: string) =>
        role === 'admin' ? <Tag color="gold">admin</Tag> : <Tag>user</Tag>,
    },
    {
      title: 'Permissions',
      render: (_, record) => {
        if (record.role === 'admin') return <Tag color="gold">Full access</Tag>;
        const granted = PERMISSIONS.filter((p) => record.permissions[p]);
        if (granted.length === 0) return <Typography.Text type="secondary">None</Typography.Text>;
        return (
          <Space size={4} wrap>
            {granted.map((p) => (
              <Tag key={p}>{PERMISSION_SHORT_LABELS[p]}</Tag>
            ))}
          </Space>
        );
      },
    },
    { title: 'Created', dataIndex: 'created_at', render: fromISO },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              editForm.setFieldsValue({ role: record.role, password: undefined, permissions: record.permissions });
            }}
          />
          {record.totpEnabled && (
            <Popconfirm
              title="Reset two-factor authentication?"
              description="Removes their authenticator/backup codes — they'll sign in with just a password until they set it up again."
              onConfirm={() => resetTotpMutation.mutate(record.id)}
            >
              <Button size="small" icon={<SafetyOutlined />} loading={resetTotpMutation.isPending} />
            </Popconfirm>
          )}
          {record.id !== me?.id && (
            <DeleteButton
              confirmTitle="Delete this user?"
              onConfirm={() => deleteMutation.mutate(record.id)}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Users">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      </ListPageHeader>
      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        <DeleteButton
          confirmTitle={`Delete ${selectedKeys.length} user(s)?`}
          onConfirm={() => bulkRemoveMutation.mutate(selectedKeys as number[])}
          loading={bulkRemoveMutation.isPending}
        >
          Delete
        </DeleteButton>
      </BulkBar>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={isLoading}
        size="middle"
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
          getCheckboxProps: (record) => ({ disabled: record.id === me?.id }),
        }}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title="Create user"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="Create"
        confirmLoading={createMutation.isPending}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ role: 'user', permissions: DEFAULT_FORM_PERMISSIONS }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 4 }]}>
            <PasswordInput />
          </Form.Item>
          <Form.Item name="role" label="Role">
            <Select
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Administrator' },
              ]}
            />
          </Form.Item>
          <PermissionFields disabled={createRole === 'admin'} />
        </Form>
      </Modal>

      <Modal
        title={`Edit ${editing?.username ?? ''}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        okText="Save"
        confirmLoading={updateMutation.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) =>
            updateMutation.mutate({
              id: editing!.id,
              role: values.role,
              password: values.password || undefined,
              permissions: values.permissions,
            })
          }
        >
          <Form.Item name="password" label="New password (leave blank to keep current)">
            <PasswordInput />
          </Form.Item>
          <Form.Item name="role" label="Role">
            <Select
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Administrator' },
              ]}
            />
          </Form.Item>
          <PermissionFields disabled={editRole === 'admin'} />
        </Form>
      </Modal>
    </div>
  );
}
