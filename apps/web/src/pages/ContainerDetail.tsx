import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  PauseOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { hasPermission } from '../models/permissions';
import { containersApi } from '../services/api/containersApi';
import {
  AI_COLOR,
  AI_COLOR_BORDER,
  AI_COLOR_SOFT,
  CONSOLE_BG,
  CONSOLE_BORDER,
  CONSOLE_TEXT,
  CONTAINER_STATE_COLORS,
} from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { useHost } from '../hosts';
import { useContainerLogStream } from '../hooks/useContainerLogStream';
import { useOllamaStream } from '../hooks/useOllamaStream';
import AiButton from '../components/AiButton';
import ContainerStats from '../components/ContainerStats';
import ContainerTerminal from '../components/ContainerTerminal';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';

function DiagnoseButton({ hostId, containerId }: { hostId: string; containerId: string }) {
  const [open, setOpen] = useState(false);
  const { text, status, error, start } = useOllamaStream();

  const openAndDiagnose = () => {
    setOpen(true);
    start(`/hosts/${hostId}/ai/diagnose/${containerId}`);
  };

  return (
    <>
      <AiButton size="small" onClick={openAndDiagnose}>
        Diagnose with AI
      </AiButton>
      <Modal
        title={
          <Space size={8}>
            <RobotOutlined style={{ color: AI_COLOR }} />
            AI diagnosis
          </Space>
        }
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Button type="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        {status === 'connecting' && (
          <Typography.Text type="secondary">
            <LoadingOutlined /> Connecting to Ollama…
          </Typography.Text>
        )}
        {status === 'error' && <Typography.Text type="danger">{error}</Typography.Text>}
        {(status === 'streaming' || status === 'done') && (
          <div
            style={{
              background: AI_COLOR_SOFT,
              border: `1px solid ${AI_COLOR_BORDER}`,
              borderRadius: 8,
              padding: '10px 14px',
            }}
          >
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {text}
              {status === 'streaming' && <LoadingOutlined style={{ marginLeft: 8 }} />}
            </Typography.Paragraph>
          </div>
        )}
      </Modal>
    </>
  );
}

function LogsPanel({
  hostId,
  containerId,
  running,
  defaultTail,
  aiEnabled,
}: {
  hostId: string;
  containerId: string;
  running: boolean;
  defaultTail: number;
  aiEnabled: boolean;
}) {
  const [tail, setTail] = useState(defaultTail);
  const [tailTouched, setTailTouched] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const { text: logs, loading: logsLoading } = useContainerLogStream(hostId, containerId, tail, true);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Adopt the configured default once it loads, unless the user already picked a value.
    if (!tailTouched) {
      setTail(defaultTail);
    }
  }, [defaultTail, tailTouched]);

  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <Card
      size="small"
      title="Logs"
      extra={
        <Space wrap size={8}>
          {aiEnabled && <DiagnoseButton hostId={hostId} containerId={containerId} />}

          <span>Backlog:</span>
          <Select
            size="small"
            value={tail}
            onChange={(v) => {
              setTail(v);
              setTailTouched(true);
            }}
            options={[100, 200, 500, 1000, 5000].map((v) => ({ value: v, label: v }))}
          />

          <span>Auto-scroll</span>
          <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
        </Space>
      }
    >
      {!running && (
        <Typography.Text type="secondary">
          Container is stopped. Showing the last available logs.
        </Typography.Text>
      )}

      <pre
        ref={preRef}
        style={{
          background: CONSOLE_BG,
          border: `1px solid ${CONSOLE_BORDER}`,
          color: CONSOLE_TEXT,
          padding: 12,
          borderRadius: 8,
          maxHeight: 500,
          overflow: 'auto',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          margin: 0,
          marginTop: running ? 0 : 8,
        }}
      >
        {logsLoading ? (
          <Typography.Text type="secondary">
            <LoadingOutlined /> Pulling logs…
          </Typography.Text>
        ) : (
          logs || '(no logs yet)'
        )}
      </pre>
    </Card>
  );
}

