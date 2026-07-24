import { Card, Col, Empty, Row, Typography } from 'antd';
import { useContainerStats } from '../hooks/useContainerStats';
import { formatBytes, formatRate, usageColor } from '../utils';
import Sparkline from './Sparkline';

interface StatTileProps {
  label: string;
  value: string;
  color?: string;
  children: React.ReactNode;
}

function StatTile({ label, value, color, children }: StatTileProps) {
  return (
    <Card size="small">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Typography.Text type="secondary">{label}</Typography.Text>
        <Typography.Text strong style={{ fontSize: 18, color }}>
          {value}
        </Typography.Text>
      </div>
      {children}
    </Card>
  );
}

export default function ContainerStats({
  hostId,
  containerId,
  running,
}: {
  hostId: string;
  containerId: string;
  running: boolean;
}) {
  const stats = useContainerStats(hostId, containerId, running);

  if (!running) {
    return (
      <Card size="small">
        <Empty description="Start the container to see live resource usage" />
      </Card>
    );
  }

  if (!stats.latest) {
    return (
      <Card size="small">
        <Empty description={stats.connected ? 'Waiting for the first sample…' : 'Connecting…'} />
      </Card>
    );
  }

  const cpuColor = usageColor(stats.latest.cpuPercent);
  const memColor = usageColor(stats.latest.memoryPercent);

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <StatTile label="CPU" value={`${stats.latest.cpuPercent.toFixed(1)}%`} color={cpuColor}>
          <Sparkline
            series={[{ id: 'cpu', label: 'CPU', color: cpuColor, points: stats.cpuPercent }]}
            domain={[0, 100]}
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
        </StatTile>
      </Col>
      <Col xs={24} md={8}>
        <StatTile
          label="Memory"
          value={`${formatBytes(stats.latest.memoryUsage)} / ${formatBytes(stats.memoryLimit)}`}
          color={memColor}
        >
          <Sparkline
            series={[{ id: 'mem', label: 'Memory', color: memColor, points: stats.memoryPercent }]}
            domain={[0, 100]}
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
        </StatTile>
      </Col>
      <Col xs={24} md={8}>
        <StatTile
          label="Network I/O"
          value={`${formatRate(stats.networkRx[stats.networkRx.length - 1] ?? 0)} / ${formatRate(
            stats.networkTx[stats.networkTx.length - 1] ?? 0
          )}`}
        >
          <Sparkline
            series={[
              { id: 'rx', label: 'RX', color: '#3b82f6', points: stats.networkRx },
              { id: 'tx', label: 'TX', color: '#9085e9', points: stats.networkTx },
            ]}
            formatValue={formatRate}
          />
        </StatTile>
      </Col>
    </Row>
  );
}
