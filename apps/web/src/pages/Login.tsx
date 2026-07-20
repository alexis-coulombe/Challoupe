import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Divider, Form, Input, Spin, Typography } from 'antd';
import { LockOutlined, LoginOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { api, type LoginResult, type OidcLoginConfig } from '../api';
import { useAuth } from '../auth';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const { setupRequired, refresh, loading: statusLoading, error: statusError } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once /auth/login reports the password was correct but a TOTP code is still needed.
  const [awaitingTotp, setAwaitingTotp] = useState(false);

  const { data: oidc } = useQuery({
    queryKey: ['auth', 'oidc-config'],
    queryFn: () => api.get<OidcLoginConfig>('/auth/oidc/config'),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'oidc_failed') {
      setError('Single sign-on failed — the account may already exist locally, or the sign-in was cancelled.');
    }
  }, []);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LoginResult>(setupRequired ? '/auth/setup' : '/auth/login', values);
      if (res.requiresTotp) {
        setAwaitingTotp(true);
        return;
      }
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onTotpFinish = async (values: { token: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/totp/verify', values);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const startOver = async () => {
    await api.post('/auth/logout').catch(() => {});
    setAwaitingTotp(false);
    setError(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: 16,
        boxSizing: 'border-box',
        background:
          'radial-gradient(1000px circle at 15% -10%, #16233a 0%, transparent 55%), radial-gradient(800px circle at 90% 110%, #131f33 0%, transparent 50%), #0b0e14',
      }}
    >
      <Card style={{ width: 380, maxWidth: '100%', boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <img src="/logo.svg" alt="" width={56} height={56} />
        </div>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          <span style={{ color: '#7ab3ff' }}>Challoupe</span>
        </Typography.Title>
        {statusError ? (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
              Couldn't reach the server
            </Typography.Paragraph>
            <Alert
              type="error"
              message="Check your connection and try again."
              style={{ marginBottom: 16 }}
            />
            <Button block onClick={() => refresh()}>
              Retry
            </Button>
          </>
        ) : statusLoading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin />
          </div>
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
              {awaitingTotp
                ? 'Enter the code from your authenticator app'
                : setupRequired
                  ? 'Create the administrator account to get started'
                  : 'Sign in to manage your Docker environment'}
            </Typography.Paragraph>
            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
            {awaitingTotp ? (
              <Form onFinish={onTotpFinish} layout="vertical">
                <Form.Item name="token" rules={[{ required: true, message: 'Enter a code' }]}>
                  <Input
                    prefix={<SafetyOutlined />}
                    placeholder="6-digit code or backup code"
                    autoFocus
                    autoComplete="one-time-code"
                  />
                </Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  Verify
                </Button>
                <Button type="link" block onClick={startOver} style={{ marginTop: 4 }}>
                  Use a different account
                </Button>
              </Form>
            ) : (
              <>
                <Form onFinish={onFinish} layout="vertical">
                  <Form.Item name="username" rules={[{ required: true, message: 'Username is required' }]}>
                    <Input prefix={<UserOutlined />} placeholder="Username" autoFocus />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    rules={[{ required: true, min: 4, message: 'At least 4 characters' }]}
                  >
                    {setupRequired ? (
                      <PasswordInput prefix={<LockOutlined />} placeholder="Password" />
                    ) : (
                      <Input.Password prefix={<LockOutlined />} placeholder="Password" />
                    )}
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    {setupRequired ? 'Create account' : 'Sign in'}
                  </Button>
                </Form>
                {!setupRequired && oidc?.enabled && (
                  <>
                    <Divider plain style={{ fontSize: 12, margin: '16px 0' }}>
                      or
                    </Divider>
                    <Button
                      block
                      icon={<LoginOutlined />}
                      onClick={() => {
                        window.location.href = '/api/auth/oidc/login';
                      }}
                    >
                      {oidc.buttonLabel}
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
