import { useState, type Key } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BranchesOutlined,
  ClearOutlined,
  LoadingOutlined,
  SecurityScanOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { hasPermission, type ImageSummary, type TrivySeverity } from '../api';
import {
  CONSOLE_BG,
  CONSOLE_BORDER,
  CONSOLE_TEXT,
  fromISO,
  formatBytes,
  fromUnix,
  SECURITY_COLOR,
  SEVERITY_COLORS,
  TABLE_PAGINATION,
} from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { useBulkAction } from '../hooks/useBulkAction';
import { imagesApi } from '../services/imagesApi';
import { trivyApi } from '../services/trivyApi';
import BulkBar from '../components/BulkBar';
import DeleteButton from '../components/DeleteButton';
import KeyValueFormList from '../components/KeyValueFormList';
import ListPageHeader from '../components/ListPageHeader';
import SecurityButton from '../components/SecurityButton';

const SEVERITY_ORDER: TrivySeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function ScanButton({ image }: { image: string }) {
  const [open, setOpen] = useState(false);
  const scanMutation = useMutation({
    mutationFn: () => trivyApi.scan(image),
  });

  const openAndScan = () => {
    setOpen(true);
    scanMutation.mutate();
  };

  const result = scanMutation.data;

  return (
    <>
      <SecurityButton size="small" onClick={openAndScan}>
        Scan
      </SecurityButton>
      <Modal
        title={
          <Space size={8}>
            <SecurityScanOutlined style={{ color: SECURITY_COLOR }} />
            Vulnerability scan : {image}
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Button type="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
        width={760}
      >
        {scanMutation.isPending && (
          <Typography.Text type="secondary">
            <LoadingOutlined /> Scanning… this can take a while on the first run while the
            vulnerability database downloads.
          </Typography.Text>
        )}
        {scanMutation.isError && (
          <Typography.Text type="danger">{(scanMutation.error as Error).message}</Typography.Text>
        )}
        {result && (
          <>
            <Space size={8} wrap style={{ marginBottom: 16 }}>
              {result.vulnerabilities.length === 0 ? (
                <Tag color="green">No known vulnerabilities</Tag>
              ) : (
                SEVERITY_ORDER.filter((sev) => result.counts[sev] > 0).map((sev) => (
                  <Tag key={sev} color={SEVERITY_COLORS[sev]}>
                    {sev}: {result.counts[sev]}
                  </Tag>
                ))
              )}
            </Space>
            <Table
              size="small"
              rowKey={(v) => `${v.id}-${v.pkgName}`}
              dataSource={result.vulnerabilities}
              pagination={TABLE_PAGINATION}
              scroll={{ x: 'max-content' }}
              columns={[
                {
                  title: 'Severity',
                  dataIndex: 'severity',
                  width: 110,
                  render: (severity: TrivySeverity) => <Tag color={SEVERITY_COLORS[severity]}>{severity}</Tag>,
                },
                {
                  title: 'CVE',
                  dataIndex: 'id',
                  render: (id: string, v) =>
                    v.url ? (
                      <a href={v.url} target="_blank" rel="noreferrer">
                        {id}
                      </a>
                    ) : (
                      id
                    ),
                },
                { title: 'Package', dataIndex: 'pkgName' },
                { title: 'Installed', dataIndex: 'installedVersion' },
                { title: 'Fixed in', dataIndex: 'fixedVersion', render: (v: string) => v || '—' },
                { title: 'Title', dataIndex: 'title', ellipsis: true },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}

interface GitBuildForm {
  repoUrl: string;
  ref?: string;
  subdir?: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: Array<{ value: string }>;
}

function BuildFromGitButton({ onBuilt }: { onBuilt: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<GitBuildForm>();
  const { message } = AntApp.useApp();

  const buildMutation = useMutation({
    mutationFn: (values: GitBuildForm) =>
      imagesApi.buildFromGit({
        repoUrl: values.repoUrl,
        ref: values.ref || undefined,
        subdir: values.subdir || undefined,
        dockerfile: values.dockerfile || undefined,
        tag: values.tag,
        buildArgs: (values.buildArgs ?? []).map((a) => a.value),
      }),
    onSuccess: (result) => {
      if (result.ok) {
        message.success(`Built ${result.tag}`);
        onBuilt();
      } else {
        message.error(`Build failed: ${result.error}`);
      }
    },
    onError: (err) => message.error(err.message),
  });

  const result = buildMutation.data;
  const close = () => {
    setOpen(false);
    buildMutation.reset();
    form.resetFields();
  };

  return (
    <>
      <Button icon={<BranchesOutlined />} onClick={() => setOpen(true)}>
        Build from Git
      </Button>
      <Modal
        title="Build an image from a Git repository"
        open={open}
        onCancel={close}
        onOk={() => form.submit()}
        okText="Build"
        confirmLoading={buildMutation.isPending}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(values) => buildMutation.mutate(values)}>
          <Form.Item
            name="repoUrl"
            label="Repository URL"
            tooltip="Works with GitHub, GitLab, Gitea, or any Git host reachable from the Docker daemon. For a private repo, embed a token: https://<token>@host/user/repo.git"
            rules={[{ required: true, type: 'url', message: 'Enter a valid URL' }]}
          >
            <Input placeholder="https://github.com/user/repo.git" />
          </Form.Item>
          <Space size="large" wrap align="start">
            <Form.Item
              name="ref"
              label="Branch / tag"
              tooltip="Docker only defaults to 'master' if this is left blank. Specify it explicitly for repos whose default branch is 'main' or anything else"
            >
              <Input placeholder="main" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="subdir"
              label="Subdirectory"
              tooltip="Build context subdirectory, if the Dockerfile isn't at the repo root"
            >
              <Input placeholder="e.g. backend" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="dockerfile"
              label="Dockerfile path"
              tooltip="Relative to the subdirectory above (or the repo root)"
            >
              <Input placeholder="Dockerfile" style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="tag" label="Image tag" rules={[{ required: true }]}>
            <Input placeholder="myapp:latest" />
          </Form.Item>
          <Form.Item label="Build arguments">
            <KeyValueFormList name="buildArgs" addLabel="Add build argument" />
          </Form.Item>
        </Form>
        {result && (
          <>
            <Typography.Text type={result.ok ? 'success' : 'danger'} strong>
              {result.ok ? `Built ${result.tag}` : `Build failed: ${result.error}`}
            </Typography.Text>
            <pre
              style={{
                background: CONSOLE_BG,
                border: `1px solid ${CONSOLE_BORDER}`,
                color: CONSOLE_TEXT,
                padding: 12,
                borderRadius: 8,
                maxHeight: 320,
                overflow: 'auto',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                marginTop: 8,
              }}
            >
              {result.log || '(no output)'}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}

export default function Images() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'manageImages');
  const [pullRef, setPullRef] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const { data: settings } = useAppSettings();
  const scanEnabled =
    settings?.featureFlags.vulnerabilityScanner !== false && hasPermission(user, 'useSecurityScanner');

  const { data, isLoading } = useQuery({
    queryKey: ['images'],
    queryFn: () => imagesApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['images'] });

  const pullMutation = useMutation({
    mutationFn: (reference: string) => imagesApi.pull(reference),
    onSuccess: () => {
      message.success('Image pulled');
      setPullRef('');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (ref: string) => imagesApi.remove(ref),
    onSuccess: () => {
      message.success('Image deleted');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const pruneMutation = useMutation({
    mutationFn: () => imagesApi.prune(),
    onSuccess: (result) => {
      message.success(`Prune complete: ${formatBytes(result.spaceReclaimed)} reclaimed`);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const checkUpdateMutation = useMutation({
    mutationFn: (id: string) => imagesApi.checkUpdate(id),
    onSuccess: (result) => {
      if (result.updateAvailable === true) message.info(`Update available for ${result.reference}`);
      else if (result.updateAvailable === false) message.success(`${result.reference} is up to date`);
      else message.warning(result.error ?? 'Could not determine update status');
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const checkAllUpdatesMutation = useMutation({
    mutationFn: () => imagesApi.checkUpdates(),
    onSuccess: (result) => {
      message.success(`Checked ${result.checked} image(s) : ${result.updatesAvailable} update(s) available`);
      if (result.errors.length) message.warning(`${result.errors.length} check(s) could not be completed`);
      invalidate();
    },
    onError: (err) => message.error(err.message),
  });

  const byId = new Map((data ?? []).map((i) => [i.id, i]));
  const bulkRemoveMutation = useBulkAction<string>({
    queryKey: ['images'],
    run: (id) => {
      const ref = byId.get(id)?.tags[0] ?? id;
      return imagesApi.remove(ref);
    },
    successLabel: (count) => `${count} image(s) deleted`,
    onSettled: () => setSelectedKeys([]),
  });

  const columns: ColumnsType<ImageSummary> = [
    {
      title: 'Tags',
      dataIndex: 'tags',
      render: (tags: string[]) =>
        tags.length ? (
          <Space size={4} wrap>
            {tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">&lt;untagged&gt;</Typography.Text>
        ),
    },
    {
      title: 'ID',
      dataIndex: 'id',
      render: (id: string) => (
        <Typography.Text code>{id.replace('sha256:', '').slice(0, 12)}</Typography.Text>
      ),
    },
    {
      title: 'Size',
      dataIndex: 'size',
      render: formatBytes,
      sorter: (a, b) => a.size - b.size,
    },
    { title: 'Created', dataIndex: 'created', render: fromUnix },
    {
      title: 'Update',
      dataIndex: 'updateAvailable',
      render: (updateAvailable: boolean | null, record) => {
        const tag =
          updateAvailable === true ? (
            <Tag color="gold">Update available</Tag>
          ) : updateAvailable === false ? (
            <Tag color="green">Up to date</Tag>
          ) : (
            <Typography.Text type="secondary">Not checked</Typography.Text>
          );
        return record.updateCheckedAt ? (
          <Tooltip title={`Checked ${fromISO(record.updateCheckedAt)}`}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    {
      title: 'Actions',
      render: (_, record) => (
        <Space>
          {scanEnabled && <ScanButton image={record.tags[0] ?? record.id} />}
          {canManage && (
            <Tooltip title={record.tags.length ? 'Check for updates' : 'Untagged. Nothing to check'}>
              <Button
                size="small"
                icon={<SyncOutlined />}
                disabled={!record.tags.length}
                loading={checkUpdateMutation.isPending && checkUpdateMutation.variables === record.id}
                onClick={() => checkUpdateMutation.mutate(record.id)}
              />
            </Tooltip>
          )}
          {canManage && (
            <DeleteButton
              confirmTitle="Delete this image?"
              onConfirm={() => removeMutation.mutate(record.tags[0] ?? record.id)}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ListPageHeader title="Images">
        {canManage && (
          <Space wrap>
            <Input.Search
              placeholder="e.g. nginx:alpine"
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              onSearch={(v) => v && pullMutation.mutate(v)}
              enterButton="Pull"
              loading={pullMutation.isPending}
              style={{ width: 320 }}
            />
            <Button
              icon={<SyncOutlined />}
              loading={checkAllUpdatesMutation.isPending}
              onClick={() => checkAllUpdatesMutation.mutate()}
            >
              Check for updates
            </Button>
            <BuildFromGitButton onBuilt={invalidate} />
            <Popconfirm
              title="Remove unused (dangling) images?"
              onConfirm={() => pruneMutation.mutate()}
            >
              <Button icon={<ClearOutlined />} loading={pruneMutation.isPending}>
                Prune
              </Button>
            </Popconfirm>
          </Space>
        )}
      </ListPageHeader>
      {canManage && (
        <BulkBar count={selectedKeys.length} onClear={() => setSelectedKeys([])}>
          <DeleteButton
            confirmTitle={`Delete ${selectedKeys.length} image(s)?`}
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
        dataSource={data}
        loading={isLoading}
        size="middle"
        rowSelection={canManage ? { selectedRowKeys: selectedKeys, onChange: setSelectedKeys } : undefined}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}
