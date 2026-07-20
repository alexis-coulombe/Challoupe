import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  BlockOutlined,
  CheckCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { api, type ContainerSummary, type StackSummary, type SystemInfo } from '../api';
import { CONTAINER_STATE_COLORS, STACK_STATUS, usageColor } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useFavorites } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import Sparkline from '../components/Sparkline';

const HISTORY_LENGTH = 60;

// Containers a user would want to notice at a glance: crashed (non-zero exit) or dead.
const EXIT_CODE_RE = /Exited \((\d+)\)/;
function needsAttention(c: ContainerSummary): boolean {
  if (c.state === 'dead') return true;
  if (c.state === 'exited') {
    const match = c.status.match(EXIT_CODE_RE);
    return match !== null && match[1] !== '0';
  }
  return false;
}

function Trend({ label, value, color, points }: { label: string; value: string; color: string; points: number[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <Typography.Text type="secondary">{label}</Typography.Text>
        <Typography.Text strong style={{ color }}>
          {value}
        </Typography.Text>
      </div>
      <Sparkline
        series={[{ id: label, label, color, points }]}
        domain={[0, 100]}
        formatValue={(v) => `${v.toFixed(1)}%`}
        height={40}
      />
    </div>
  );
}

function StatCard({
  to,
  icon,
  color,
  label,
  value,
}: {
  to: string;
  icon: ReactNode;
  color: string;
  label: string;
  value: number | string;
}) {
  return (
    <Link to={to}>
      <Card hoverable styles={{ body: { padding: 20 } }}>
        <Space size={14} align="center">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              background: `${color}22`,
              color,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <Statistic title={label} value={value} />
        </Space>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { data: settings } = useAppSettings();

  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.get<SystemInfo>('/system/info'),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });
  const { data: stacks } = useQuery({
    queryKey: ['stacks'],
    queryFn: () => api.get<StackSummary[]>('/stacks'),
  });
  const { data: containers } = useQuery({
    queryKey: ['containers'],
    queryFn: () => api.get<ContainerSummary[]>('/containers'),
    refetchInterval: settings?.refreshIntervalMs ?? 5000,
  });

  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  useEffect(() => {
    if (!info) return;
    setCpuHistory((h) => [...h, info.cpuPercent].slice(-HISTORY_LENGTH));
    setMemHistory((h) => [...h, info.memoryPercent].slice(-HISTORY_LENGTH));
  }, [info]);

  const attention = (containers ?? []).filter(needsAttention);

  const { favorites } = useFavorites();
  // Resolve each pinned id/name against the live lists so a deleted resource's
  // favorite silently drops off instead of linking somewhere stale.
  const favoriteRows = favorites
    .map((f) => {
      if (f.type === 'container') {
        const c = (containers ?? []).find((x) => x.id === f.id);
        if (!c) return null;
        return {
          key: `container-${c.id}`,
          type: 'container' as const,
          id: c.id,
          label: c.name,
          path: `/containers/${c.id}`,
          tagColor: CONTAINER_STATE_COLORS[c.state] ?? 'default',
          tagLabel: c.state,
        };
      }
      const s = (stacks ?? []).find((x) => x.name === f.id);
      if (!s) return null;
      return {
        key: `stack-${s.name}`,
        type: 'stack' as const,
        id: s.name,
        label: s.name,
        path: `/stacks/${s.name}`,
        tagColor: STACK_STATUS[s.status].color,
        tagLabel: STACK_STATUS[s.status].label,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div>
      <Typography.Title level={3}>Dashboard</Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <StatCard
            to="/containers"
            icon={<CheckCircleOutlined />}
            color="#22c55e"
            label="Running containers"
            value={info?.containersRunning ?? '…'}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            to="/containers"
            icon={<StopOutlined />}
            color="#ef4444"
            label="Stopped containers"
            value={info?.containersStopped ?? '…'}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard to="/images" icon={<BlockOutlined />} color="#3b82f6" label="Images" value={info?.images ?? '…'} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            to="/stacks"
            icon={<AppstoreOutlined />}
            color="#8b5cf6"
            label="Stacks"
            value={stacks?.length ?? '…'}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="Resource usage">
            <Trend
              label="CPU"
              value={info ? `${info.cpuPercent.toFixed(1)}%` : '—'}
              color={usageColor(info?.cpuPercent ?? 0)}
              points={cpuHistory}
            />
            <Trend
              label="Memory"
              value={info ? `${info.memoryPercent.toFixed(1)}%` : '—'}
              color={usageColor(info?.memoryPercent ?? 0)}
              points={memHistory}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Needs attention">
            {attention.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="All containers look healthy"
              />
            ) : (
              <List
                size="small"
                dataSource={attention}
                renderItem={(c) => (
                  <List.Item>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                      <Link to={`/containers/${c.id}`}>{c.name}</Link>
                      <Space size={8}>
                        <Typography.Text type="secondary">{c.status}</Typography.Text>
                        <Tag color={CONTAINER_STATE_COLORS[c.state] ?? 'default'}>{c.state}</Tag>
                      </Space>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>
      {favoriteRows.length > 0 && (
        <Card title="Favorites" style={{ marginTop: 16 }}>
          <List
            size="small"
            dataSource={favoriteRows}
            renderItem={(f) => (
              <List.Item
                actions={[<FavoriteButton key="fav" type={f.type} id={f.id} label={f.label} />]}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                  <Link to={f.path}>{f.label}</Link>
                  <Tag color={f.tagColor}>{f.tagLabel}</Tag>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
      <Card style={{ marginTop: 16 }}>
        <Space direction="vertical">
          <Typography.Text type="secondary">
            {info ? `${info.name} · Docker ${info.serverVersion} · ${info.os}` : 'Loading environment info…'}
          </Typography.Text>
          <Link to="/settings">View environment details &amp; settings →</Link>
        </Space>
      </Card>
    </div>
  );
}
