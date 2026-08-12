import { useState, type Key } from 'react';
import { useMutation } from '@tanstack/react-query';
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
import { hasPermission } from '../models/permissions';
import type { ImageSummary } from '../models/ImageSummary';
import type { TrivySeverity } from '../models/TrivySeverity';
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
import { useHost } from '../hosts';
import { imagesApi } from '../services/api/imagesApi';
import { trivyApi } from '../services/api/trivyApi';
import { imagesService, useImagesService } from '../services/ImagesService';
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
            Scanning : {image}
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
            <LoadingOutlined /> Currently scanning... this can take a while on the first run while the
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

function BuildFromGitButton({ hostId, onBuilt }: { hostId: string; onBuilt: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<GitBuildForm>();
  const { message } = AntApp.useApp();

  const buildMutation = useMutation({
    mutationFn: (values: GitBuildForm) =>
      imagesApi.buildFromGit(hostId, {
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
        title="Build image from a Git repository"
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
            tooltip="Works with any Git host reachable from the Docker daemon. For a private repo, embed a token: https://<token>@host/user/repo.git"
            rules={[{ required: true, type: 'url', message: 'Enter a valid URL' }]}
          >
            <Input placeholder="https://github.com/user/repo.git" />
          </Form.Item>
          <Space size="large" wrap align="start">
            <Form.Item
              name="ref"
              label="Branch / tag"
              tooltip="Docker will defaults to 'master' if left blank."
            >
              <Input placeholder="master" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="subdir"
              label="Subdirectory"
              tooltip="Optional, specify if the Dockerfile isn't at the repo root"
            >
              <Input placeholder="/docker" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item
              name="dockerfile"
              label="Dockerfile path"
              tooltip="Optional, path to Dockerfile file. Relative to the subdirectory above (or the repo root)"
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
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageImages');
  const [pullRef, setPullRef] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const { data: settings } = useAppSettings();
  const scanEnabled = settings?.featureFlags.vulnerabilityScanner !== false && hasPermission(user, 'useSecurityScanner');

  const {
    images: data,
    isLoading,
    invalidate,
    pull: pullMutation,
    remove: removeMutation,
    prune: pruneMutation,
    checkUpdate: checkUpdateMutation,
    checkAllUpdates: checkAllUpdatesMutation,
    bulkRemove: bulkRemoveMutation,
  } = useImagesService(hostId, { onBulkRemoved: () => setSelectedKeys([]) });

  const columns: ColumnsType<ImageSummary> = [
    {
      title: 'Tags',
      dataIndex: 'tags',
      render: (tags: string[], record) => {
        const updateTag =
          record.updateAvailable === true ? (
            <Tag color="gold">Update available</Tag>
          ) : record.updateAvailable === false ? (
            <Tag color="green">Up to date</Tag>
          ) : null;
        const badge =
          updateTag && record.updateCheckedAt ? (
            <Tooltip title={`Checked ${fromISO(record.updateCheckedAt)}`}>{updateTag}</Tooltip>
          ) : (
            updateTag
          );
        return (
          <Space size={4} wrap>
            {badge}
            {tags.length ? (
              tags.map((t) => <Tag key={t}>{t}</Tag>)
            ) : (
              <Typography.Text type="secondary">&lt;untagged&gt;</Typography.Text>
            )}
          </Space>
        );
      },
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
      title: 'Actions',
      render: (_, record) => (
        <Space>
          {scanEnabled && <ScanButton image={imagesService.resolveRef(record, record.id)} />}

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
              onConfirm={() => removeMutation.mutate(imagesService.resolveRef(record, record.id))}
              loading={removeMutation.isPending && removeMutation.variables === (imagesService.resolveRef(record, record.id))}
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
              placeholder="nginx:alpine"
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              onSearch={(v) => v && pullMutation.mutate(v, { onSuccess: () => setPullRef('') })}
              enterButton="Pull"
              loading={pullMutation.isPending}
              style={{ width: 320 }}
            />

            <Button
              icon={<SyncOutlined />}
              loading={checkAllUpdatesMutation.isPending}
              onClick={() => checkAllUpdatesMutation.mutate()}
            >
              Check updates
            </Button>

            <BuildFromGitButton hostId={hostId} onBuilt={invalidate} />

            <Popconfirm
              title="Remove unused images?"
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
            Permanently delete
          </DeleteButton>
        </BulkBar>
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={[...(data ?? [])].sort((a, b) =>
          (a.tags[0] ?? a.id).localeCompare(b.tags[0] ?? b.id)
        )}
        loading={isLoading}
        size="middle"
        rowSelection={canManage ? { selectedRowKeys: selectedKeys, onChange: setSelectedKeys } : undefined}
        pagination={TABLE_PAGINATION}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}
