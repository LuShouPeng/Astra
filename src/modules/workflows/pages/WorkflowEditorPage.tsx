import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Copy,
  GitBranch,
  Hand,
  LayoutGrid,
  PanelRightOpen,
  Play,
  Redo2,
  Save,
  Server,
  Sparkles,
  Trash2,
  Undo2,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from '../../../core/contracts/workflows';
import type { McpServerConfig, SkillPackage } from '../../../core/contracts/extensions';
import { useI18n } from '../../../core/i18n/I18nContext';
import { layoutWorkflow, validateWorkflow } from '../model/workflowGraph';
import {
  attachCapability,
  parseCapabilityPayload,
  type WorkflowCapability,
} from '../model/workflowCapabilities';
import { routeWorkflowProviders, type ProviderAvailability } from '../model/providerRouting';
import { loadProviderPreferences } from '../model/providerPreferences';
import { createDefaultWorkflowService, type WorkflowService } from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';
import { useWorkspace } from '../../workspace';

const kinds: Array<{ type: WorkflowNodeType; icon: typeof Wrench; en: string; zh: string }> = [
  { type: 'agent', icon: Wrench, en: 'Agent', zh: 'Agent' },
  { type: 'approval', icon: UserCheck, en: 'Approval', zh: '人工审批' },
  { type: 'condition', icon: GitBranch, en: 'Condition', zh: '条件' },
  { type: 'join', icon: Hand, en: 'Join', zh: '汇合' },
];

function storedExtensions<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

interface RuntimeMcpConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable_http';
  command?: string;
  args: string[];
  url?: string;
  secretRef?: string;
  secretHeader?: string;
  enabled: boolean;
}

interface RuntimeSkillPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillPackage['source'];
  sourceUrl?: string;
  sourceRevision?: string;
  contentHash: string;
}