export default function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const { hostId } = useHost();
  const canManage = hasPermission(user, 'manageContainers');
  const canExec = hasPermission(user, 'exec');

  const { data: settings } = useAppSettings();

  const { data: info } = useQuery({
    queryKey: ['container', hostId, id],
    queryFn: () => containersApi.get(hostId, id!),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const actionMutation = useMutation({
    mutationFn: (action: string) => containersApi.action(hostId, id!, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['container', hostId, id] }),
    onError: (err) => message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: () => containersApi.remove(hostId, id!),
    onSuccess: () => {
      message.success('Container deleted');
      navigate('/containers');
    },
    onError: (err) => message.error(err.message),
  });

  const state = info?.State.Status;
  const running = state === 'running';
  const name = info?.Name.replace(/^\//, '');
  const ports = Object.entries(info?.NetworkSettings.Ports ?? {})
    .filter(([, bindings]) => bindings?.length)
    .map(([key, bindings]) => `${bindings![0].HostPort}→${key}`)
    .join(', ');

  if (!id) {
    return null;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Link to="/containers">
          <Button icon={<ArrowLeftOutlined />}>Back</Button>
        </Link>

        <Typography.Title level={3} style={{ margin: 0 }}>
          {name ?? '…'}
        </Typography.Title>

        {state && <Tag color={CONTAINER_STATE_COLORS[state] ?? 'default'}>{state}</Tag>}

        {name && <FavoriteButton type="container" id={id} label={name} />}

        {canManage &&
          (running ? (
            <>
              <Button icon={<PauseOutlined />} onClick={() => actionMutation.mutate('pause')}>
                Pause
              </Button>
              <Button icon={<StopOutlined />} onClick={() => actionMutation.mutate('stop')}>
                Stop
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => actionMutation.mutate('restart')}>
                Restart
              </Button>
            </>
          ) : (
            <Button
              type="primary"
              icon={<CaretRightOutlined />}
              onClick={() => actionMutation.mutate(state === 'paused' ? 'unpause' : 'start')}
            >
              Start
            </Button>
          ))}

        {canManage && (running || state === 'paused') && (
          <Popconfirm
            title="Force kill this container?"
            description="Sends SIGKILL immediately, without a graceful shutdown."
            onConfirm={() => actionMutation.mutate('kill')}
          >
            <Button danger icon={<PoweroffOutlined />}>
              Kill
            </Button>
          </Popconfirm>
        )}

        {canManage && (
          <DeleteButton
            size="middle"
            confirmTitle="Delete this container?"
            onConfirm={() => removeMutation.mutate()}
            loading={removeMutation.isPending}
          >
            Permanently delete
          </DeleteButton>
        )}
      </Space>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small">
          <Descriptions.Item label="Image">
            {info?.Config.Image && <Link to="/images">{info.Config.Image}</Link>}
          </Descriptions.Item>

          <Descriptions.Item label="Created">
            {info ? new Date(info.Created).toLocaleString() : ''}
          </Descriptions.Item>

          <Descriptions.Item label="Ports">{ports || 'n/a'}</Descriptions.Item>

          <Descriptions.Item label="Restart policy">
            {info?.HostConfig.RestartPolicy.Name || 'no'}
          </Descriptions.Item>
          
          <Descriptions.Item label="Mounts" span={2}>
            {info?.Mounts.length ? (
              <Space size={4} wrap split=",">
                {info.Mounts.map((m, i) => (
                  <span key={i}>
                    {m.Name ? <Link to="/volumes">{m.Name}</Link> : m.Source}
                    {`→${m.Destination}`}
                  </span>
                ))}
              </Space>
            ) : (
              '—'
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        defaultActiveKey="logs"
        items={[
          {
            key: 'logs',
            label: 'Logs',
            children: (
              <LogsPanel
                hostId={hostId}
                containerId={id}
                running={running}
                defaultTail={settings?.defaultLogTail ?? 200}
                aiEnabled={settings?.featureFlags.aiAssistant !== false && hasPermission(user, 'useAi')}
              />
            ),
          },
          {
            key: 'stats',
            label: 'Stats',
            children: <ContainerStats hostId={hostId} containerId={id} running={running} />,
          },
          ...(canExec
            ? [
                {
                  key: 'terminal',
                  label: 'Terminal',
                  children: (
                    <ContainerTerminal
                      hostId={hostId}
                      containerId={id}
                      running={running}
                      defaultShell={settings?.defaultTerminalShell ?? '/bin/sh'}
                      theme={settings?.terminalTheme}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
