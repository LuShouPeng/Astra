import { Plus, Search, Sparkles, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import { useI18n } from '../../../core/i18n/I18nContext';
import {
  createWorkflowDraft,
  finalizePlannedWorkflow,
  generateWorkflowDraft,
  instantiateWorkflowTemplate,
} from '../model/workflowPlanner';
import { loadProviderPreferences } from '../model/providerPreferences';
import { createDefaultWorkflowService, type WorkflowService } from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';

export function WorkflowsPage({
  projectId,
  service: supplied,
}: {
  projectId: string;
  service?: WorkflowService;
}) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { language } = useI18n();
  const c = workflowCopy(language);
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [templates, setTemplates] = useState<WorkflowDefinition[]>([]);
  const [goal, setGoal] = useState('');
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void service.list().then(setWorkflows);
    void Promise.resolve(service.listTemplates?.() ?? []).then(setTemplates);
  }, [service]);

  async function create(definition: WorkflowDefinition) {
    await service.save(definition);
    void navigate(`/workflows/${definition.id}`);
  }

  async function generate() {
    const trimmed = goal.trim();
    if (!trimmed) return;
    setGenerating(true);
    setNotice('');
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const planned = await invoke<unknown>('orchestration_plan_workflow', {
          input: { projectId, goal: trimmed, ...loadProviderPreferences() },
        });
        await create(finalizePlannedWorkflow(projectId, planned));
      } else {
        await create(generateWorkflowDraft(projectId, trimmed));
      }
    } catch {
      setNotice(
        language === 'zh-CN'
          ? '规划 Provider 不可用，已生成离线确定性草案。'
          : 'The planning Provider was unavailable; an offline deterministic draft was generated.',
      );
      await create(generateWorkflowDraft(projectId, trimmed));
    } finally {
      setGenerating(false);
    }
  }

  const visible = workflows.filter((item) =>
    `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="workflow-list-page">
      <header className="workflow-page-header">
        <div>
          <span className="eyebrow">Astra Nexus</span>
          <h1>{c.title}</h1>
          <p>{c.subtitle}</p>
        </div>
        <button
          className="button button--secondary"
          onClick={() => void create(createWorkflowDraft(projectId))}
        >
          <Plus size={16} aria-hidden="true" />
          {c.newWorkflow}
        </button>
      </header>
      <form
        className="workflow-generator"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <label htmlFor="workflow-goal">{c.goal}</label>
        <div>
          <textarea
            id="workflow-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={c.goalPlaceholder}
          />
          <button className="button button--primary" disabled={!goal.trim() || generating}>
            <Sparkles size={16} aria-hidden="true" />
            {generating ? (language === 'zh-CN' ? '规划中' : 'Planning') : c.generate}
          </button>
        </div>
        {notice && <small role="status">{notice}</small>}
      </form>
      {templates.length > 0 && (
        <section className="workflow-templates" aria-labelledby="workflow-templates-title">
          <h2 id="workflow-templates-title">
            {language === 'zh-CN' ? '工作流模板' : 'Workflow templates'}
          </h2>
          <div>
            {templates.map((template) => (
              <button
                className="button button--secondary"
                key={template.id}
                onClick={() => void create(instantiateWorkflowTemplate(template, projectId))}
              >
                <Workflow size={15} />
                {template.name}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="workflow-search">
        <Search size={15} aria-hidden="true" />
        <label className="sr-only" htmlFor="workflow-search">
          Search workflows
        </label>
        <input
          id="workflow-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
        />
      </div>
      {visible.length === 0 ? (
        <div className="workflow-empty">
          <Workflow size={30} aria-hidden="true" />
          <h2>{c.empty}</h2>
          <p>{c.emptyBody}</p>
        </div>
      ) : (
        <div className="workflow-table" role="list">
          {visible.map((item) => (
            <Link role="listitem" key={item.id} to={`/workflows/${item.id}`}>
              <span className="workflow-table__icon">
                <Workflow size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.description || item.projectId}</small>
              </span>
              <span>
                {item.nodes.length} {c.nodes}
              </span>
              <time>
                {c.updated} {new Date(item.updatedAt).toLocaleDateString(language)}
              </time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
