import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  Upload,
} from 'antd';
import type { Color } from 'antd/es/color-picker';
import {
  AlertOutlined,
  ApiOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  GithubOutlined,
  GitlabOutlined,
  GoogleOutlined,
  BgColorsOutlined,
  DashboardOutlined,
  EyeOutlined,
  NotificationOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SecurityScanOutlined,
  SettingOutlined,
  SyncOutlined,
  UploadOutlined,
  WarningOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import { ApiError, type AppSettings, type BackupFile, type NotificationFormat } from '../api';
import { AI_COLOR, AI_COLOR_BORDER, fromISO, SECURITY_COLOR, SECURITY_COLOR_BORDER, formatBytes } from '../utils';
import { findSsoProvider, guessSsoProvider, parseKnownSsoProvider, SSO_PROVIDERS } from '../data/ssoProviders';
import AiButton from '../components/AiButton';
import SecurityButton from '../components/SecurityButton';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { aiApi } from '../services/aiApi';
import { backupApi } from '../services/backupApi';
import { imagesApi } from '../services/imagesApi';
import { notificationsApi } from '../services/notificationsApi';
import { settingsApi } from '../services/settingsApi';
import { systemApi } from '../services/systemApi';

const REFRESH_INTERVAL_OPTIONS = [
  { value: 3000, label: '3 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
  { value: 30000, label: '30 seconds' },
];

const LOG_TAIL_OPTIONS = [100, 200, 500, 1000, 5000].map((v) => ({ value: v, label: `${v} lines` }));

const SHELL_OPTIONS = [
  { value: '/bin/sh', label: '/bin/sh' },
  { value: '/bin/bash', label: '/bin/bash' },
  { value: '/bin/ash', label: '/bin/ash' },
];

const DEFAULT_TERMINAL_THEME = { background: '#0b0e14', foreground: '#c9d1d9', cursor: '#3b82f6' };

// Only providers with a real ant-design brand icon get one; the rest (Okta, Auth0,
// Keycloak, Authentik, Authelia) are plain text rather than an invented/approximate logo.
const SSO_PROVIDER_ICONS: Record<string, ReactNode> = {
  google: <GoogleOutlined />,
  microsoft: <WindowsOutlined />,
  gitlab: <GitlabOutlined />,
  github: <GithubOutlined />,
};

const SSO_PROVIDER_OPTIONS = SSO_PROVIDERS.map((p) => ({
  value: p.id,
  disabled: p.disabled,
  label: (
    <Space size={6}>
      {SSO_PROVIDER_ICONS[p.id]}
      {p.name}
      {p.disabled && <Typography.Text type="secondary">— not supported</Typography.Text>}
    </Space>
  ),
}));

export default function Settings() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<AppSettings>();
  const isAdmin = user?.role === 'admin';

  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => systemApi.info('local'),
  });

  const { data: settings } = useAppSettings();

  const [models, setModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [notifTestStatus, setNotifTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [notifTestError, setNotifTestError] = useState('');
  const [ntfyTestStatus, setNtfyTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [ntfyTestError, setNtfyTestError] = useState('');
  const [ssoProvider, setSsoProvider] = useState('custom');
  const [ssoProviderValues, setSsoProviderValues] = useState<Record<string, string>>({});

  const pullTrivyMutation = useMutation({
    mutationFn: (reference: string) => imagesApi.pull('local', reference),
    onSuccess: () => message.success('Trivy image pulled and ready to scan'),
    onError: (err) => message.error(err.message),
  });

  useEffect(() => {
    if (settings) form.setFieldsValue(settings);
  }, [settings, form]);

  // Restore which SSO provider template (if any) is behind the stored issuer URL, so
  // reopening Settings shows the right picker selection instead of always falling back to
  // "Custom". The stored `providerId` names the template directly once one has been saved;
  // for settings saved before that field existed, fall back to a best-effort URL guess.
  useEffect(() => {
    if (!settings) return;
    const { providerId, issuerUrl } = settings.oidc;
    if (providerId) {
      setSsoProvider(providerId);
      setSsoProviderValues(parseKnownSsoProvider(providerId, issuerUrl));
    } else {
      const guess = guessSsoProvider(issuerUrl);
      setSsoProvider(guess?.id ?? 'custom');
      setSsoProviderValues(guess?.values ?? {});
    }
  }, [settings]);

  const handleSsoProviderChange = (id: string) => {
    setSsoProvider(id);
    const template = findSsoProvider(id);
    const defaults: Record<string, string> = {};
    for (const field of template.fields) if (field.defaultValue) defaults[field.key] = field.defaultValue;
    setSsoProviderValues(defaults);
    form.setFieldValue(['oidc', 'providerId'], id === 'custom' ? '' : id);
    if (id !== 'custom') {
      form.setFieldValue(['oidc', 'buttonLabel'], template.buttonLabel);
      form.setFieldValue(['oidc', 'issuerUrl'], template.buildIssuerUrl(defaults));
    }
  };

  const handleSsoProviderFieldChange = (key: string, value: string) => {
    const next = { ...ssoProviderValues, [key]: value };
    setSsoProviderValues(next);
    form.setFieldValue(['oidc', 'issuerUrl'], findSsoProvider(ssoProvider).buildIssuerUrl(next));
  };

  const saveMutation = useMutation({
    mutationFn: (values: AppSettings) => settingsApi.update(values),
    onSuccess: () => {
      message.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => message.error(err.message),
  });

  const resetMutation = useMutation({
    mutationFn: () => settingsApi.reset(),
    onSuccess: async () => {
      message.success('Factory reset complete. Create a new administrator account to continue.');
      await refresh();
      navigate('/login', { replace: true });
    },
    onError: (err) => message.error(err.message),
  });

  const handleResetToDefaults = () => {
    modal.confirm({
      title: 'Factory reset Challoupe?',
      content:
        'This deletes every users, stacks and settings. This cannot be undone, and you will need to create a new administrator account afterward.',
      okText: 'Delete everything',
      okButtonProps: { danger: true },
      onOk: () => resetMutation.mutate(),
    });
  };

  const restoreMutation = useMutation({
    mutationFn: (data: BackupFile) => backupApi.restore(data),
    onSuccess: async () => {
      message.success('Restore complete. Please sign in again.');
      await logout().catch(() => {}); // the server session is already destroyed; this just clears local state
      navigate('/login', { replace: true });
    },
    onError: (err) => message.error(err.message),
  });

  const handleRestoreFile = (file: File): boolean => {
    file.text().then((text) => {
      let parsed: BackupFile;
      try {
        parsed = JSON.parse(text);
      } catch {
        message.error('Could not read that file as JSON');
        return;
      }
      if (parsed.version !== 1) {
        message.error('Unsupported backup file version');
        return;
      }
      modal.confirm({
        title: 'Restore this backup?',
        content: `This replaces all ${parsed.users.length} user(s), every setting, and ${parsed.stacks.length} stack(s) with the ones in this file, it cannot be undone.`,
        okText: 'Restore',
        okButtonProps: { danger: true },
        onOk: () => restoreMutation.mutate(parsed),
      });
    });
    return false; // prevent antd's Upload from trying to actually upload the file anywhere
  };

  const { data: scheduledBackups } = useQuery({
    queryKey: ['scheduled-backups'],
    queryFn: () => backupApi.listScheduled(),
  });

  const invalidateScheduledBackups = () =>
    queryClient.invalidateQueries({ queryKey: ['scheduled-backups'] });

  const runBackupMutation = useMutation({
    mutationFn: () => backupApi.runScheduled(),
    onSuccess: (res) => {
      message.success(`Wrote ${res.filename}`);
      invalidateScheduledBackups();
    },
    onError: (err) => message.error(err.message),
  });

  const deleteBackupMutation = useMutation({
    mutationFn: (filename: string) => backupApi.removeScheduled(filename),
    onSuccess: () => {
      message.success('Backup deleted');
      invalidateScheduledBackups();
    },
    onError: (err) => message.error(err.message),
  });

  const testOllama = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      // Tests the URL currently typed in the field, not whatever was last saved. Otherwise
      // editing the Base URL and testing before hitting Save would silently test the old value.
      const baseUrl = form.getFieldValue('ollamaBaseUrl') as string;
      const res = await aiApi.models(baseUrl);
      setModels(res.models);
      setTestStatus('ok');
      if (res.models.length === 0) {
        message.warning('Connected, but no models are pulled yet. Run "ollama pull <model>".');
      } else {
        message.success(`Connected. Found ${res.models.length} model${res.models.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof ApiError ? err.message : 'Could not reach Ollama');
    }
  };

  const testWebhook = async () => {
    setNotifTestStatus('testing');
    setNotifTestError('');
    try {
      // Tests the values currently typed in the form, not whatever was last saved.
      const webhookUrl = form.getFieldValue(['notifications', 'webhookUrl']) as string;
      const format = form.getFieldValue(['notifications', 'format']) as NotificationFormat;
      await notificationsApi.test(webhookUrl, format);
      setNotifTestStatus('ok');
      message.success('Test notification sent.');
    } catch (err) {
      setNotifTestStatus('error');
      setNotifTestError(err instanceof ApiError ? err.message : 'Could not reach the webhook');
    }
  };

  const testNtfy = async () => {
    setNtfyTestStatus('testing');
    setNtfyTestError('');
    try {
      // Tests the values currently typed in the form, not whatever was last saved.
      const serverUrl = form.getFieldValue(['ntfy', 'serverUrl']) as string;
      const topic = form.getFieldValue(['ntfy', 'topic']) as string;
      const username = form.getFieldValue(['ntfy', 'username']) as string;
      const password = form.getFieldValue(['ntfy', 'password']) as string;
      await notificationsApi.testNtfy(serverUrl, topic, username, password);
      setNtfyTestStatus('ok');
      message.success('Test notification sent.');
    } catch (err) {
      setNtfyTestStatus('error');
      setNtfyTestError(err instanceof ApiError ? err.message : 'Could not reach ntfy');
    }
  };

  const currentModel = Form.useWatch('ollamaModel', form);
  const modelOptions = Array.from(new Set([...models, ...(currentModel ? [currentModel] : [])])).map((m) => ({
    value: m,
    label: m,
  }));
  const aiEnabled = Form.useWatch(['featureFlags', 'aiAssistant'], form) ?? true;
  const securityEnabled = Form.useWatch(['featureFlags', 'vulnerabilityScanner'], form) ?? true;
  const ssoEnabled = Form.useWatch(['oidc', 'enabled'], form) ?? false;
  const imageUpdateCheckEnabled = Form.useWatch(['imageUpdateCheck', 'enabled'], form) ?? false;
  const terminalTheme = Form.useWatch('terminalTheme', form) ?? DEFAULT_TERMINAL_THEME;
  const scheduledBackupEnabled = Form.useWatch(['scheduledBackup', 'enabled'], form) ?? false;
  const notificationsEnabled = Form.useWatch(['notifications', 'enabled'], form) ?? false;
  const ntfyEnabled = Form.useWatch(['ntfy', 'enabled'], form) ?? false;
  const watchdogEnabled = Form.useWatch(['aiWatchdog', 'enabled'], form) ?? false;
  const watchdogAuditEnabled = Form.useWatch(['aiWatchdog', 'checkAuditLog'], form) ?? false;
  const resourceAlertsEnabled = Form.useWatch(['resourceAlerts', 'enabled'], form) ?? false;
  const trivyImage = Form.useWatch('trivyImage', form);

  const integrationsTabLabel = (
    <Space size={6}>
      <ApiOutlined />
      Integrations
    </Space>
  );

  const notificationsTabLabel = (
    <Space size={6}>
      <BellOutlined />
      Notifications
    </Space>
  );

  const ssoTabLabel = (
    <Space size={6}>
      <SafetyCertificateOutlined />
      Single Sign-On
    </Space>
  );

  const backupTabLabel = (
    <Space size={6}>
      <CloudDownloadOutlined />
      Backup
    </Space>
  );

  return (
    <div>
      <Typography.Title level={3}>Settings</Typography.Title>

      <Form
        form={form}
        layout="vertical"
        disabled={!isAdmin}
        onFinish={(values) => saveMutation.mutate(values)}
      >
        <Tabs
          defaultActiveKey="general"
          items={[
            {
              key: 'general',
              label: (
                <Space size={6}>
                  <SettingOutlined />
                  General
                </Space>
              ),
              forceRender: true,
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <DesktopOutlined style={{ marginRight: 8 }} />
                      Environment
                    </Typography.Title>
                    <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
                      <Descriptions.Item label="Host">{info?.name}</Descriptions.Item>
                      <Descriptions.Item label="Docker version">{info?.serverVersion}</Descriptions.Item>
                      <Descriptions.Item label="API version">{info?.apiVersion}</Descriptions.Item>
                      <Descriptions.Item label="Operating system">{info?.os}</Descriptions.Item>
                      <Descriptions.Item label="Kernel">{info?.kernel}</Descriptions.Item>
                      <Descriptions.Item label="Architecture">{info?.arch}</Descriptions.Item>
                      <Descriptions.Item label="CPU / Memory">
                        {info ? `${info.cpus} CPU · ${formatBytes(info.memory)}` : ''}
                      </Descriptions.Item>
                      <Descriptions.Item label="Docker socket">{info?.dockerSock}</Descriptions.Item>
                      <Descriptions.Item label="Data directory">{info?.dataDir}</Descriptions.Item>
                    </Descriptions>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <SettingOutlined style={{ marginRight: 8 }} />
                      Defaults
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Applied when browsing containers and creating new ones.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start">
                      <Form.Item
                        name="refreshIntervalMs"
                        label="Refresh interval"
                        tooltip="How often container lists, stacks, and the header stats poll for updates"
                      >
                        <Select style={{ width: 200 }} options={REFRESH_INTERVAL_OPTIONS} />
                      </Form.Item>
                      <Form.Item
                        name="defaultLogTail"
                        label="Default log backlog"
                        tooltip="How many lines a container's Logs tab requests when first opened"
                      >
                        <Select style={{ width: 200 }} options={LOG_TAIL_OPTIONS} />
                      </Form.Item>
                    </Space>
                    <Space size="large" wrap align="start">
                      <Form.Item name="defaultRestartPolicy" label="Default restart policy for new containers">
                        <Select
                          style={{ width: 200 }}
                          options={[
                            { value: 'no', label: 'Never' },
                            { value: 'always', label: 'Always' },
                            { value: 'unless-stopped', label: 'Unless stopped' },
                            { value: 'on-failure', label: 'On failure' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="defaultTerminalShell"
                        label="Default terminal shell"
                        tooltip="Shell used when opening a container's Terminal tab"
                      >
                        <Select style={{ width: 200 }} options={SHELL_OPTIONS} />
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <DashboardOutlined style={{ marginRight: 8 }} />
                      Resource quotas
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Caps applied when a non-admin user creates a container. Administrators are
                      never limited. Leave blank for unlimited.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start">
                      <Form.Item name="maxContainerMemoryMb" label="Max memory for non-admins (MB)">
                        <InputNumber min={1} placeholder="Unlimited" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item name="maxContainerCpus" label="Max CPU cores for non-admins">
                        <InputNumber min={0.1} step={0.1} placeholder="Unlimited" style={{ width: 200 }} />
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <SyncOutlined style={{ marginRight: 8 }} />
                      Image update checks
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      A manual "Check for updates" is always available on the Images page. Turning
                      this on also checks every pulled image against its registry on a timer.
                    </Typography.Paragraph>
                    <Space align="center" style={{ display: 'flex', marginBottom: 16 }}>
                      <Form.Item name={['imageUpdateCheck', 'enabled']} valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Check for image updates automatically</Typography.Text>
                    </Space>
                    <Space size="large" wrap align="start">
                      <Form.Item name={['imageUpdateCheck', 'intervalHours']} label="Check interval (hours)">
                        <InputNumber
                          min={1}
                          max={24 * 30}
                          disabled={!imageUpdateCheckEnabled}
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <BgColorsOutlined style={{ marginRight: 8 }} />
                      Terminal appearance
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Colors used by every container's Terminal tab.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="end">
                      <Form.Item
                        name={['terminalTheme', 'background']}
                        label="Background"
                        getValueFromEvent={(color: Color) => color.toHexString()}
                      >
                        <ColorPicker disabledAlpha />
                      </Form.Item>
                      <Form.Item
                        name={['terminalTheme', 'foreground']}
                        label="Text"
                        getValueFromEvent={(color: Color) => color.toHexString()}
                      >
                        <ColorPicker disabledAlpha />
                      </Form.Item>
                      <Form.Item
                        name={['terminalTheme', 'cursor']}
                        label="Cursor"
                        getValueFromEvent={(color: Color) => color.toHexString()}
                      >
                        <ColorPicker disabledAlpha />
                      </Form.Item>
                      <Form.Item label=" ">
                        <Button onClick={() => form.setFieldValue('terminalTheme', DEFAULT_TERMINAL_THEME)}>
                          Reset to default
                        </Button>
                      </Form.Item>
                    </Space>
                    <div
                      style={{
                        maxWidth: 360,
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontFamily: 'monospace',
                        fontSize: 13,
                        background: terminalTheme.background,
                        color: terminalTheme.foreground,
                      }}
                    >
                      <span style={{ borderLeft: `2px solid ${terminalTheme.cursor}` }}>
                        user@challoupe:~$ echo hello
                      </span>
                    </div>
                  </Card>
                </Space>
              ),
            },
            {
              key: 'integrations',
              label: integrationsTabLabel,
              forceRender: true,
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <Card style={{ border: `1px solid ${AI_COLOR_BORDER}` }}>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <RobotOutlined style={{ color: AI_COLOR, marginRight: 8 }} />
                      AI Assistant
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item
                        name={['featureFlags', 'aiAssistant']}
                        valuePropName="checked"
                        noStyle
                      >
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Enable AI features</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Point this at a local or LAN{' '}
                      <a href="https://ollama.com" target="_blank" rel="noreferrer">
                        Ollama
                      </a>{' '}
                      server to unlock log diagnosis, AI stack generation, and the chat assistant.
                      Nothing leaves this address. Turning this off hides every AI entry point in the
                      app and disables it on the server too.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start">
                      <Form.Item name="ollamaBaseUrl" label="Base URL">
                        <Input style={{ width: 260 }} placeholder="http://localhost:11434" disabled={!aiEnabled} />
                      </Form.Item>
                      <Form.Item
                        name="ollamaModel"
                        label="Model"
                        tooltip="Also used by the AI watchdog below: a 20B+ parameter, non-reasoning model is recommended there to avoid false positives and slow responses"
                      >
                        <AutoComplete
                          style={{ width: 200 }}
                          options={modelOptions}
                          placeholder="e.g. llama3.1"
                          disabled={!aiEnabled}
                        />
                      </Form.Item>
                      {isAdmin && (
                        <Form.Item label=" ">
                          <AiButton loading={testStatus === 'testing'} onClick={testOllama} disabled={!aiEnabled}>
                            Test connection
                          </AiButton>
                        </Form.Item>
                      )}
                    </Space>
                    {testStatus === 'error' && (
                      <Alert
                        type="error"
                        showIcon
                        message="Could not reach Ollama"
                        description={testError}
                        style={{ marginBottom: 0, maxWidth: 600 }}
                      />
                    )}

                    <Divider />

                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <EyeOutlined style={{ marginRight: 8 }} />
                      AI Watchdog
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item name={['aiWatchdog', 'enabled']} valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Enable AI watchdog</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Watches for problems in the background and sends a finding over the
                      notification channels below.
                    </Typography.Paragraph>
                    <Space direction="vertical">
                      <Form.Item name={['aiWatchdog', 'checkContainerEvents']} valuePropName="checked" noStyle>
                        <Checkbox disabled={!watchdogEnabled || !aiEnabled}>
                          Diagnose containers that crash, are OOM-killed, or fail their health
                          check with the model above (needs AI features enabled)
                        </Checkbox>
                      </Form.Item>
                      <Form.Item name={['aiWatchdog', 'checkAuditLog']} valuePropName="checked" noStyle>
                        <Checkbox disabled={!watchdogEnabled}>
                          Scan the audit log for repeated failed logins or permission denials
                        </Checkbox>
                      </Form.Item>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640, marginTop: 8 }}>
                      For reliable container diagnosis, use a model with at least 20B parameters
                      and no extended "thinking"/reasoning step: smaller or reasoning models are
                      more prone to false positives and hallucinations, and are slower to respond.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start">
                      <Form.Item
                        name={['aiWatchdog', 'auditCheckIntervalMinutes']}
                        label="Audit scan interval (minutes)"
                      >
                        <InputNumber
                          min={1}
                          max={24 * 60}
                          disabled={!watchdogEnabled || !watchdogAuditEnabled}
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card style={{ border: `1px solid ${SECURITY_COLOR_BORDER}` }}>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <SecurityScanOutlined style={{ color: SECURITY_COLOR, marginRight: 8 }} />
                      Security Scanner
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item
                        name={['featureFlags', 'vulnerabilityScanner']}
                        valuePropName="checked"
                        noStyle
                      >
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Enable vulnerability scanning</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Runs{' '}
                      <a href="https://trivy.dev" target="_blank" rel="noreferrer">
                        Trivy
                      </a>{' '}
                      as a one-off local container (mounted against the Docker socket) to unlock the
                      "Scan" action on the Images page. The first scan downloads a vulnerability
                      database, cached locally so later scans are fast. Turning this off hides the
                      scan button and disables it on the server too.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start">
                      <Form.Item
                        name="trivyImage"
                        label="Trivy image"
                        tooltip="Which aquasec/trivy image tag to run for each scan"
                      >
                        <Input style={{ width: 260 }} placeholder="aquasec/trivy:latest" disabled={!securityEnabled} />
                      </Form.Item>
                      {isAdmin && (
                        <Form.Item label=" ">
                          <SecurityButton
                            loading={pullTrivyMutation.isPending}
                            disabled={!securityEnabled || !trivyImage}
                            onClick={() => trivyImage && pullTrivyMutation.mutate(trivyImage)}
                          >
                            Pull image now
                          </SecurityButton>
                        </Form.Item>
                      )}
                    </Space>
                  </Card>
                </Space>
              ),
            },
            {
              key: 'notifications',
              label: notificationsTabLabel,
              forceRender: true,
              children: (
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <BellOutlined style={{ marginRight: 8 }} />
                      Notifications
                    </Typography.Title>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Which background events are worth being notified about. Shared by every
                      channel below, so both send the same set of events, whichever is enabled.
                    </Typography.Paragraph>
                    <Space direction="vertical">
                      <Form.Item name={['notifyEvents', 'onContainerCrash']} valuePropName="checked" noStyle>
                        <Checkbox>A container crashes, is OOM-killed, or fails its health check</Checkbox>
                      </Form.Item>
                      <Form.Item name={['notifyEvents', 'onImageUpdate']} valuePropName="checked" noStyle>
                        <Checkbox>A scheduled image update check finds something new</Checkbox>
                      </Form.Item>
                      <Form.Item name={['notifyEvents', 'onBackupFailure']} valuePropName="checked" noStyle>
                        <Checkbox>A scheduled backup fails</Checkbox>
                      </Form.Item>
                      <Form.Item name={['notifyEvents', 'onAuditAnomaly']} valuePropName="checked" noStyle>
                        <Checkbox>When AI watchdog flags suspicious activity</Checkbox>
                      </Form.Item>
                      <Form.Item name={['notifyEvents', 'onResourceThreshold']} valuePropName="checked" noStyle>
                        <Checkbox>A container or host resource (CPU, memory, disk) crosses its configured threshold</Checkbox>
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <AlertOutlined style={{ marginRight: 8 }} />
                      Resource Alerts
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item name={['resourceAlerts', 'enabled']} valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Enable resource alerts</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Periodically checks host and per-container CPU, memory, and disk usage
                      against the thresholds below, and sends a notification over the channels
                      below when one is crossed.
                    </Typography.Paragraph>
                    <Space size="large" wrap align="start" style={{ marginBottom: 16 }}>
                      <Form.Item name={['resourceAlerts', 'checkIntervalMinutes']} label="Check interval (minutes)">
                        <InputNumber min={1} max={24 * 60} disabled={!resourceAlertsEnabled} style={{ width: 200 }} />
                      </Form.Item>
                    </Space>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Host thresholds
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      Only ever measures this Challoupe machine — CPU/memory/disk of a remote host
                      isn't reachable this way, so these thresholds don't apply to hosts added under
                      Hosts.
                    </Typography.Text>
                    <Space size="large" wrap align="start" style={{ marginBottom: 16 }}>
                      <Form.Item name={['resourceAlerts', 'hostCpuPercent']} label="CPU">
                        <InputNumber min={1} max={100} suffix="%" disabled={!resourceAlertsEnabled} style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name={['resourceAlerts', 'hostMemoryPercent']} label="Memory">
                        <InputNumber min={1} max={100} suffix="%" disabled={!resourceAlertsEnabled} style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name={['resourceAlerts', 'hostDiskPercent']} label="Disk">
                        <InputNumber min={1} max={100} suffix="%" disabled={!resourceAlertsEnabled} style={{ width: 160 }} />
                      </Form.Item>
                    </Space>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                      Per-container thresholds
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      Applies across every host — local and every host added under Hosts.
                    </Typography.Text>
                    <Space size="large" wrap align="start">
                      <Form.Item name={['resourceAlerts', 'containerCpuPercent']} label="CPU">
                        <InputNumber min={1} max={100} suffix="%" disabled={!resourceAlertsEnabled} style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item name={['resourceAlerts', 'containerMemoryPercent']} label="Memory">
                        <InputNumber min={1} max={100} suffix="%" disabled={!resourceAlertsEnabled} style={{ width: 160 }} />
                      </Form.Item>
                    </Space>
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <ApiOutlined style={{ marginRight: 8 }} />
                      Webhook
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item name={['notifications', 'enabled']} valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Send webhook notifications</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Posts a message to a Discord, Slack, or generic JSON webhook.
                    </Typography.Paragraph>
                    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
                      <Form.Item
                        name={['notifications', 'webhookUrl']}
                        label="Webhook URL"
                        tooltip="Never sent back to the browser, leave blank to keep the currently stored URL"
                      >
                        <Input.Password
                          placeholder="Leave blank to keep current"
                          disabled={!notificationsEnabled}
                        />
                      </Form.Item>
                      <Space size="large" wrap align="end">
                        <Form.Item name={['notifications', 'format']} label="Format">
                          <Select
                            style={{ width: 200 }}
                            disabled={!notificationsEnabled}
                            options={[
                              { value: 'generic', label: 'Generic JSON' },
                              { value: 'discord', label: 'Discord' },
                              { value: 'slack', label: 'Slack' },
                            ]}
                          />
                        </Form.Item>
                        {isAdmin && (
                          <Form.Item label=" ">
                            <Button
                              icon={<BellOutlined />}
                              loading={notifTestStatus === 'testing'}
                              onClick={testWebhook}
                              disabled={!notificationsEnabled}
                            >
                              Send test notification
                            </Button>
                          </Form.Item>
                        )}
                      </Space>
                    </Space>
                    {notifTestStatus === 'error' && (
                      <Alert
                        type="error"
                        showIcon
                        message="Could not reach the webhook"
                        description={notifTestError}
                        style={{ marginBottom: 0, maxWidth: 600 }}
                      />
                    )}
                  </Card>

                  <Card>
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      <NotificationOutlined style={{ marginRight: 8 }} />
                      ntfy
                    </Typography.Title>
                    <Space align="center" style={{ marginBottom: 16 }}>
                      <Form.Item name={['ntfy', 'enabled']} valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                      <Typography.Text strong>Send ntfy notifications</Typography.Text>
                    </Space>
                    <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                      Publishes to a topic on{' '}
                      <a href="https://ntfy.sh" target="_blank" rel="noreferrer">
                        ntfy
                      </a>{' '}
                      (public or a self-hosted server).
                    </Typography.Paragraph>
                    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
                      <Space size="large" wrap align="start">
                        <Form.Item name={['ntfy', 'serverUrl']} label="Server URL">
                          <Input style={{ width: 220 }} placeholder="https://ntfy.sh" disabled={!ntfyEnabled} />
                        </Form.Item>
                        <Form.Item name={['ntfy', 'topic']} label="Topic">
                          <Input style={{ width: 200 }} placeholder="challoupe-alerts" disabled={!ntfyEnabled} />
                        </Form.Item>
                      </Space>
                      <Space size="large" wrap align="start">
                        <Form.Item name={['ntfy', 'username']} label="Username (optional)">
                          <Input style={{ width: 200 }} disabled={!ntfyEnabled} />
                        </Form.Item>
                        <Form.Item
                          name={['ntfy', 'password']}
                          label="Password (optional)"
                          tooltip="Never sent back to the browser, leave blank to keep the currently stored password"
                        >
                          <Input.Password
                            style={{ width: 200 }}
                            placeholder="Leave blank to keep current"
                            disabled={!ntfyEnabled}
                          />
                        </Form.Item>
                        {isAdmin && (
                          <Form.Item label=" ">
                            <Button
                              icon={<NotificationOutlined />}
                              loading={ntfyTestStatus === 'testing'}
                              onClick={testNtfy}
                              disabled={!ntfyEnabled}
                            >
                              Send test notification
                            </Button>
                          </Form.Item>
                        )}
                      </Space>
                    </Space>
                    {ntfyTestStatus === 'error' && (
                      <Alert
                        type="error"
                        showIcon
                        message="Could not reach ntfy"
                        description={ntfyTestError}
                        style={{ marginBottom: 0, maxWidth: 600 }}
                      />
                    )}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'sso',
              label: ssoTabLabel,
              forceRender: true,
              children: (
                <Card>
                  <Space align="center" style={{ marginBottom: 16 }}>
                    <Form.Item name={['oidc', 'enabled']} valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                    <Typography.Text strong>Enable single sign-on</Typography.Text>
                  </Space>
                  <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                    Lets users sign in through an external OpenID Connect provider in addition
                    to a local username/password.
                  </Typography.Paragraph>
                  <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 480 }}>
                    <Form.Item name={['oidc', 'providerId']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item label="Provider" tooltip="Fills in the issuer URL for a known provider.">
                      <Select
                        value={ssoProvider}
                        onChange={handleSsoProviderChange}
                        disabled={!ssoEnabled}
                        options={SSO_PROVIDER_OPTIONS}
                      />
                    </Form.Item>
                    {findSsoProvider(ssoProvider).fields.map((field) => (
                      <Form.Item key={field.key} label={field.label} tooltip={field.tooltip}>
                        <Input
                          placeholder={field.placeholder}
                          value={ssoProviderValues[field.key] ?? ''}
                          onChange={(e) => handleSsoProviderFieldChange(field.key, e.target.value)}
                          disabled={!ssoEnabled}
                        />
                      </Form.Item>
                    ))}
                    <Form.Item
                      name={['oidc', 'issuerUrl']}
                      label="Issuer URL"
                      tooltip={
                        ssoProvider === 'custom'
                          ? "The provider's OpenID Connect discovery issuer, e.g. https://accounts.google.com"
                          : 'Computed automatically from the field(s) above'
                      }
                    >
                      <Input
                        placeholder="https://your-provider.example.com"
                        disabled={!ssoEnabled}
                        readOnly={ssoProvider !== 'custom'}
                      />
                    </Form.Item>
                    <Form.Item name={['oidc', 'clientId']} label="Client ID">
                      <Input disabled={!ssoEnabled} />
                    </Form.Item>
                    <Form.Item
                      name={['oidc', 'clientSecret']}
                      label="Client secret"
                      tooltip="Never sent back to the browser — leave blank to keep the currently stored secret"
                    >
                      <Input.Password placeholder="Leave blank to keep current" disabled={!ssoEnabled} />
                    </Form.Item>
                    <Form.Item name={['oidc', 'buttonLabel']} label="Login button label">
                      <Input placeholder="Single Sign-On" disabled={!ssoEnabled} />
                    </Form.Item>
                    <Form.Item
                      label="Callback URL"
                      tooltip="Register this exact URL as an allowed redirect URI at your identity provider"
                    >
                      <Input value={`${window.location.origin}/api/auth/oidc/callback`} readOnly />
                    </Form.Item>
                  </Space>
                </Card>
              ),
            },
            {
              key: 'backup',
              label: backupTabLabel,
              forceRender: true,
              children: (
                <Card>
                  <Typography.Title level={5} style={{ marginTop: 0 }}>
                    Download a backup
                  </Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                    Exports every user (with their permissions), all settings, and every stack's
                    compose file as one JSON file. Running containers, images, volumes, and
                    networks are not included.
                  </Typography.Paragraph>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ maxWidth: 640, marginBottom: 16 }}
                    message="Backups contains credentials, store it securely!"
                    description="The file includes password hashes and any configured secret (such as the SSO client secret) needed to make a restore fully functional. Treat it like you would a database backup."
                  />
                  {isAdmin && (
                    <Button icon={<CloudDownloadOutlined />} href="/api/backup">
                      Download backup
                    </Button>
                  )}

                  <Divider />

                  <Typography.Title level={5}>Restore from a backup</Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                    Replaces every current user, setting, and stack definition with the ones in
                    the file. This cannot be undone, and everyone will need to sign in again afterward.
                  </Typography.Paragraph>
                  {isAdmin && (
                    <Upload accept="application/json" showUploadList={false} beforeUpload={handleRestoreFile}>
                      <Button icon={<UploadOutlined />} loading={restoreMutation.isPending}>
                        Choose backup file…
                      </Button>
                    </Upload>
                  )}

                  <Divider />

                  <Typography.Title level={5}>Scheduled backups</Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
                    Writes the same export to <code>data/backups/</code> on a timer, keeping only
                    the most recent files below.
                  </Typography.Paragraph>
                  <Space align="center" style={{ display: 'flex', marginBottom: 16 }}>
                    <Form.Item name={['scheduledBackup', 'enabled']} valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                    <Typography.Text strong>Back up automatically</Typography.Text>
                  </Space>
                  <Space size="large" wrap align="start" style={{ marginBottom: 16 }}>
                    <Form.Item name={['scheduledBackup', 'intervalHours']} label="Interval (hours)">
                      <InputNumber min={1} max={24 * 30} disabled={!scheduledBackupEnabled} style={{ width: 160 }} />
                    </Form.Item>
                    <Form.Item name={['scheduledBackup', 'keepCount']} label="Keep this many">
                      <InputNumber min={1} max={100} disabled={!scheduledBackupEnabled} style={{ width: 160 }} />
                    </Form.Item>
                  </Space>
                  {isAdmin && (
                    <Button
                      icon={<ClockCircleOutlined />}
                      onClick={() => runBackupMutation.mutate()}
                      loading={runBackupMutation.isPending}
                      style={{ marginBottom: 16 }}
                    >
                      Back up now
                    </Button>
                  )}
                  <List
                    size="small"
                    bordered
                    locale={{ emptyText: 'No scheduled backups yet' }}
                    dataSource={scheduledBackups ?? []}
                    renderItem={(file) => (
                      <List.Item
                        actions={[
                          <Button
                            key="download"
                            size="small"
                            icon={<DownloadOutlined />}
                            href={`/api/backup/scheduled/${file.filename}`}
                          />,
                          <Popconfirm
                            key="delete"
                            title="Delete this backup file?"
                            onConfirm={() => deleteBackupMutation.mutate(file.filename)}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>,
                        ]}
                      >
                        <Space direction="vertical" size={0}>
                          <Typography.Text code>{file.filename}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {formatBytes(file.size)} · {fromISO(file.createdAt)}
                          </Typography.Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Card>
              ),
            },
          ]}
        />

        {isAdmin && (
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending} style={{ marginTop: 16 }}>
            Save
          </Button>
        )}
        {!isAdmin && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
            Only administrators can change global settings.
          </Typography.Text>
        )}
      </Form>

      {isAdmin && (
        <Card style={{ marginTop: 24, borderColor: '#ff4d4f' }}>
          <Typography.Title level={5} style={{ marginTop: 0, color: '#ff4d4f' }}>
            <WarningOutlined style={{ marginRight: 8 }} />
            Danger zone
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
            Deletes every users, stack and settings to its default values. 
            Backups already written to disk are not affected.
          </Typography.Paragraph>
          <Button danger loading={resetMutation.isPending} onClick={handleResetToDefaults}>
            Factory reset
          </Button>
        </Card>
      )}
    </div>
  );
}
