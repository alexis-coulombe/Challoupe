import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Alert, Button, Form, Input, Modal, Space, Table, Typography } from 'antd';
import { ImportOutlined, LinkOutlined } from '@ant-design/icons';
import type { PortainerStackRef } from '../api';
import { stacksApi } from '../services/stacksApi';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ConnectionForm {
  baseUrl: string;
  username: string;
  password: string;
}

const STACK_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Turns a Portainer stack name into something that satisfies docker compose's project-name
// rules — Portainer is far less strict about what it lets you call a stack.
function suggestStackName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '');
  return cleaned || 'imported-stack';
}

export default function ImportFromPortainerModal({ open, onClose }: Props) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ConnectionForm>();
  const [stacks, setStacks] = useState<PortainerStackRef[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [imported, setImported] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    setStacks(null);
    setImported(new Set());
    form.resetFields();
  }, [open, form]);

  const listMutation = useMutation({
    mutationFn: (values: ConnectionForm) => stacksApi.listPortainer(values),
    onSuccess: (result) => {
      setStacks(result);
      setNames(Object.fromEntries(result.map((s) => [s.id, suggestStackName(s.name)])));
      if (result.length === 0) {
        message.info('Connected, but no Compose-type stacks were found on that Portainer instance');
      }
    },
    onError: (err) => message.error(err.message),
  });

  const importMutation = useMutation({
    mutationFn: (stack: PortainerStackRef) =>
      stacksApi.importPortainer({
        id: stack.id,
        name: names[stack.id],
        ...form.getFieldsValue(),
      }),
    onSuccess: (result, stack) => {
      message.success(`Imported "${result.name}" — review it and deploy when ready`);
      setImported((prev) => new Set(prev).add(stack.id));
      queryClient.invalidateQueries({ queryKey: ['stacks'] });
    },
    onError: (err) => message.error(err.message),
  });

  const importingId =
    importMutation.isPending && importMutation.variables ? importMutation.variables.id : null;

  return (
    <Modal
      title={
        <Space size={8}>
          <ImportOutlined />
          Import from Portainer
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Button onClick={onClose}>Close</Button>
      }
      width={760}
    >
      <Form form={form} layout="vertical" onFinish={(values) => listMutation.mutate(values)}>
        <Space size="large" wrap align="start">
          <Form.Item name="baseUrl" label="Portainer URL" rules={[{ required: true, type: 'url' }]}>
            <Input placeholder="https://portainer.example.com" style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password style={{ width: 180 }} />
          </Form.Item>
          <Form.Item label=" ">
            <Button icon={<LinkOutlined />} htmlType="submit" loading={listMutation.isPending}>
              Connect
            </Button>
          </Form.Item>
        </Space>
      </Form>

      {listMutation.isError && (
        <Alert type="error" showIcon message={listMutation.error.message} style={{ marginBottom: 16 }} />
      )}

      {stacks && (
        <Table
          size="small"
          rowKey="id"
          dataSource={stacks}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'Portainer name', dataIndex: 'name' },
            {
              title: 'Import as',
              render: (_, record) => (
                <Input
                  size="small"
                  value={names[record.id] ?? ''}
                  status={STACK_NAME_RE.test(names[record.id] ?? '') ? undefined : 'error'}
                  onChange={(e) => setNames((prev) => ({ ...prev, [record.id]: e.target.value }))}
                  style={{ width: 200 }}
                />
              ),
            },
            {
              title: '',
              render: (_, record) => (
                <Button
                  size="small"
                  type="primary"
                  icon={<ImportOutlined />}
                  disabled={!STACK_NAME_RE.test(names[record.id] ?? '') || imported.has(record.id)}
                  loading={importingId === record.id}
                  onClick={() => importMutation.mutate(record)}
                >
                  {imported.has(record.id) ? 'Imported' : 'Import'}
                </Button>
              ),
            },
          ]}
        />
      )}

      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        Only the compose file is copied in — nothing is deployed automatically, so any
        containers Portainer already runs for these stacks are left untouched.
      </Typography.Paragraph>
    </Modal>
  );
}
