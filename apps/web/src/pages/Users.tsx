import { useState, type Key } from 'react';
import {
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
import { PERMISSIONS } from '../models/permissions';
import type { User } from '../models/User';
import type { UserFormValues } from '../models/UserFormValues';
import { fromISO, TABLE_PAGINATION } from '../utils';
import { useAuth } from '../auth';
import { useUsersService, usersService } from '../services/UsersService';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import ListPageHeader from '../components/ListPageHeader';
import PasswordInput from '../components/PasswordInput';

function PermissionFields({ disabled, tooltip }: { disabled: boolean; tooltip?: string }) {
  return (
    <Form.Item
      label="Permissions"
      tooltip={disabled ? tooltip ?? 'Administrators always have every permission' : undefined}
    >
      <Space direction="vertical" size={4}>
        {PERMISSIONS.map((p) => (
          <Form.Item key={p} name={['permissions', p]} valuePropName="checked" noStyle>
            <Checkbox disabled={disabled}>{usersService.permissionLabel(p)}</Checkbox>
          </Form.Item>
        ))}
      </Space>
    </Form.Item>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [editing, setEditing] = useState<User | null>(null);
  const [createForm] = Form.useForm<UserFormValues>();
  const [editForm] = Form.useForm<Omit<UserFormValues, 'username' | 'password'> & { password?: string }>();
  const createRole = Form.useWatch('role', createForm);
  const editRole = Form.useWatch('role', editForm);

  const {
    users: data,
    isLoading,
    create: createMutation,
    update: updateMutation,
    remove: deleteMutation,
    resetTotp: resetTotpMutation,
    bulkRemove: bulkRemoveMutation,
  } = useUsersService({ onBulkRemoved: () => setSelectedKeys([]) });

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
              <Tag key={p}>{usersService.permissionShortLabel(p)}</Tag>
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
              description="Removes their authenticator/backup codes. They'll sign in with just a password until they set it up again."
              onConfirm={() => resetTotpMutation.mutate(record.id)}
            >
              <Button size="small" icon={<SafetyOutlined />} loading={resetTotpMutation.isPending} />
            </Popconfirm>
          )}
          
          {record.id !== me?.id && (
            <DeleteButton
              confirmTitle="Delete this user?"
              onConfirm={() => deleteMutation.mutate(record.id)}
              loading={deleteMutation.isPending && deleteMutation.variables === record.id}
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
          Permanently delete
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
          initialValues={{ role: 'user', permissions: usersService.defaultPermissions() }}
          onFinish={(values) =>
            createMutation.mutate(values, {
              onSuccess: () => {
                setCreateOpen(false);
                createForm.resetFields();
              },
            })
          }
        >
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
            <PasswordInput />
          </Form.Item>

          <Form.Item name="role" label="Role">
            <Select
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Administrator' },
              ]}
            />
          </Form.Item>Delete

          <PermissionFields disabled={createRole === 'admin'} />
        </Form>
      </Modal>

      <Modal
        title={`Editing user: ${editing?.username ?? ''}`}
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
            updateMutation.mutate(
              {
                id: editing!.id,
                role: values.role,
                password: values.password || undefined,
                permissions: values.permissions,
              },
              {
                onSuccess: () => {
                  setEditing(null);
                  editForm.resetFields();
                },
              }
            )
          }
        >
          <Form.Item
            name="password"
            label="New password (leave blank to keep current)"
            rules={[
              {
                validator: (_, value) =>
                  !value || value.length >= 8
                    ? Promise.resolve()
                    : Promise.reject(new Error('At least 8 characters')),
              },
            ]}
          >
            <PasswordInput />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            tooltip={editing?.id === me?.id ? 'You cannot change your own role' : undefined}
          >
            <Select
              disabled={editing?.id === me?.id}
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Administrator' },
              ]}
            />
          </Form.Item>

          <PermissionFields
            disabled={editRole === 'admin' || editing?.id === me?.id}
            tooltip={
              editing?.id === me?.id
                ? 'You cannot edit your own permissions'
                : undefined
            }
          />
        </Form>
      </Modal>
    </div>
  );
}
