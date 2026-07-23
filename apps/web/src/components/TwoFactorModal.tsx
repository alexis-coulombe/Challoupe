import { useEffect, useState } from 'react';
import { App as AntApp, Alert, Button, Form, Input, Modal, QRCode, Space, Typography } from 'antd';
import type { TotpSetup } from '../api';
import { authApi } from '../services/authApi';
import { useAuth } from '../auth';

// Enable/disable flow for TOTP two-factor authentication, opened from the user menu in
// AppLayout. Not offered for SSO accounts — the password 2FA wraps doesn't exist for them.
export default function TwoFactorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refresh } = useAuth();
  const { message } = AntApp.useApp();
  const [stage, setStage] = useState<'status' | 'scan' | 'backupCodes'>('status');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [confirmForm] = Form.useForm<{ token: string }>();
  const [disableForm] = Form.useForm<{ password: string }>();
  const [regenerateForm] = Form.useForm<{ password: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStage('status');
      setSetup(null);
      setBackupCodes(null);
      confirmForm.resetFields();
      disableForm.resetFields();
      regenerateForm.resetFields();
    }
    // Only reset when the modal transitions to open — resetting on every render would wipe
    // the backup-codes view before the user has a chance to read/copy them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startSetup = async () => {
    setBusy(true);
    try {
      setSetup(await authApi.totpSetup());
      setStage('scan');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (values: { token: string }) => {
    setBusy(true);
    try {
      const res = await authApi.totpConfirm(values);
      setBackupCodes(res.backupCodes);
      setStage('backupCodes');
      await refresh();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (values: { password: string }) => {
    setBusy(true);
    try {
      await authApi.totpDisable(values);
      message.success('Two-factor authentication disabled');
      disableForm.resetFields();
      await refresh();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const regenerateBackupCodes = async (values: { password: string }) => {
    setBusy(true);
    try {
      const res = await authApi.totpBackupCodes(values);
      regenerateForm.resetFields();
      setBackupCodes(res.backupCodes);
      setStage('backupCodes');
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    setStage('status');
    onClose();
  };

  return (
    <Modal
      title="Two-factor authentication"
      open={open}
      onCancel={stage === 'backupCodes' ? done : onClose}
      footer={null}
      width={480}
    >
      {stage === 'status' && !user?.totpEnabled && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary">
            Adds a second step at sign-in: after your password, you'll also enter a 6-digit
            code from an authenticator app (Google Authenticator, Authy, 1Password, etc.).
          </Typography.Paragraph>
          <Button type="primary" onClick={startSetup} loading={busy}>
            Enable two-factor authentication
          </Button>
        </Space>
      )}

      {stage === 'status' && user?.totpEnabled && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Alert type="success" showIcon message="Two-factor authentication is enabled" />
          <div>
            <Typography.Title level={5}>Regenerate backup codes</Typography.Title>
            <Typography.Paragraph type="secondary">
              Invalidates every existing backup code and issues a fresh set — do this if you've
              used most of them up or think they may have leaked.
            </Typography.Paragraph>
            <Form form={regenerateForm} layout="inline" onFinish={regenerateBackupCodes}>
              <Form.Item name="password" rules={[{ required: true, message: 'Password required' }]}>
                <Input.Password placeholder="Current password" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item>
                <Button htmlType="submit" loading={busy}>
                  Regenerate
                </Button>
              </Form.Item>
            </Form>
          </div>
          <div>
            <Typography.Title level={5}>Disable two-factor authentication</Typography.Title>
            <Form form={disableForm} layout="inline" onFinish={disable}>
              <Form.Item name="password" rules={[{ required: true, message: 'Password required' }]}>
                <Input.Password placeholder="Current password" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item>
                <Button danger htmlType="submit" loading={busy}>
                  Disable
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Space>
      )}

      {stage === 'scan' && setup && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </Typography.Paragraph>
          <div style={{ textAlign: 'center' }}>
            <QRCode value={setup.otpauthUrl} size={200} />
          </div>
          <Typography.Paragraph type="secondary">
            Can't scan it? Enter this key manually:{' '}
            <Typography.Text code copyable>
              {setup.secret}
            </Typography.Text>
          </Typography.Paragraph>
          <Form form={confirmForm} layout="inline" onFinish={confirmSetup}>
            <Form.Item
              name="token"
              rules={[{ required: true, len: 6, message: 'Enter the 6-digit code' }]}
            >
              <Input placeholder="123456" style={{ width: 140 }} autoFocus />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={busy}>
                Confirm
              </Button>
            </Form.Item>
          </Form>
        </Space>
      )}

      {stage === 'backupCodes' && backupCodes && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="Save these backup codes now"
            description="Each one lets you sign in once if you lose access to your authenticator app. They won't be shown again."
          />
          <Typography.Paragraph
            code
            copyable={{ text: backupCodes.join('\n') }}
            style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
          >
            {backupCodes.join('\n')}
          </Typography.Paragraph>
          <Button type="primary" block onClick={done}>
            I've saved these codes
          </Button>
        </Space>
      )}
    </Modal>
  );
}
