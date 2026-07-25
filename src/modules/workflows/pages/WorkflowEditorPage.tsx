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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Copy,
  GitBranch,
  Hand,
  LayoutGrid,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType,
} from '../../../core/contracts/workflows';
import { useI18n } from '../../../core/i18n/I18nContext';
import { validateWorkflow } from '../model/workflowGraph';
import { routeWorkflowProviders, type ProviderAvailability } from '../model/providerRouting';
import { createDefaultWorkflowService, type WorkflowService } from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';

const kinds: Array<{ type: WorkflowNodeType; icon: typeof Wrench; en: string; zh: string }> = [
  { type: 'agent', icon: Wrench, en: 'Agent', zh: 'Agent' },
  { type: 'mcp_tool', icon: Plus, en: 'MCP tool', zh: 'MCP 工具' },
  { type: 'approval', icon: UserCheck, en: 'Approval', zh: '人工审批' },
  { type: 'condition', icon: GitBranch, en: 'Condition', zh: '条件' },
  { type: 'join', icon: Hand, en: 'Join', zh: '汇合' },
];

function toFlowNode(node: WorkflowNode): FlowNode {
  return {
    id: node.id,
    position: node.position,
    data: { label: node.name },
    className: `workflow-node workflow-node--${node.type}`,
  };
}
function newNode(type: WorkflowNodeType, position: { x: number; y: number }): WorkflowNode {
  const base = { id: `${type}-${crypto.randomUUID()}`, name: type.replace('_', ' '), position };
  if (type === 'agent')
    return { ...base, type, provider: 'auto', prompt: '', skillIds: [], mcpServerIds: [] };
  if (type === 'mcp_tool') return { ...base, type, serverId: '', toolName: '', arguments: {} };
  if (type === 'approval') return { ...base, type, risk: 'high', instructions: '' };
  if (type === 'condition') return { ...base, type, expression: '' };
  return { ...base, type, strategy: 'all' };
}

export function WorkflowEditorPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const { language } = useI18n();
  const c = workflowCopy(language);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
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
        setEdges(found.edges.map((edge) => ({ ...edge, label: edge.outcome })));
      }
    });
  }, [service, workflowId]);
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
        edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      },
    [definition, edges, nodes],
  );
  const issues = definition ? validateWorkflow(sync() ?? definition) : [];
  function checkpoint() {
    if (!definition) return;
    setPast((items) => [
      ...items.slice(-29),
      {
        definition: structuredClone(definition),
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
      },
    ]);
    setFuture([]);
  }
  function restore(direction: 'undo' | 'redo') {
    const source = direction === 'undo' ? past : future;
    const target = direction === 'undo' ? setFuture : setPast;
    const setSource = direction === 'undo' ? setPast : setFuture;
    const previous = source.at(-1);
    if (!previous || !definition) return;
    target((items) => [
      ...items,
      {
        definition: structuredClone(definition),
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
      },
    ]);
    setSource((items) => items.slice(0, -1));
    setDefinition(previous.definition);
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setSelectedId(undefined);
  }
  const onNodesChange: OnNodesChange = (changes) =>
    setNodes((current) => applyNodeChanges(changes, current));
  const onEdgesChange: OnEdgesChange = (changes) =>
    setEdges((current) => applyEdgeChanges(changes, current));
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const candidate = addEdge({ ...connection, id: `edge-${crypto.randomUUID()}` }, edges);
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
  }
  function updateSelected(patch: Partial<WorkflowNode>) {
    setDefinition((current) =>
      current
        ? {
            ...current,
            nodes: current.nodes.map((node) =>
              node.id === selectedId ? ({ ...node, ...patch } as WorkflowNode) : node,
            ),
          }
        : current,
    );
    if (patch.name)
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedId ? { ...node, data: { label: patch.name } } : node,
        ),
      );
  }
  async function save() {
    const next = sync();
    if (!next) return;
    setSaving(true);
    try {
      await service.save(next);
      setDefinition(next);
      setMessage(c.valid);
    } finally {
      setSaving(false);
    }
  }
  async function run() {
    const next = sync();
    if (!next || validateWorkflow(next).length) {
      setMessage(c.invalid);
      return;
    }
    const providers: ProviderAvailability[] =
      '__TAURI_INTERNALS__' in window
        ? await invoke<Array<ProviderAvailability & { reason?: string }>>(
            'orchestration_discover_providers',
            { input: {} },
          )
        : [
            { provider: 'claude', available: true },
            { provider: 'codex', available: true },
          ];
    const routed = routeWorkflowProviders(next, providers);
    setDefinition(routed);
    await service.save(routed);
    const run = await service.createRun(routed);
    void navigate(`/runs/${run.id}`);
  }
  function autoLayout() {
    checkpoint();
    setNodes((current) =>
      current.map((node, index) => ({
        ...node,
        position: { x: 80 + (index % 3) * 300, y: 70 + Math.floor(index / 3) * 180 },
      })),
    );
  }
  const selected = definition?.nodes.find((node) => node.id === selectedId);
  if (!definition) return <div className="workflow-loading">{c.editor}</div>;
  return (
    <section className="workflow-editor">
      <header className="workflow-editor__toolbar">
        <Link className="icon-button" to="/workflows" aria-label={c.back}>
          ←
        </Link>
        <input
          aria-label={c.name}
          value={definition.name}
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
          <button className="button button--compact" onClick={autoLayout}>
            <LayoutGrid size={15} />
            {c.autoLayout}
          </button>
          <button
            className="button button--compact"
            onClick={() => {
              const next = sync();
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
          <button className="button button--primary" onClick={() => void run()}>
            <Play size={15} />
            {c.run}
          </button>
        </div>
      </header>
      {message && (
        <div
          className={`workflow-editor__message${issues.length ? ' is-error' : ''}`}
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
        </aside>
        <div
          className="workflow-canvas"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('application/astra-node') as WorkflowNodeType;
            if (kinds.some((kind) => kind.type === type))
              add(type, { x: e.clientX - 360, y: e.clientY - 120 });
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            fitView
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={20} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="workflow-inspector">
          <h2>{c.inspector}</h2>
          {selected ? (
            <div className="workflow-fields">
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
                </>
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
