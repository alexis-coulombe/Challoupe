import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  App as AntApp,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Empty,
  FloatButton,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BlockOutlined,
  ClusterOutlined,
  ContainerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HddOutlined,
  HistoryOutlined,
  KeyOutlined,
  LoadingOutlined,
  LogoutOutlined,
  MenuOutlined,
  RobotOutlined,
  SafetyOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth';
import { api, hasPermission, type SystemInfo } from '../api';
import { AI_COLOR, AI_COLOR_SOFT, formatBytes } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useDockerEventNotifications } from '../hooks/useDockerEventNotifications';
import { useOllamaChat } from '../hooks/useOllamaChat';
import AiButton from './AiButton';
import CommandPalette from './CommandPalette';
import PasswordInput from './PasswordInput';
import TwoFactorModal from './TwoFactorModal';
import UsageStat from './UsageStat';

const { Sider, Header, Content } = Layout;

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function AiChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages, streaming, error, send, reset } = useOllamaChat();
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput('');
  };

  return (
    <Drawer
      title={
        <Space size={10}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: AI_COLOR_SOFT,
              color: AI_COLOR,
            }}
          >
            <RobotOutlined />
          </span>
          AI Assistant
        </Space>
      }
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      extra={
        <Typography.Link onClick={reset} style={{ fontSize: 12 }}>
          Clear chat
        </Typography.Link>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div ref={listRef} style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
          {messages.length === 0 && (
            <Empty
              description="Ask about your containers, stacks, or Docker environment"
              style={{ marginTop: 40 }}
            />
          )}
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'rgba(59, 130, 246, 0.16)' : AI_COLOR_SOFT,
                  border: `1px solid ${m.role === 'user' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                }}
              >
                {m.content}
                {streaming && i === messages.length - 1 && (
                  <LoadingOutlined style={{ marginLeft: m.content ? 8 : 0, color: AI_COLOR }} />
                )}
              </div>
            ))}
          </Space>
          {error && (
            <Typography.Text type="danger" style={{ display: 'block', marginTop: 12 }}>
              {error}
            </Typography.Text>
          )}
        </div>
        <Space.Compact style={{ marginTop: 12 }}>
          <Input
            placeholder="Ask the AI assistant…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={submit}
            disabled={streaming}
          />
          <AiButton
            variant="solid"
            icon={<SendOutlined />}
            onClick={submit}
            loading={streaming}
            disabled={!input.trim()}
          />
        </Space.Compact>
      </div>
    </Drawer>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm] = Form.useForm<{ current: string; next: string }>();
  const [totpOpen, setTotpOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { data: settings } = useAppSettings();
  useDockerEventNotifications();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.get<SystemInfo>('/system/info'),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const selectedKey = '/' + (location.pathname.split('/')[1] ?? '');

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
    { key: '/containers', icon: <ContainerOutlined />, label: <Link to="/containers">Containers</Link> },
    { key: '/images', icon: <BlockOutlined />, label: <Link to="/images">Images</Link> },
    { key: '/volumes', icon: <DatabaseOutlined />, label: <Link to="/volumes">Volumes</Link> },
    { key: '/networks', icon: <ApartmentOutlined />, label: <Link to="/networks">Networks</Link> },
    { key: '/stacks', icon: <AppstoreOutlined />, label: <Link to="/stacks">Stacks</Link> },
    ...(user?.role === 'admin'
      ? [
          { key: '/users', icon: <TeamOutlined />, label: <Link to="/users">Users</Link> },
          { key: '/audit-log', icon: <HistoryOutlined />, label: <Link to="/audit-log">Audit Log</Link> },
        ]
      : []),
    { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> },
  ];

  const changePassword = async (values: { current: string; next: string }) => {
    try {
      await api.post('/auth/password', values);
      message.success('Password updated');
      setPasswordOpen(false);
      passwordForm.resetFields();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider className="app-sider" breakpoint="lg" collapsedWidth={64} style={{ borderRight: '1px solid #1f2733' }}>
        <div
          style={{
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <img src="/logo.svg" alt="" width={30} height={30} style={{ flexShrink: 0 }} />
          <Typography.Title level={4} style={{ margin: 0, whiteSpace: 'nowrap', letterSpacing: 0.5 }}>
            <span style={{ color: '#7ab3ff' }}>Challoupe</span>
          </Typography.Title>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={menuItems} />
      </Sider>
      <Drawer
        title={
          <Space size={10} align="center">
            <img src="/logo.svg" alt="" width={26} height={26} />
            <Typography.Title level={4} style={{ margin: 0, letterSpacing: 0.5 }}>
              <span style={{ color: '#7ab3ff' }}>Challoupe</span>
            </Typography.Title>
          </Space>
        }
        placement="left"
        width={240}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} />
      </Drawer>
      <Layout>
        <Header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingInline: 24,
            borderBottom: '1px solid #1f2733',
            gap: 12,
          }}
        >
          <Space size={20}>
            <Button
              className="mobile-nav-trigger"
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileNavOpen(true)}
            />
            <Tooltip title={`Search (${isMac ? '⌘' : 'Ctrl'}+K)`}>
              <Button type="text" icon={<SearchOutlined />} onClick={() => setPaletteOpen(true)} />
            </Tooltip>
            <Space size={28} className="header-stats">
              <UsageStat
                icon={<ThunderboltOutlined />}
                label="CPU"
                percent={info?.cpuPercent}
                detail={info ? `${info.cpuPercent.toFixed(1)}% across ${info.cpus} cores` : undefined}
              />
              <UsageStat
                icon={<ClusterOutlined />}
                label="RAM"
                percent={info?.memoryPercent}
                detail={
                  info
                    ? `${formatBytes(info.memoryUsed)} / ${formatBytes(info.memory)} used`
                    : undefined
                }
              />
              <UsageStat
                icon={<HddOutlined />}
                label="Storage"
                percent={info?.storagePercent}
                detail={
                  info
                    ? `${formatBytes(info.storageUsed)} / ${formatBytes(info.storageTotal)} used`
                    : undefined
                }
              />
            </Space>
          </Space>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'password',
                  icon: <KeyOutlined />,
                  label: 'Change my password',
                  onClick: () => setPasswordOpen(true),
                },
                ...(user?.authProvider === 'local'
                  ? [
                      {
                        key: 'totp',
                        icon: <SafetyOutlined />,
                        label: user.totpEnabled ? 'Two-factor authentication (on)' : 'Enable two-factor authentication',
                        onClick: () => setTotpOpen(true),
                      },
                    ]
                  : []),
                { type: 'divider' as const },
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Sign out',
                  onClick: async () => {
                    await logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span className="header-username">{user?.username}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
      <Modal
        title="Change my password"
        open={passwordOpen}
        onCancel={() => setPasswordOpen(false)}
        onOk={() => passwordForm.submit()}
        okText="Update"
      >
        <Form form={passwordForm} layout="vertical" onFinish={changePassword}>
          <Form.Item name="current" label="Current password" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="next" label="New password" rules={[{ required: true, min: 4 }]}>
            <PasswordInput />
          </Form.Item>
        </Form>
      </Modal>
      <TwoFactorModal open={totpOpen} onClose={() => setTotpOpen(false)} />
      {settings?.featureFlags.aiAssistant !== false && hasPermission(user, 'useAi') && (
        <>
          <FloatButton
            className="ai-float-btn"
            icon={<RobotOutlined />}
            tooltip="AI Assistant"
            onClick={() => setChatOpen(true)}
            style={{ insetInlineEnd: 24, insetBlockEnd: 24 }}
          />
          <AiChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
        </>
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Layout>
  );
}
