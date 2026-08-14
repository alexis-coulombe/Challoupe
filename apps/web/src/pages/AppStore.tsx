import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Input, Row, Space, Tag, Typography } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { STACK_TEMPLATES, type StackTemplate } from '../data/stackTemplates';
import { tileColor } from '../utils';
import { useHost } from '../hosts';
import ListPageHeader from '../components/ListPageHeader';

const tileStyle = {
  width: 44,
  height: 44,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontWeight: 700,
  fontSize: 18,
  flexShrink: 0,
} as const;

export default function AppStore() {
  const navigate = useNavigate();
  const { hostId } = useHost();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(STACK_TEMPLATES.map((t) => t.category))).sort(),
    []
  );

  const filtered = STACK_TEMPLATES.filter((t) => {
    if (category && t.category !== category) return false;
    return `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(search.toLowerCase());
  });

  // Lands in the stack editor with the template loaded, not a straight deploy — the
  // placeholder password/port/timezone in these templates almost always needs a look
  // before it's actually worth running.
  const useTemplate = (template: StackTemplate) => {
    navigate('/stacks/new', { state: { name: template.id, compose: template.compose } });
  };

  return (
    <div>
      <ListPageHeader title="App Store" />

      <Typography.Paragraph type="secondary" style={{ maxWidth: 640 }}>
        Curated docker-compose templates for popular self-hosted apps. Pick one to open it in the
        stack editor, review or tweak it, then save and deploy.
      </Typography.Paragraph>

      {hostId !== 'local' && (
        <Alert
          type="info"
          showIcon
          icon={<CloudServerOutlined />}
          style={{ marginBottom: 16 }}
          message="Deploys to the local host"
          description="Stacks always run on Local regardless of the host selected above."
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Search apps"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 260 }}
        />
        <Space size={4} wrap>
          <Tag.CheckableTag checked={category === null} onChange={() => setCategory(null)}>
            All
          </Tag.CheckableTag>
          {categories.map((c) => (
            <Tag.CheckableTag key={c} checked={category === c} onChange={() => setCategory(category === c ? null : c)}>
              {c}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Space>

      <Row gutter={[16, 16]}>
        {filtered.map((template) => (
          <Col xs={24} sm={12} lg={8} xl={6} key={template.id}>
            <Card hoverable onClick={() => useTemplate(template)} styles={{ body: { padding: 16 } }}>
              <Space align="start" size={12} style={{ marginBottom: 10, width: '100%' }}>
                <span style={{ ...tileStyle, background: tileColor(template.name) }}>
                  {template.name.charAt(0).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <Typography.Text strong style={{ display: 'block' }}>
                    {template.name}
                  </Typography.Text>
                  <Tag style={{ marginTop: 2 }}>{template.category}</Tag>
                </div>
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 12, minHeight: 44 }}>
                {template.description}
              </Typography.Paragraph>
              <Button
                block
                onClick={(e) => {
                  e.stopPropagation();
                  useTemplate(template);
                }}
              >
                Use
              </Button>
            </Card>
          </Col>
        ))}

        {filtered.length === 0 && (
          <Col span={24}>
            <Typography.Text type="secondary">No apps match your search.</Typography.Text>
          </Col>
        )}
      </Row>
    </div>
  );
}
