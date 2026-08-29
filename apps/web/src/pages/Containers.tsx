import { useEffect, useState, type Key, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CaretRightOutlined,
  MinusCircleOutlined,
  PauseOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { hasPermission } from '../models/permissions';
import type { ContainerSummary } from '../models/ContainerSummary';
import type { ContainerFormValues } from '../models/ContainerFormValues';
import { CONTAINER_STATE_COLORS, fromUnix, TABLE_PAGINATION } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useContainersService, containersService } from '../services/ContainersService';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';
import KeyValueFormList from '../components/KeyValueFormList';
import ListPageHeader from '../components/ListPageHeader';

export default function Containers() {
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageContainers');
  const [createOpen, setCreateOpen] = useState(false);
  const [imageSource, setImageSource] = useState<'existing' | 'git'>('existing');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [form] = Form.useForm<ContainerFormValues>();

  const { data: settings } = useAppSettings();

  const {
    containers: data,
    isLoading,
    networks,
    action: actionMutation,
    remove: removeMutation,
    create: createMutation,
    bulk: bulkMutation,
  } = useContainersService(hostId, settings?.refreshIntervalMs, {
    onCreated: () => {
      setCreateOpen(false);
      setImageSource('existing');
      form.resetFields();
    },
    onBulkDone: () => setSelectedKeys([]),
  });

  useEffect(() => {
    if (settings) form.setFieldValue('restartPolicy', settings.defaultRestartPolicy);
  }, [settings, form]);

  const autoRemove = Form.useWatch('autoRemove', form);
  useEffect(() => {
    if (autoRemove) form.setFieldValue('restartPolicy', 'no');
  }, [autoRemove, form]);

  const bulkButton = (action: string, label: string, icon: ReactNode, danger = false) => (
    <Button
      size="small"
      danger={danger}
      icon={icon}
      loading={bulkMutation.isPending && bulkMutation.variables?.action === action}
      disabled={bulkMutation.isPending}
      onClick={() => bulkMutation.mutate({ action, ids: selectedKeys as string[] })}
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
      filters: containersService.stateFilters(data ?? []),
      onFilter: (value, record) => record.state === value,
    },
    {
      title: 'Image',
      dataIndex: 'image',
      ellipsis: true,
      render: (image: string, record) => (
        <Space size={4}>
          <Link to="/images" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {image}
          </Link>
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
      render: (ports: ContainerSummary['ports']) => containersService.formatPorts(ports),
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
            {canManage &&
              (record.state === 'running' ? (
                <>
                  <Tooltip title="Pause">
                    <Button size="small" icon={<PauseOutlined />} onClick={() => act('pause')} />
                  </Tooltip>

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
              ))}
            {canManage && (record.state === 'running' || record.state === 'paused') && (
              <Tooltip title="Kill (force stop)">
                <Popconfirm title="Force kill this container?" onConfirm={() => act('kill')}>
                  <Button size="small" danger icon={<PoweroffOutlined />} />
                </Popconfirm>
              </Tooltip>
            )}

            {canManage && (
              <DeleteButton
                confirmTitle="Delete this container?"
                onConfirm={() => removeMutation.mutate(record.id)}
                loading={removeMutation.isPending && removeMutation.variables === record.id}
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
        {canManage && bulkButton('start', 'Start', <CaretRightOutlined />)}
        {canManage && bulkButton('pause', 'Pause', <PauseOutlined />)}
        {canManage && bulkButton('stop', 'Stop', <StopOutlined />)}
        {canManage && bulkButton('restart', 'Restart', <ReloadOutlined />)}
        {canManage && (
          <Popconfirm
            title={`Force kill ${selectedKeys.length} container(s)?`}
            description="Sends SIGKILL immediately, without a graceful shutdown."
            onConfirm={() => bulkMutation.mutate({ action: 'kill', ids: selectedKeys as string[] })}
          >
            <Button
              size="small"
              danger
              icon={<PoweroffOutlined />}
              loading={bulkMutation.isPending && bulkMutation.variables?.action === 'kill'}
              disabled={bulkMutation.isPending}
            >
              Kill
            </Button>
          </Popconfirm>
        )}

        {canManage && (
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} container(s)?`}
            onConfirm={() => bulkMutation.mutate({ action: 'remove', ids: selectedKeys as string[] })}
            loading={bulkMutation.isPending && bulkMutation.variables?.action === 'remove'}
            disabled={bulkMutation.isPending}
          >
            Permanently delete
          </DeleteButton>
        )}
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
        title="Create container"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setImageSource('existing');
        }}
        onOk={() => form.submit()}
        okText="Create"
        okButtonProps={{ style: imageSource === 'git' ? { display: 'none' } : undefined }}
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

          {imageSource === 'git' && (
            <Alert
              type="info"
              showIcon
              message="Build the image on the Images page first"
              description="Git-based builds happen from the Images page. Build your image there, then come back here and create the container from it once it's ready."
              action={
                <Link to="/images" onClick={() => setCreateOpen(false)}>
                  <Button size="small" type="primary">
                    Go to Images
                  </Button>
                </Link>
              }
              style={{ marginBottom: 24 }}
            />
          )}

          {imageSource === 'existing' && (
            <>
              <Form.Item
                name="image"
                label="Image"
                rules={[{ required: true }]}
              >
                <Input placeholder="e.g. nginx:alpine (pulled if missing)" />
              </Form.Item>

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
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
