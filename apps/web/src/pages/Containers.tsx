import { useEffect, useState, type Key, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { hasPermission, type ContainerSummary } from '../api';
import { CONTAINER_STATE_COLORS, fromUnix, runBulk, TABLE_PAGINATION, type BulkResult } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { containersApi, type ContainerCreateRequest } from '../services/containersApi';
import { imagesApi } from '../services/imagesApi';
import { networksApi } from '../services/networksApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';
import KeyValueFormList from '../components/KeyValueFormList';
import ListPageHeader from '../components/ListPageHeader';

interface CreateForm {
  name?: string;
  image: string;
  network?: string;
  command?: string;
  workingDir?: string;
  user?: string;
  labels?: Array<{ value: string }>;
  ports?: Array<{ host: number; container: number; protocol: 'tcp' | 'udp' }>;
  env?: Array<{ value: string }>;
  volumes?: Array<{ host: string; container: string }>;
  restartPolicy: string;
  privileged?: boolean;
  autoRemove?: boolean;
  memoryMb?: number;
  cpus?: number;
  gitRepoUrl?: string;
  gitRef?: string;
  gitSubdir?: string;
  gitDockerfile?: string;
}

export default function Containers() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'manageContainers');
  const [createOpen, setCreateOpen] = useState(false);
  const [imageSource, setImageSource] = useState<'existing' | 'git'>('existing');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<CreateForm>();

  const { data: settings } = useAppSettings();

  const { data, isLoading } = useQuery({
    queryKey: ['containers'],
    queryFn: () => containersApi.list(),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const { data: networks } = useQuery({
    queryKey: ['networks'],
    queryFn: () => networksApi.list(),
  });

  useEffect(() => {
    if (settings) form.setFieldValue('restartPolicy', settings.defaultRestartPolicy);
  }, [settings, form]);

  const autoRemove = Form.useWatch('autoRemove', form);
  useEffect(() => {
    if (autoRemove) form.setFieldValue('restartPolicy', 'no');
  }, [autoRemove, form]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['containers'] });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => containersApi.action(id, action),
    onSuccess: invalidate,
    onError: (err) => message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => containersApi.remove(id),
    onSuccess: () => {
      message.success('Container deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: async (values: CreateForm) => {
      if (imageSource === 'git') {
        if (!values.gitRepoUrl) throw new Error('Repository URL is required');
        const build = await imagesApi.buildFromGit({
          repoUrl: values.gitRepoUrl,
          ref: values.gitRef || undefined,
          subdir: values.gitSubdir || undefined,
          dockerfile: values.gitDockerfile || undefined,
          tag: values.image,
        });
        if (!build.ok) throw new Error(`Build failed: ${build.error}`);
      }
      const body: ContainerCreateRequest = {
        name: values.name || undefined,
        image: values.image,
        network: values.network || undefined,
        command: values.command ? values.command.trim().split(/\s+/) : [],
        workingDir: values.workingDir || undefined,
        user: values.user || undefined,
        labels: (values.labels ?? []).map((l) => l.value),
        ports: values.ports ?? [],
        env: (values.env ?? []).map((e) => e.value),
        volumes: values.volumes ?? [],
        restartPolicy: values.restartPolicy,
        privileged: values.privileged ?? false,
        autoRemove: values.autoRemove ?? false,
        memoryMb: values.memoryMb || undefined,
        cpus: values.cpus || undefined,
      };
      return containersApi.create(body);
    },
    onSuccess: () => {
      message.success('Container created and started');
      setCreateOpen(false);
      setImageSource('existing');
      form.resetFields();
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const onBulkDone = ({ ok, errors }: BulkResult, label: string) => {
    if (ok) message.success(`${ok} container(s) ${label}`);
    if (errors.length) message.error(`${errors.length} failure(s) : ${errors[0]}`);
    setSelectedKeys([]);
    invalidate();
  };

  const bulkMutation = useMutation({
    mutationFn: (action: string) =>
      runBulk(selectedKeys as string[], (id) =>
        action === 'remove' ? containersApi.remove(id) : containersApi.action(id, action)
      ),
    onSuccess: (result, action) =>
      onBulkDone(
        result,
        { start: 'started', stop: 'stopped', restart: 'restarted', remove: 'deleted' }[action] ??
          action
      ),
  });

  const bulkButton = (action: string, label: string, icon: ReactNode, danger = false) => (
    <Button
      size="small"
      danger={danger}
      icon={icon}
      loading={bulkMutation.isPending && bulkMutation.variables === action}
      disabled={bulkMutation.isPending}
      onClick={() => bulkMutation.mutate(action)}
    >
      {label}
    </Button>
  );

  const columns: ColumnsType<ContainerSummary> = [
    {
      key: 'favorite',
      width: 40,
      render: (_, record) => <FavoriteButton type="container" id={record.id} label={record.name} />,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name, record) => <Link to={`/containers/${record.id}`}>{name}</Link>,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: 'State',
      dataIndex: 'state',
      render: (state, record) => (
        <Tooltip title={record.status}>
          <Tag color={CONTAINER_STATE_COLORS[state] ?? 'default'}>{state}</Tag>
        </Tooltip>
      ),
      filters: [...new Set((data ?? []).map((c) => c.state))].map((s) => ({ text: s, value: s })),
      onFilter: (value, record) => record.state === value,
    },
    {
      title: 'Image',
      dataIndex: 'image',
      ellipsis: true,
      render: (image: string, record) => (
        <Space size={4}>
          <Typography.Text ellipsis>{image}</Typography.Text>
          {record.updateAvailable === true && (
            <Tooltip title="A newer image is available for this container's image (check on the Images page)">
              <Tag color="gold">Update available</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Ports',
      dataIndex: 'ports',
      render: (ports: ContainerSummary['ports']) =>
        [
          ...new Set(
            ports
              .filter((p) => p.PublicPort)
              .map((p) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`)
          ),
        ].join(', '),
    },
    {
      title: 'Stack',
      dataIndex: 'composeProject',
      render: (project: string | null) =>
        project ? <Link to={`/stacks/${project}`}>{project}</Link> : null,
    },
    { title: 'Created', dataIndex: 'created', render: fromUnix },
    {
      title: 'Actions',
      render: (_, record) => {
        const act = (action: string) => actionMutation.mutate({ id: record.id, action });
        return (
          <Space size="small">
            {record.state === 'running' ? (
              <>
                <Tooltip title="Stop">
                  <Button size="small" icon={<StopOutlined />} onClick={() => act('stop')} />
                </Tooltip>
                <Tooltip title="Restart">
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => act('restart')} />
                </Tooltip>
              </>
            ) : record.state === 'paused' ? (
              <Tooltip title="Resume">
                <Button size="small" icon={<CaretRightOutlined />} onClick={() => act('unpause')} />
              </Tooltip>
            ) : (
              <Tooltip title="Start">
                <Button size="small" icon={<CaretRightOutlined />} onClick={() => act('start')} />
              </Tooltip>
            )}
            {canManage && (
              <DeleteButton
                confirmTitle="Delete this container?"
                onConfirm={() => removeMutation.mutate(record.id)}
              />
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <ListPageHeader title="Containers">
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Create container
          </Button>
        )}
      </ListPageHeader>
      <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
        {bulkButton('start', 'Start', <CaretRightOutlined />)}
        {bulkButton('stop', 'Stop', <StopOutlined />)}
        {bulkButton('restart', 'Restart', <ReloadOutlined />)}
        {canManage && (
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} container(s)?`}
            onConfirm={() => bulkMutation.mutate('remove')}
            disabled={bulkMutation.isPending}
          >
            Delete
          </DeleteButton>
        )}
      </BulkBar>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={isLoading}
        size="middle"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
      <Modal
        title="Create container"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setImageSource('existing');
        }}
        onOk={() => form.submit()}
        okText="Create"
        confirmLoading={createMutation.isPending}
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ restartPolicy: 'no' }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item label="Image source">
            <Segmented
              value={imageSource}
              onChange={(v) => setImageSource(v as 'existing' | 'git')}
              options={[
                { label: 'Existing image', value: 'existing' },
                { label: 'Build from Git', value: 'git' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="image"
            label={imageSource === 'git' ? 'Image tag to build' : 'Image'}
            rules={[{ required: true }]}
          >
            <Input placeholder={imageSource === 'git' ? 'myapp:latest' : 'e.g. nginx:alpine (pulled if missing)'} />
          </Form.Item>
          {imageSource === 'git' && (
            <>
              <Form.Item
                name="gitRepoUrl"
                label="Repository URL"
                rules={[{ required: true, type: 'url', message: 'Enter a valid URL' }]}
                tooltip="GitHub, GitLab, Gitea, or any Git host reachable from the Docker daemon. For a private repo, embed a token: https://<token>@host/user/repo.git"
              >
                <Input placeholder="https://github.com/user/repo.git" />
              </Form.Item>
              <Space size="large" wrap align="start">
                <Form.Item
                  name="gitRef"
                  label="Branch / tag"
                  tooltip="Docker only defaults to 'master' if this is left blank. Specify it explicitly for repos whose default branch is 'main' or anything else"
                >
                  <Input placeholder="main" style={{ width: 180 }} />
                </Form.Item>
                <Form.Item
                  name="gitSubdir"
                  label="Subdirectory"
                  tooltip="Build context subdirectory, if the Dockerfile isn't at the repo root"
                >
                  <Input placeholder="e.g. backend" style={{ width: 180 }} />
                </Form.Item>
                <Form.Item
                  name="gitDockerfile"
                  label="Dockerfile path"
                  tooltip="Relative to the subdirectory above (or the repo root)"
                >
                  <Input placeholder="Dockerfile" style={{ width: 180 }} />
                </Form.Item>
              </Space>
            </>
          )}
          <Form.Item
            name="name"
            label="Name (optional)"
            rules={[{ pattern: /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, message: 'Invalid name' }]}
          >
            <Input placeholder="my-container" />
          </Form.Item>
          <Form.Item label="Published ports">
            <Form.List name="ports">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" wrap>
                      <Form.Item name={[field.name, 'host']} rules={[{ required: true }]}>
                        <InputNumber placeholder="Host" min={1} max={65535} />
                      </Form.Item>
                      →
                      <Form.Item name={[field.name, 'container']} rules={[{ required: true }]}>
                        <InputNumber placeholder="Container" min={1} max={65535} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'protocol']} initialValue="tcp">
                        <Select
                          style={{ width: 80 }}
                          options={[{ value: 'tcp' }, { value: 'udp' }]}
                        />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button block icon={<PlusOutlined />} onClick={() => add()}>
                    Add port
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item label="Environment variables">
            <KeyValueFormList name="env" addLabel="Add variable" />
          </Form.Item>
          <Form.Item label="Volumes (bind mounts)">
            <Form.List name="volumes">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" wrap>
                      <Form.Item name={[field.name, 'host']} rules={[{ required: true }]}>
                        <Input placeholder="/host/path or volume" style={{ width: 220 }} />
                      </Form.Item>
                      →
                      <Form.Item name={[field.name, 'container']} rules={[{ required: true }]}>
                        <Input placeholder="/container/path" style={{ width: 200 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button block icon={<PlusOutlined />} onClick={() => add()}>
                    Add volume
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item
            name="restartPolicy"
            label="Restart policy"
            tooltip={autoRemove ? "Disabled while auto-remove is on" : undefined}
          >
            <Select
              disabled={autoRemove}
              options={[
                { value: 'no', label: 'Never' },
                { value: 'always', label: 'Always' },
                { value: 'unless-stopped', label: 'Unless stopped' },
                { value: 'on-failure', label: 'On failure' },
              ]}
            />
          </Form.Item>
          <Collapse
            ghost
            items={[
              {
                key: 'advanced',
                label: 'Advanced settings',
                children: (
                  <>
                    <Form.Item name="network" label="Network">
                      <Select
                        allowClear
                        placeholder="default (bridge)"
                        options={(networks ?? []).map((n) => ({ value: n.name, label: n.name }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="command"
                      label="Command"
                      tooltip="Overrides the image's default command, e.g. npm start"
                    >
                      <Input placeholder="e.g. npm start" />
                    </Form.Item>
                    <Space wrap>
                      <Form.Item name="workingDir" label="Working directory" style={{ width: 260 }}>
                        <Input placeholder="/app" />
                      </Form.Item>
                      <Form.Item
                        name="user"
                        label="User"
                        style={{ width: 160 }}
                        rules={[
                          { pattern: /^[a-zA-Z0-9_.:-]*$/, message: 'Invalid user' },
                        ]}
                      >
                        <Input placeholder="1000:1000" />
                      </Form.Item>
                    </Space>
                    <Form.Item label="Labels">
                      <KeyValueFormList name="labels" addLabel="Add label" />
                    </Form.Item>
                    <Space size="large">
                      <Form.Item name="privileged" label="Privileged" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item name="autoRemove" label="Auto-remove on exit" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Space>
                    <Space>
                      <Form.Item
                        name="memoryMb"
                        label="Memory limit (MB)"
                        tooltip={
                          user?.role !== 'admin' && settings?.maxContainerMemoryMb
                            ? `Your quota caps this at ${settings.maxContainerMemoryMb} MB`
                            : undefined
                        }
                      >
                        <InputNumber
                          min={1}
                          max={user?.role !== 'admin' ? settings?.maxContainerMemoryMb ?? undefined : undefined}
                          placeholder={
                            user?.role !== 'admin' && settings?.maxContainerMemoryMb
                              ? `up to ${settings.maxContainerMemoryMb}`
                              : 'unlimited'
                          }
                          style={{ width: 160 }}
                        />
                      </Form.Item>
                      <Form.Item
                        name="cpus"
                        label="CPU limit (cores)"
                        tooltip={
                          user?.role !== 'admin' && settings?.maxContainerCpus
                            ? `Your quota caps this at ${settings.maxContainerCpus} cores`
                            : undefined
                        }
                      >
                        <InputNumber
                          min={0.1}
                          step={0.1}
                          max={user?.role !== 'admin' ? settings?.maxContainerCpus ?? undefined : undefined}
                          placeholder={
                            user?.role !== 'admin' && settings?.maxContainerCpus
                              ? `up to ${settings.maxContainerCpus}`
                              : 'unlimited'
                          }
                          style={{ width: 160 }}
                        />
                      </Form.Item>
                    </Space>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
