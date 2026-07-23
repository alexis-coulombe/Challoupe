import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, Card, Col, Input, Modal, Row, Space, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  RobotOutlined,
  SaveOutlined,
  StopOutlined,
} from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { diffLines } from 'diff';
import { hasPermission, type ComposeResult } from '../api';
import { STACK_TEMPLATES } from '../data/stackTemplates';
import { AI_COLOR, AI_COLOR_BORDER, CONSOLE_BG, CONSOLE_BORDER, CONSOLE_TEXT, stripCodeFence } from '../utils';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAuth } from '../auth';
import { useOllamaStream } from '../hooks/useOllamaStream';
import { stacksApi } from '../services/stacksApi';
import AiButton from '../components/AiButton';
import DeleteButton from '../components/DeleteButton';
import FavoriteButton from '../components/FavoriteButton';

const TEMPLATE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
`;

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

// Flattens jsdiff's line-diff parts into one row per line (each tagged +/-/context)
// for a conventional unified-diff look, instead of coloring whole multi-line blocks.
function toDiffLines(oldStr: string, newStr: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const part of diffLines(oldStr, newStr)) {
    const type = part.added ? 'add' : part.removed ? 'remove' : 'context';
    const partLines = part.value.split('\n');
    if (partLines[partLines.length - 1] === '') partLines.pop();
    for (const text of partLines) lines.push({ type, text });
  }
  return lines;
}

const DIFF_STYLE: Record<DiffLine['type'], { background: string; color: string; prefix: string }> = {
  add: { background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', prefix: '+ ' },
  remove: { background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', prefix: '- ' },
  context: { background: 'transparent', color: '#c9d1d9', prefix: '  ' },
};

export default function StackEdit() {
  const { name: routeName } = useParams<{ name: string }>();
  const isNew = !routeName;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'manageStacks');
  const { data: settings } = useAppSettings();
  const aiEnabled = settings?.featureFlags.aiAssistant !== false && hasPermission(user, 'useAi');

  const [name, setName] = useState(routeName ?? '');
  const [compose, setCompose] = useState(TEMPLATE);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [diffOpen, setDiffOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const aiStream = useOllamaStream();

  const { data: existing } = useQuery({
    queryKey: ['stack', routeName],
    queryFn: () => stacksApi.get(routeName!),
    enabled: !isNew,
  });

  const { data: drift } = useQuery({
    queryKey: ['stack-drift', routeName],
    queryFn: () => stacksApi.drift(routeName!),
    enabled: !isNew,
  });

  useEffect(() => {
    if (existing) setCompose(existing.compose);
  }, [existing]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['stacks'] });

  const saveMutation = useMutation({
    mutationFn: async (deploy: boolean) => {
      if (isNew) {
        const created = await stacksApi.create({ name, compose, deploy });
        return created.deploy;
      }
      await stacksApi.update(routeName!, compose);
      return deploy ? stacksApi.deploy(routeName!) : null;
    },
    onSuccess: (deployResult, deploy) => {
      invalidate();
      setResult(deployResult);
      if (!deploy) message.success('Stack saved');
      else if (deployResult?.ok) message.success('Stack deployed');
      else message.error('Deployment failed — see output below');
      if (isNew) navigate(`/stacks/${name}`, { replace: true });
    },
    onError: (err) => message.error(err.message),
  });

  const downMutation = useMutation({
    mutationFn: () => stacksApi.down(routeName!),
    onSuccess: (r) => {
      setResult(r);
      invalidate();
      if (r.ok) message.success('Stack stopped');
    },
    onError: (err) => message.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => stacksApi.remove(routeName!),
    onSuccess: () => {
      message.success('Stack deleted');
      invalidate();
      navigate('/stacks');
    },
    onError: (err) => message.error(err.message),
  });

  const busy = saveMutation.isPending || downMutation.isPending || deleteMutation.isPending;

  const filteredTemplates = STACK_TEMPLATES.filter((t) =>
    `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  const useTemplate = (template: (typeof STACK_TEMPLATES)[number]) => {
    setCompose(template.compose);
    if (!name) setName(template.id);
    setCatalogOpen(false);
  };

  const generate = () => {
    if (!aiPrompt.trim()) return;
    aiStream.start('/ai/generate-stack', { type: 'prompt', text: aiPrompt });
  };

  const useGenerated = () => {
    setCompose(stripCodeFence(aiStream.text));
    setAiOpen(false);
  };

  // Deploying an existing stack changes what's actually running, so pending
  // edits get a diff-and-confirm step first; a brand-new stack has nothing
  // live yet to compare against, so it deploys immediately.
  const deployClick = () => {
    if (!isNew && existing && compose !== existing.compose) {
      setDiffOpen(true);
    } else {
      saveMutation.mutate(true);
    }
  };

  const confirmDeploy = () => {
    setDiffOpen(false);
    saveMutation.mutate(true);
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Link to="/stacks">
          <Button icon={<ArrowLeftOutlined />}>Back</Button>
        </Link>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {isNew ? 'New stack' : `Stack: ${routeName}`}
        </Typography.Title>
        {!isNew && routeName && <FavoriteButton type="stack" id={routeName} label={routeName} />}
      </Space>

      {isNew && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder="stack-name (lowercase letters, digits, - and _)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: 340 }}
          />
          <Button icon={<AppstoreOutlined />} onClick={() => setCatalogOpen(true)}>
            Browse templates
          </Button>
          {aiEnabled && <AiButton onClick={() => setAiOpen(true)}>Generate with AI</AiButton>}
        </Space>
      )}

      {!isNew && !canManage && (
        <Alert
          type="info"
          showIcon
          message="Read-only — you don't have permission to edit or delete stacks."
          style={{ marginBottom: 16 }}
        />
      )}

      {drift && !drift.inSync && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This stack has drifted from its compose file"
          description={
            <Space direction="vertical" size={4}>
              {drift.missingServices.length > 0 && (
                <Typography.Text>
                  Declared but not running: {drift.missingServices.join(', ')}
                </Typography.Text>
              )}
              {drift.orphanedContainers.length > 0 && (
                <Typography.Text>
                  Running but no longer in the compose file:{' '}
                  {drift.orphanedContainers.map((c) => c.name).join(', ')} — a redeploy removes these
                  (`--remove-orphans`).
                </Typography.Text>
              )}
              {drift.imageMismatches.length > 0 && (
                <Typography.Text>
                  Running a different image than the file specifies:{' '}
                  {drift.imageMismatches
                    .map((m) => `${m.service} (${m.actualImage} → ${m.expectedImage})`)
                    .join(', ')}
                </Typography.Text>
              )}
            </Space>
          }
        />
      )}

      <Card size="small" title="docker-compose.yml" style={{ marginBottom: 16 }}>
        <CodeMirror
          value={compose}
          onChange={setCompose}
          extensions={[yaml()]}
          theme="dark"
          height="440px"
          editable={canManage}
        />
      </Card>

      <Space wrap style={{ marginBottom: 16 }}>
        {canManage && (
          <>
            <Button
              icon={<SaveOutlined />}
              onClick={() => saveMutation.mutate(false)}
              disabled={busy || (isNew && !name)}
            >
              Save
            </Button>
            <Button
              type="primary"
              icon={<CaretRightOutlined />}
              onClick={deployClick}
              loading={saveMutation.isPending}
              disabled={busy || (isNew && !name)}
            >
              {isNew ? 'Create and deploy' : 'Save and deploy'}
            </Button>
          </>
        )}
        {!isNew && (
          <>
            {canManage && (
              <Button
                icon={<StopOutlined />}
                onClick={() => downMutation.mutate()}
                loading={downMutation.isPending}
                disabled={busy}
              >
                Stop (down)
              </Button>
            )}
            {canManage && (
              <DeleteButton
                size="middle"
                confirmTitle="Delete this stack? Its containers will be stopped."
                onConfirm={() => deleteMutation.mutate()}
                disabled={busy}
              >
                Delete
              </DeleteButton>
            )}
          </>
        )}
      </Space>

      {result && (
        <Alert
          type={result.ok ? 'success' : 'error'}
          message={result.ok ? 'docker compose output' : 'docker compose failed'}
          description={
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0, maxHeight: 300, overflow: 'auto' }}>
              {result.output || '(no output)'}
            </pre>
          }
          closable
          onClose={() => setResult(null)}
        />
      )}

      <Modal
        title="Review changes before deploying"
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        onOk={confirmDeploy}
        okText="Deploy"
        confirmLoading={saveMutation.isPending}
        width={720}
      >
        <div
          style={{
            background: CONSOLE_BG,
            border: `1px solid ${CONSOLE_BORDER}`,
            borderRadius: 8,
            padding: 12,
            maxHeight: 420,
            overflow: 'auto',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          {existing &&
            toDiffLines(existing.compose, compose).map((line, i) => {
              const style = DIFF_STYLE[line.type];
              return (
                <div key={i} style={{ background: style.background, color: style.color, whiteSpace: 'pre-wrap' }}>
                  {style.prefix}
                  {line.text}
                </div>
              );
            })}
        </div>
      </Modal>

      <Modal
        title="Stack templates"
        open={catalogOpen}
        onCancel={() => setCatalogOpen(false)}
        footer={null}
        width={720}
      >
        <Input.Search
          placeholder="Search templates…"
          value={catalogSearch}
          onChange={(e) => setCatalogSearch(e.target.value)}
          style={{ marginBottom: 16 }}
          allowClear
        />
        <Row gutter={[12, 12]} style={{ maxHeight: 480, overflow: 'auto' }}>
          {filteredTemplates.map((template) => (
            <Col xs={24} sm={12} key={template.id}>
              <Card
                size="small"
                hoverable
                onClick={() => useTemplate(template)}
                title={template.name}
                extra={<Tag>{template.category}</Tag>}
              >
                <Typography.Text type="secondary">{template.description}</Typography.Text>
              </Card>
            </Col>
          ))}
          {filteredTemplates.length === 0 && (
            <Col span={24}>
              <Typography.Text type="secondary">No templates match your search.</Typography.Text>
            </Col>
          )}
        </Row>
      </Modal>

      <Modal
        title={
          <Space size={8}>
            <RobotOutlined style={{ color: AI_COLOR }} />
            Generate a stack with AI
          </Space>
        }
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        width={720}
        footer={
          <Space>
            <Button onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button
              onClick={useGenerated}
              disabled={aiStream.status !== 'done' || !aiStream.text.trim()}
            >
              Use this
            </Button>
            <AiButton
              variant="solid"
              loading={aiStream.status === 'connecting' || aiStream.status === 'streaming'}
              onClick={generate}
              disabled={!aiPrompt.trim()}
            >
              Generate
            </AiButton>
          </Space>
        }
      >
        <Input.TextArea
          rows={2}
          placeholder="Describe the app you want to deploy, e.g. 'a Postgres database with pgAdmin'"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {aiStream.status === 'error' && <Alert type="error" showIcon message={aiStream.error} />}
        {(aiStream.status === 'connecting' || aiStream.status === 'streaming' || aiStream.status === 'done') && (
          <pre
            style={{
              background: CONSOLE_BG,
              border: `1px solid ${AI_COLOR_BORDER}`,
              color: CONSOLE_TEXT,
              padding: 12,
              borderRadius: 8,
              maxHeight: 320,
              overflow: 'auto',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {aiStream.text || ' '}
            {aiStream.status === 'streaming' && <LoadingOutlined style={{ marginLeft: 8 }} />}
          </pre>
        )}
      </Modal>
    </div>
  );
}