function nodeLabel(node: WorkflowNode) {
  return (
    <div className="workflow-node__content">
      <strong>{node.name}</strong>
      {node.type === 'agent' && (node.skillIds.length > 0 || node.mcpServerIds.length > 0) && (
        <div className="workflow-node__capabilities">
          {node.skillIds.map((id) => (
            <span key={`skill-${id}`}>Skill · {id}</span>
          ))}
          {node.mcpServerIds.map((id) => (
            <span key={`mcp-${id}`}>MCP · {id}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function toFlowNode(node: WorkflowNode): FlowNode {
  return {
    id: node.id,
    position: node.position,
    data: { label: nodeLabel(node) },
    className: `workflow-node workflow-node--${node.type}`,
  };
}

function cloneFlowNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.map((node) => ({ ...node, position: { ...node.position } }));
}

function cloneFlowEdges(edges: FlowEdge[]): FlowEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function toFlowEdge(edge: WorkflowEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.outcome,
    data: { outcome: edge.outcome },
  };
}
function newNode(type: WorkflowNodeType, position: { x: number; y: number }): WorkflowNode {
  const base = { id: `${type}-${crypto.randomUUID()}`, name: type.replace('_', ' '), position };
  if (type === 'agent')
    return { ...base, type, provider: 'auto', prompt: '', skillIds: [], mcpServerIds: [] };
  if (type === 'approval') return { ...base, type, risk: 'high', instructions: '' };
  if (type === 'condition') return { ...base, type, expression: '' };
  return { ...base, type, strategy: 'all' };
}

export function WorkflowEditorPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const c = workflowCopy(language);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingDrafts, setSettingDrafts] = useState<
    Partial<Record<keyof WorkflowDefinition['settings'], string>>
  >({});
  const [availableSkills, setAvailableSkills] = useState(() =>
    storedExtensions<SkillPackage>('astra.extensions.skills.v1'),
  );
  const [availableMcp, setAvailableMcp] = useState(() =>
    storedExtensions<McpServerConfig>('astra.extensions.mcp.v1'),
  );
  const [flow, setFlow] = useState<ReactFlowInstance>();
  const [past, setPast] = useState<
    Array<{ definition: WorkflowDefinition; nodes: FlowNode[]; edges: FlowEdge[] }>
  >([]);
  const [future, setFuture] = useState<
    Array<{ definition: WorkflowDefinition; nodes: FlowNode[]; edges: FlowEdge[] }>
  >([]);
  useEffect(() => {
    void service.list().then((items) => {
      const found = items.find((item) => item.id === workflowId) ?? null;
      setDefinition(found);
      if (found) {
        setNodes(found.nodes.map(toFlowNode));
        setEdges(found.edges.map(toFlowEdge));
      }
    });
  }, [service, workflowId]);
  function closeInspector() {
    setInspectorOpen(false);
    inspectorToggleRef.current?.focus();
  }
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void invoke<RuntimeMcpConfig[]>('orchestration_list_mcp_servers')
      .then((items) =>
        setAvailableMcp(
          items.map((item) => ({
            id: item.id,
            name: item.name,
            transport: item.transport,
            command: item.command,
            args: item.args,
            url: item.url,
            secretRefs: item.secretRef
              ? { [item.secretHeader || 'authorization']: item.secretRef }
              : {},
            enabled: item.enabled,
            source: 'manual',
          })),
        ),
      )
      .catch(() => undefined);
    void invoke<RuntimeSkillPackage[]>('orchestration_list_skills')
      .then((items) =>
        setAvailableSkills(
          items.map((item) => ({
            ...item,
            installPath: `astra-cache/${item.contentHash}`,
            installedAt: new Date().toISOString(),
          })),
        ),
      )
      .catch(() => undefined);
  }, []);
  const sync = useCallback(
    (): WorkflowDefinition | null =>
      definition && {
        ...definition,
        updatedAt: new Date().toISOString(),
        nodes: definition.nodes
          .filter((item) => nodes.some((node) => node.id === item.id))
          .map((item) => ({
            ...item,
            position: nodes.find((node) => node.id === item.id)!.position,
          })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          outcome: edge.data?.outcome as WorkflowEdge['outcome'],
        })),
      },
    [definition, edges, nodes],
  );
  const issues = definition ? validateWorkflow(sync() ?? definition) : [];
  const checkpoint = useCallback(() => {
    if (!definition) return;
    setPast((items) => [
      ...items.slice(-29),
      {
        definition: structuredClone(definition),
        nodes: cloneFlowNodes(nodes),
        edges: cloneFlowEdges(edges),
      },
    ]);
    setFuture([]);
  }, [definition, edges, nodes]);
  const restore = useCallback(
    (direction: 'undo' | 'redo') => {
      const source = direction === 'undo' ? past : future;
      const target = direction === 'undo' ? setFuture : setPast;
      const setSource = direction === 'undo' ? setPast : setFuture;
      const previous = source.at(-1);
      if (!previous || !definition) return;
      target((items) => [
        ...items,
        {
          definition: structuredClone(definition),
          nodes: cloneFlowNodes(nodes),
          edges: cloneFlowEdges(edges),
        },
      ]);
      setSource((items) => items.slice(0, -1));
      setDefinition(previous.definition);
      setNodes(previous.nodes);
      setEdges(previous.edges);
      setSelectedId(undefined);
      setSelectedEdgeId(undefined);
      setInspectorOpen(false);
    },
    [definition, edges, future, nodes, past],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        restore(event.shiftKey ? 'redo' : 'undo');
      } else if (key === 'y') {
        event.preventDefault();
        restore('redo');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [restore]);
  const onNodesChange: OnNodesChange = (changes) => {
    if (changes.some((change) => change.type === 'remove')) checkpoint();
    setNodes((current) => applyNodeChanges(changes, current));
  };
  const onEdgesChange: OnEdgesChange = (changes) => {
    if (changes.some((change) => change.type === 'remove')) checkpoint();
    setEdges((current) => applyEdgeChanges(changes, current));
  };
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const source = definition?.nodes.find((node) => node.id === connection.source);
    const conditionOutcome: WorkflowEdge['outcome'] =
      source?.type === 'condition'
        ? edges.some(
            (edge) => edge.source === source.id && edge.data?.outcome === ('true' as const),
          )
          ? 'false'
          : 'true'
        : undefined;
    const candidate = addEdge(
      {
        ...connection,
        id: `edge-${crypto.randomUUID()}`,
        label: conditionOutcome,
        data: { outcome: conditionOutcome },
      },
      edges,
    );
    const graph = sync();
    if (
      graph &&
      validateWorkflow({
        ...graph,
        edges: candidate.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      }).some((issue) => issue.code === 'CYCLE')
    ) {
      setMessage(c.invalid);
      return;
    }
    checkpoint();
    setEdges(candidate);
  };
  function add(
    type: WorkflowNodeType,
    position = { x: 120 + nodes.length * 36, y: 100 + nodes.length * 24 },
  ) {
    checkpoint();
    const item = newNode(type, position);
    setDefinition((current) =>
      current ? { ...current, nodes: [...current.nodes, item] } : current,
    );
    setNodes((current) => [...current, toFlowNode(item)]);
    setSelectedId(item.id);
    setInspectorOpen(true);
  }
  function updateSelected(patch: Partial<WorkflowNode>) {
    if (!definition) return;
    const nextNodes = definition.nodes.map((node) =>
      node.id === selectedId ? ({ ...node, ...patch } as WorkflowNode) : node,
    );
    setDefinition({ ...definition, nodes: nextNodes });
    setNodes((current) =>
      current.map((flowNode) => {
        const next = nextNodes.find((node) => node.id === flowNode.id);
        return next
          ? {
              ...flowNode,
              data: { label: nodeLabel(next) },
              className: `workflow-node workflow-node--${next.type}`,
            }
          : flowNode;
      }),
    );
  }
  function applyCapability(nodeId: string, capability: WorkflowCapability) {
    if (!definition) return;
    const target = definition.nodes.find((node) => node.id === nodeId);
    if (!target || target.type !== 'agent') {
      setMessage(
        language === 'zh-CN'
          ? 'MCP 与 Skill 只能内化到 Agent 节点。'
          : 'MCP and Skills can only be attached to Agent nodes.',
      );
      return;
    }
    const updated = attachCapability(target, capability);
    if (updated === target) {
      setMessage(
        language === 'zh-CN'
          ? '该 Agent 已具备此能力。'
          : 'This Agent already has that capability.',
      );
      return;
    }
    checkpoint();
    const nextNodes = definition.nodes.map((node) => (node.id === nodeId ? updated : node));
    setDefinition({ ...definition, nodes: nextNodes });
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { label: nodeLabel(updated) } } : node,
      ),
    );
    setSelectedId(nodeId);
    setInspectorOpen(true);
    setMessage(
      language === 'zh-CN'
        ? `${capability.name} 已内化到 ${target.name}`
        : `${capability.name} attached to ${target.name}`,
    );
  }
  async function save() {
    const next = sync();
    if (!next) return;
    setSaving(true);
    try {
      await service.save(next);
      setDefinition(next);
      setMessageIsError(false);
      setMessage(c.valid);
    } catch (reason) {
      setMessageIsError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }
  async function saveTemplate() {
    const next = sync();
    if (!next || validateWorkflow(next).length > 0) {
      setMessageIsError(true);
      setMessage(c.invalid);
      return;
    }
    try {
      await service.saveTemplate(next);
      setMessageIsError(false);
      setMessage(language === 'zh-CN' ? '模板已保存' : 'Template saved');
    } catch (reason) {
      setMessageIsError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function run() {
    const next = sync();
    if (!next || validateWorkflow(next).length) {
      setMessageIsError(true);
      setMessage(c.invalid);
      return;
    }
    try {
      const providers: ProviderAvailability[] =
        '__TAURI_INTERNALS__' in window
          ? await invoke<Array<ProviderAvailability & { reason?: string }>>(
              'orchestration_discover_providers',
              { input: loadProviderPreferences() },
            )
          : [
              { provider: 'claude', available: true },
              { provider: 'codex', available: true },
            ];
      const routed = routeWorkflowProviders(next, providers);
      setDefinition(routed);
      await service.save(routed);
      const run = await service.createRun(
        routed,
        '__TAURI_INTERNALS__' in window
          ? {
              repositoryPath: activeWorkspace?.rootPath ?? '',
              providerPaths: loadProviderPreferences(),
            }
          : undefined,
      );
      void navigate(`/runs/${run.id}`);
    } catch (reason) {
      setMessageIsError(true);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function autoLayout() {
    const graph = sync();
    if (!graph) return;
    checkpoint();
    const positions = layoutWorkflow(graph);
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      })),
    );
  }
  function updateSelectedEdge(outcome: WorkflowEdge['outcome']) {
    if (!selectedEdgeId) return;
    checkpoint();
    setEdges((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId
          ? { ...edge, label: outcome, data: { ...edge.data, outcome } }
          : edge,
      ),
    );
  }
  function updateWorkflowSettings(settings: Partial<WorkflowDefinition['settings']>) {
    setDefinition((current) =>
      current
        ? {
            ...current,
            settings: { ...current.settings, ...settings },
          }
        : current,
    );
  }
  function updateWorkflowSetting(
    key: keyof WorkflowDefinition['settings'],
    rawValue: string,
    minimum: number,
    maximum: number,
  ) {
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      setSettingDrafts((current) => ({ ...current, [key]: rawValue }));
      return;
    }
    setSettingDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    updateWorkflowSettings({ [key]: value });
  }
  function resetWorkflowSettingDraft(key: keyof WorkflowDefinition['settings']) {
    setSettingDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  const selected = definition?.nodes.find((node) => node.id === selectedId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdgeSource = definition?.nodes.find((node) => node.id === selectedEdge?.source);
  const capabilities = useMemo<WorkflowCapability[]>(
    () => [
      ...availableMcp
        .filter((server) => server.enabled)
        .map((server) => ({ kind: 'mcp' as const, id: server.id, name: server.name })),
      ...availableSkills.map((skill) => ({
        kind: 'skill' as const,
        id: skill.id,
        name: skill.name,
      })),
    ],
    [availableMcp, availableSkills],
  );
  if (!definition) return <div className="workflow-loading">{c.editor}</div>;
  return (
    <section
      className={`workflow-editor${inspectorOpen ? ' workflow-editor--inspector-open' : ''}`}
    >
      <header className="workflow-editor__toolbar">
        <Link className="icon-button" to="/workflows" aria-label={c.back}>
          ←
        </Link>
        <input
          aria-label={c.name}
          value={definition.name}
          onFocus={() => checkpoint()}
          onChange={(e) => setDefinition({ ...definition, name: e.target.value })}
        />
        <div className="workflow-editor__actions">
          <button
            className="icon-button"
            aria-label={c.undo}
            disabled={past.length === 0}
            onClick={() => restore('undo')}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={c.redo}
            disabled={future.length === 0}
            onClick={() => restore('redo')}
          >
            <Redo2 size={16} />
          </button>
          <button
            ref={inspectorToggleRef}
            className="icon-button workflow-editor__inspector-toggle"
            aria-label={c.inspector}
            aria-controls="workflow-inspector"
            aria-expanded={inspectorOpen}
            title={c.inspector}
            onClick={() => setInspectorOpen((open) => !open)}
          >
            <PanelRightOpen size={16} />
          </button>
          <button className="button button--compact" onClick={autoLayout}>
            <LayoutGrid size={15} />
            {c.autoLayout}
          </button>
          <button
            className="button button--compact"
            onClick={() => {
              const next = sync();
              setMessageIsError(Boolean(!next || validateWorkflow(next).length));
              setMessage(next && validateWorkflow(next).length === 0 ? c.valid : c.invalid);
            }}
          >
            <Check size={15} />
            {c.validate}
          </button>
          <button className="button button--compact" onClick={() => void save()} disabled={saving}>
            <Save size={15} />
            {saving ? c.saving : c.save}
          </button>
          <button className="button button--compact" onClick={() => void saveTemplate()}>
            <Copy size={15} />
            {language === 'zh-CN' ? '保存模板' : 'Save template'}
          </button>
          <button className="button button--primary" onClick={() => void run()}>
            <Play size={15} />
            {c.run}
          </button>
        </div>
      </header>
      {message && (
        <div
          className={`workflow-editor__message${issues.length || messageIsError ? ' is-error' : ''}`}
          role="status"
        >
          {message}
        </div>
      )}
      <div className="workflow-editor__body">
        <aside className="workflow-palette">
          <h2>{c.palette}</h2>
          {kinds.map(({ type, icon: Icon, en, zh }) => (
            <button
              key={type}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/astra-node', type)}
              onClick={() => add(type)}
            >
              <Icon size={16} />
              <span>{language === 'zh-CN' ? zh : en}</span>
              <small>{c.add}</small>
            </button>
          ))}
          <h2 className="workflow-palette__section">
            {language === 'zh-CN' ? 'Agent 能力' : 'Agent capabilities'}
          </h2>
          {capabilities.length === 0 ? (
            <p className="workflow-palette__empty">
              {language === 'zh-CN'
                ? '请先在扩展页安装 Skill 或注册 MCP。'
                : 'Install a Skill or register MCP first.'}
            </p>
          ) : (
            capabilities.map((capability) => (
              <button
                className="workflow-capability"
                key={`${capability.kind}-${capability.id}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(
                    'application/astra-capability',
                    JSON.stringify(capability),
                  );
                }}
                onClick={() => selectedId && applyCapability(selectedId, capability)}
              >
                {capability.kind === 'mcp' ? <Server size={16} /> : <Sparkles size={16} />}
                <span>{capability.name}</span>
                <small>{capability.kind === 'mcp' ? 'MCP' : 'Skill'}</small>
              </button>
            ))
          )}
        </aside>
        <div
          className="workflow-canvas"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes(
              'application/astra-capability',
            )
              ? 'copy'
              : 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const capability = parseCapabilityPayload(
              e.dataTransfer.getData('application/astra-capability'),
            );
            const position = flow?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            if (capability && position) {
              const target = [...nodes].reverse().find((node) => {
                const nodePosition = node.position;
                const width = node.measured?.width ?? 180;
                const height = node.measured?.height ?? 90;
                return (
                  position.x >= nodePosition.x &&
                  position.x <= nodePosition.x + width &&
                  position.y >= nodePosition.y &&
                  position.y <= nodePosition.y + height
                );
              });
              if (target) applyCapability(target.id, capability);
              else
                setMessage(
                  language === 'zh-CN'
                    ? '请将能力拖放到 Agent 节点内部。'
                    : 'Drop the capability inside an Agent node.',
                );
              return;
            }
            const type = e.dataTransfer.getData('application/astra-node') as WorkflowNodeType;
            if (kinds.some((kind) => kind.type === type))
              add(type, position ?? { x: e.clientX - 360, y: e.clientY - 120 });
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setSelectedEdgeId(undefined);
              setInspectorOpen(true);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedId(undefined);
              setInspectorOpen(true);
            }}
            onPaneClick={() => {
              setSelectedId(undefined);
              setSelectedEdgeId(undefined);
              setInspectorOpen(false);
            }}
            onNodeDragStart={() => checkpoint()}
            onInit={setFlow}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={20} />
            <MiniMap
              bgColor="var(--color-surface)"
              maskColor="var(--color-overlay)"
              maskStrokeColor="var(--color-border-strong)"
              nodeColor="var(--color-text-muted)"
              nodeStrokeColor="var(--color-border)"
              pannable
              zoomable
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside
          id="workflow-inspector"
          className="workflow-inspector"
          aria-labelledby="workflow-inspector-title"
        >
          <div className="workflow-inspector__header">
            <h2 id="workflow-inspector-title">{c.inspector}</h2>
            <button
              className="icon-button workflow-inspector__close"
              aria-label={t('common.close')}
              title={t('common.close')}
              onClick={closeInspector}
            >
              <X size={16} />
            </button>
          </div>
          <fieldset className="workflow-settings">
            <legend>{c.settings}</legend>
            <label>
              {c.maxConcurrency}
              <input
                type="number"
                min="1"
                max="4"
                value={settingDrafts.maxConcurrency ?? definition.settings.maxConcurrency}
                onFocus={() => checkpoint()}
                onBlur={() => resetWorkflowSettingDraft('maxConcurrency')}
                onChange={(event) =>
                  updateWorkflowSetting('maxConcurrency', event.target.value, 1, 4)
                }
              />
            </label>
            <label>
              {c.defaultTimeout}
              <input
                type="number"
                min="1"
                max="86400"
                value={
                  settingDrafts.defaultTimeoutSeconds ?? definition.settings.defaultTimeoutSeconds
                }
                onFocus={() => checkpoint()}
                onBlur={() => resetWorkflowSettingDraft('defaultTimeoutSeconds')}
                onChange={(event) =>
                  updateWorkflowSetting('defaultTimeoutSeconds', event.target.value, 1, 86_400)
                }
              />
            </label>
            <label>
              {c.defaultRetries}
              <input
                type="number"
                min="0"
                max="3"
                value={settingDrafts.defaultRetries ?? definition.settings.defaultRetries}
                onFocus={() => checkpoint()}
                onBlur={() => resetWorkflowSettingDraft('defaultRetries')}
                onChange={(event) =>
                  updateWorkflowSetting('defaultRetries', event.target.value, 0, 3)
                }
              />
            </label>
          </fieldset>
          {selectedEdge ? (
            <div className="workflow-fields">
              <p>
                <strong>{language === 'zh-CN' ? '连线' : 'Edge'}</strong>
                <br />
                <code>
                  {selectedEdge.source} → {selectedEdge.target}
                </code>
              </p>
              <label>
                {language === 'zh-CN' ? '分支结果' : 'Branch outcome'}
                <select
                  value={(selectedEdge.data?.outcome as WorkflowEdge['outcome']) ?? ''}
                  onChange={(event) =>
                    updateSelectedEdge((event.target.value || undefined) as WorkflowEdge['outcome'])
                  }
                >
                  {selectedEdgeSource?.type === 'condition' ? (
                    <>
                      <option value="" disabled>
                        {language === 'zh-CN' ? '选择结果' : 'Select outcome'}
                      </option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </>
                  ) : (
                    <>
                      <option value="">{language === 'zh-CN' ? '普通依赖' : 'Dependency'}</option>
                      <option value="success">Success</option>
                    </>
                  )}
                </select>
              </label>
              <button
                className="button button--danger"
                onClick={() => {
                  checkpoint();
                  setEdges((current) => current.filter((edge) => edge.id !== selectedEdge.id));
                  setSelectedEdgeId(undefined);
                }}
              >
                <Trash2 size={15} />
                {language === 'zh-CN' ? '删除连线' : 'Delete edge'}
              </button>
            </div>
          ) : selected ? (
            <div className="workflow-fields" onFocusCapture={() => checkpoint()}>
              <label>
                {c.name}
                <input
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
              </label>
              {selected.type === 'agent' && (
                <>
                  <label>
                    {c.provider}
                    <select
                      value={selected.provider}
                      onChange={(e) =>
                        updateSelected({ provider: e.target.value as 'auto' | 'claude' | 'codex' })
                      }
                    >
                      <option value="auto">{c.auto}</option>
                      <option value="claude">Claude</option>
                      <option value="codex">Codex</option>
                    </select>
                  </label>
                  <label>
                    {c.prompt}
                    <textarea
                      value={selected.prompt}
                      onChange={(e) => updateSelected({ prompt: e.target.value })}
                    />
                  </label>
                  <fieldset className="workflow-fieldset">
                    <legend>Skills</legend>
                    {availableSkills.length === 0 ? (
                      <small>
                        {language === 'zh-CN' ? '尚未安装 Skill' : 'No Skills installed'}
                      </small>
                    ) : (
                      availableSkills.map((skill) => (
                        <label key={`${skill.id}-${skill.contentHash}`}>
                          <input
                            type="checkbox"
                            checked={selected.skillIds.includes(skill.id)}
                            onChange={(event) =>
                              updateSelected({
                                skillIds: event.target.checked
                                  ? [...selected.skillIds, skill.id]
                                  : selected.skillIds.filter((id) => id !== skill.id),
                              })
                            }
                          />
                          {skill.name}
                        </label>
                      ))
                    )}
                  </fieldset>
                  <fieldset className="workflow-fieldset">
                    <legend>MCP</legend>
                    {availableMcp.length === 0 ? (
                      <small>
                        {language === 'zh-CN' ? '尚未注册 MCP 服务器' : 'No MCP servers registered'}
                      </small>
                    ) : (
                      availableMcp.map((server) => (
                        <label key={server.id}>
                          <input
                            type="checkbox"
                            disabled={!server.enabled}
                            checked={selected.mcpServerIds.includes(server.id)}
                            onChange={(event) =>
                              updateSelected({
                                mcpServerIds: event.target.checked
                                  ? [...selected.mcpServerIds, server.id]
                                  : selected.mcpServerIds.filter((id) => id !== server.id),
                              })
                            }
                          />
                          {server.name}
                          {!server.enabled && ` (${language === 'zh-CN' ? '已禁用' : 'disabled'})`}
                        </label>
                      ))
                    )}
                  </fieldset>
                </>
              )}
              {selected.type === 'approval' && (
                <>
                  <label>
                    {language === 'zh-CN' ? '风险等级' : 'Risk'}
                    <select
                      value={selected.risk}
                      onChange={(event) =>
                        updateSelected({ risk: event.target.value as 'low' | 'medium' | 'high' })
                      }
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>
                    {language === 'zh-CN' ? '审批说明' : 'Approval instructions'}
                    <textarea
                      value={selected.instructions}
                      onChange={(event) => updateSelected({ instructions: event.target.value })}
                    />
                  </label>
                </>
              )}
              {selected.type === 'condition' && (
                <label>
                  {language === 'zh-CN' ? '布尔表达式' : 'Boolean expression'}
                  <input
                    value={selected.expression}
                    onChange={(event) => updateSelected({ expression: event.target.value })}
                  />
                </label>
              )}
              {selected.type === 'join' && (
                <label>
                  {language === 'zh-CN' ? '汇合策略' : 'Join strategy'}
                  <select
                    value={selected.strategy}
                    onChange={(event) =>
                      updateSelected({ strategy: event.target.value as 'all' | 'any' })
                    }
                  >
                    <option value="all">All</option>
                    <option value="any">Any</option>
                  </select>
                </label>
              )}
              <label>
                {c.timeout}
                <input
                  type="number"
                  min="1"
                  value={selected.timeoutSeconds ?? definition.settings.defaultTimeoutSeconds}
                  onChange={(e) => updateSelected({ timeoutSeconds: Number(e.target.value) })}
                />
              </label>
              <label>
                {c.retries}
                <input
                  type="number"
                  min="0"
                  max="3"
                  value={selected.retries ?? definition.settings.defaultRetries}
                  onChange={(e) => updateSelected({ retries: Number(e.target.value) })}
                />
              </label>
              <div className="workflow-inspector__buttons">
                <button
                  className="icon-button"
                  aria-label={c.duplicate}
                  onClick={() => {
                    checkpoint();
                    const clone = {
                      ...selected,
                      id: `${selected.type}-${crypto.randomUUID()}`,
                      name: `${selected.name} copy`,
                      position: { x: selected.position.x + 40, y: selected.position.y + 40 },
                    };
                    setDefinition({ ...definition, nodes: [...definition.nodes, clone] });
                    setNodes([...nodes, toFlowNode(clone)]);
                  }}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={c.delete}
                  onClick={() => {
                    checkpoint();
                    setDefinition({
                      ...definition,
                      nodes: definition.nodes.filter((node) => node.id !== selected.id),
                    });
                    setNodes(nodes.filter((node) => node.id !== selected.id));
                    setEdges(
                      edges.filter(
                        (edge) => edge.source !== selected.id && edge.target !== selected.id,
                      ),
                    );
                    setSelectedId(undefined);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ) : (
            <p>{c.noSelection}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
