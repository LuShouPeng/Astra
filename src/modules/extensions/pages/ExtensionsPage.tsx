import {
  Blocks,
  CheckCircle2,
  Download,
  FlaskConical,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import type { McpServerConfig, SkillPackage } from '../../../core/contracts/extensions';
import { useI18n } from '../../../core/i18n/I18nContext';

const MCP_KEY = 'astra.extensions.mcp.v1';
const SKILL_KEY = 'astra.extensions.skills.v1';
const catalog = [
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    version: 'latest',
    description: 'Design intelligence and accessibility guidance.',
    sourceUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
  },
  {
    id: 'everything-claude-code',
    name: 'Everything Claude Code',
    version: 'latest',
    description: 'Curated engineering workflows and reusable skills.',
    sourceUrl: 'https://github.com/affaan-m/everything-claude-code',
  },
];
function read<T>(key: string): T[] {
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
}

function runtimeInput(server: McpServerConfig): RuntimeMcpConfig {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args ?? [],
    url: server.url,
    secretRef: server.secretRefs.authorization,
  };
}
const copy = {
  en: {
    title: 'Extensions',
    sub: 'MCP servers and workflow-scoped Skills',
    mcp: 'MCP servers',
    skills: 'Skills',
    addMcp: 'Add MCP server',
    name: 'Name',
    transport: 'Transport',
    url: 'URL',
    command: 'Command',
    args: 'Arguments',
    credential: 'Credential reference',
    save: 'Save server',
    cancel: 'Cancel',
    test: 'Test connection',
    connected: 'Connected',
    remove: 'Uninstall',
    catalog: 'Curated catalog',
    source: 'Git or local source',
    install: 'Install',
    installed: 'Installed',
    search: 'Search extensions',
    empty: 'No MCP servers registered',
    legacy: 'Legacy SSE is not supported. Use Streamable HTTP.',
  },
  'zh-CN': {
    title: '扩展',
    sub: 'MCP 服务器与工作流级 Skill',
    mcp: 'MCP 服务器',
    skills: 'Skills',
    addMcp: '添加 MCP 服务器',
    name: '名称',
    transport: '传输方式',
    url: 'URL',
    command: '命令',
    args: '参数',
    credential: '凭据引用',
    save: '保存服务器',
    cancel: '取消',
    test: '测试连接',
    connected: '已连接',
    remove: '卸载',
    catalog: '策展目录',
    source: 'Git 或本地来源',
    install: '安装',
    installed: '已安装',
    search: '搜索扩展',
    empty: '尚未注册 MCP 服务器',
    legacy: '不支持旧版 SSE，请使用 Streamable HTTP。',
  },
} as const;

export function ExtensionsPage() {
  const { language } = useI18n();
  const c = copy[language];
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'skills' ? 'skills' : 'mcp';
  const [servers, setServers] = useState<McpServerConfig[]>(() => read(MCP_KEY));
  const [skills, setSkills] = useState<SkillPackage[]>(() => read(SKILL_KEY));
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [tested, setTested] = useState<string>();
  const [error, setError] = useState('');
  const [manualSource, setManualSource] = useState('');
  const [revision, setRevision] = useState('');
  const [installing, setInstalling] = useState(false);
  const [form, setForm] = useState({
    name: '',
    transport: 'streamable_http' as 'stdio' | 'streamable_http',
    url: '',
    command: '',
    args: '',
    credential: '',
    secret: '',
  });
  const installed = useMemo(() => new Set(skills.map((skill) => skill.id)), [skills]);
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void invoke<RuntimeMcpConfig[]>('orchestration_list_mcp_servers')
      .then((items) => {
        setServers(
          items.map((item): McpServerConfig => ({
            id: item.id,
            name: item.name,
            transport: item.transport,
            command: item.command,
            args: item.args,
            url: item.url,
            secretRefs: item.secretRef ? { authorization: item.secretRef } : {},
            enabled: true,
            source: 'manual',
          })),
        );
      })
      .catch(() => setError('MCP registry could not be loaded.'));
  }, []);
  async function saveServer() {
    if (
      !form.name.trim() ||
      (form.transport === 'streamable_http' ? !/^https?:\/\//.test(form.url) : !form.command.trim())
    )
      return;
    const server: McpServerConfig = {
      id: `mcp-${crypto.randomUUID()}`,
      name: form.name.trim(),
      transport: form.transport,
      url: form.transport === 'streamable_http' ? form.url : undefined,
      command: form.transport === 'stdio' ? form.command : undefined,
      args: form.transport === 'stdio' ? form.args.split(/\s+/).filter(Boolean) : undefined,
      secretRefs: form.credential ? { authorization: form.credential } : {},
      enabled: true,
      source: 'manual',
    };
    const next = [server, ...servers];
    if (form.secret && form.credential && '__TAURI_INTERNALS__' in window) {
      await invoke('orchestration_store_secret', {
        reference: form.credential,
        secret: form.secret,
      });
    }
    if ('__TAURI_INTERNALS__' in window) {
      await invoke('orchestration_save_mcp_server', { input: runtimeInput(server) });
    }
    setServers(next);
    localStorage.setItem(MCP_KEY, JSON.stringify(next));
    setShowForm(false);
  }
  async function testConnection(server: McpServerConfig) {
    setError('');
    try {
      if ('__TAURI_INTERNALS__' in window) {
        await invoke('orchestration_test_mcp_connection', { input: runtimeInput(server) });
      }
      setTested(server.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function removeServer(server: McpServerConfig) {
    if ('__TAURI_INTERNALS__' in window)
      await invoke('orchestration_delete_mcp_server', { id: server.id });
    const next = servers.filter((item) => item.id !== server.id);
    setServers(next);
    localStorage.setItem(MCP_KEY, JSON.stringify(next));
  }
  async function install(item: (typeof catalog)[number]) {
    setInstalling(true);
    setError('');
    try {
      const result =
        '__TAURI_INTERNALS__' in window
          ? await invoke<{ contentHash: string; installPath: string }>(
              'orchestration_install_git_skill',
              { sourceUrl: item.sourceUrl, revision: null },
            )
          : {
              contentHash: `sha256:${item.id.padEnd(64, '0').slice(0, 64)}`,
              installPath: `astra-cache/${item.id}`,
            };
      const pkg: SkillPackage = {
        id: item.id,
        name: item.name,
        version: item.version,
        description: item.description,
        source: 'catalog',
        sourceUrl: item.sourceUrl,
        contentHash: result.contentHash,
        installPath: result.installPath,
        installedAt: new Date().toISOString(),
      };
      const next = [pkg, ...skills.filter((skill) => skill.id !== pkg.id)];
      setSkills(next);
      localStorage.setItem(SKILL_KEY, JSON.stringify(next));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(false);
    }
  }
  async function installManual() {
    if (!manualSource.trim()) return;
    setInstalling(true);
    setError('');
    try {
      const isGit = /^https:\/\//.test(manualSource.trim());
      const result =
        '__TAURI_INTERNALS__' in window
          ? await invoke<{ contentHash: string; installPath: string }>(
              isGit ? 'orchestration_install_git_skill' : 'orchestration_install_local_skill',
              isGit
                ? { sourceUrl: manualSource.trim(), revision: revision.trim() || null }
                : { sourcePath: manualSource.trim() },
            )
          : {
              contentHash: `sha256:${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)}`,
              installPath: `astra-cache/${crypto.randomUUID()}`,
            };
      const name =
        manualSource
          .split(/[\\/]/)
          .filter(Boolean)
          .at(-1)
          ?.replace(/\.git$/, '') || 'Installed Skill';
      const pkg: SkillPackage = {
        id: `skill-${crypto.randomUUID()}`,
        name,
        version: revision.trim() || 'local',
        description: 'Manually installed Skill package.',
        source: isGit ? 'git' : 'local',
        sourceUrl: isGit ? manualSource.trim() : undefined,
        sourceRevision: revision.trim() || undefined,
        contentHash: result.contentHash,
        installPath: result.installPath,
        installedAt: new Date().toISOString(),
      };
      const next = [pkg, ...skills];
      setSkills(next);
      localStorage.setItem(SKILL_KEY, JSON.stringify(next));
      setManualSource('');
      setRevision('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(false);
    }
  }
  const filtered = catalog.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="extensions-page">
      <header className="workflow-page-header">
        <div>
          <span className="eyebrow">Astra Nexus</span>
          <h1>{c.title}</h1>
          <p>{c.sub}</p>
        </div>
        {tab === 'mcp' && (
          <button className="button button--secondary" onClick={() => setShowForm(true)}>
            <Plus size={16} />
            {c.addMcp}
          </button>
        )}
      </header>
      {error && (
        <div className="workflow-editor__message is-error" role="alert">
          {error}
        </div>
      )}
      <nav className="extensions-tabs" aria-label="Extension type">
        <button
          className={tab === 'mcp' ? 'is-active' : ''}
          onClick={() => setParams({ tab: 'mcp' })}
        >
          <Server size={16} />
          {c.mcp}
        </button>
        <button
          className={tab === 'skills' ? 'is-active' : ''}
          onClick={() => setParams({ tab: 'skills' })}
        >
          <Blocks size={16} />
          {c.skills}
        </button>
      </nav>
      {tab === 'mcp' ? (
        <>
          {servers.length === 0 ? (
            <div className="workflow-empty">
              <Server size={28} />
              <h2>{c.empty}</h2>
            </div>
          ) : (
            <div className="extension-list">
              {servers.map((server) => (
                <article key={server.id}>
                  <span className="extension-icon">
                    <Server size={18} />
                  </span>
                  <div>
                    <strong>{server.name}</strong>
                    <small>
                      {server.transport === 'streamable_http'
                        ? server.url
                        : `${server.command} ${(server.args ?? []).join(' ')}`}
                    </small>
                  </div>
                  <code>{server.transport}</code>
                  <button
                    className="button button--compact"
                    onClick={() => void testConnection(server)}
                  >
                    <FlaskConical size={14} />
                    {tested === server.id ? c.connected : c.test}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${c.remove} ${server.name}`}
                    onClick={() => void removeServer(server)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="extension-search">
            <Search size={15} />
            <label className="sr-only" htmlFor="extension-search">
              {c.search}
            </label>
            <input
              id="extension-search"
              placeholder={c.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <form
            className="skill-source"
            onSubmit={(event) => {
              event.preventDefault();
              void installManual();
            }}
          >
            <label>
              {c.source}
              <input
                value={manualSource}
                onChange={(event) => setManualSource(event.target.value)}
                placeholder="https://github.com/org/skill.git or C:\\skills\\my-skill"
              />
            </label>
            <label>
              Commit / tag
              <input
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
                placeholder="v1.0.0"
              />
            </label>
            <button
              className="button button--secondary"
              disabled={!manualSource.trim() || installing}
            >
              <Download size={15} />
              {installing ? 'Installing...' : c.install}
            </button>
          </form>
          <h2 className="extension-heading">{c.catalog}</h2>
          <div className="skill-catalog">
            {filtered.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </div>
                <dl>
                  <div>
                    <dt>Version</dt>
                    <dd>{item.version}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{item.sourceUrl}</dd>
                  </div>
                </dl>
                <button
                  className={`button ${installed.has(item.id) ? 'button--secondary' : 'button--primary'}`}
                  onClick={() => void install(item)}
                  disabled={installed.has(item.id) || installing}
                >
                  {installed.has(item.id) ? <CheckCircle2 size={15} /> : <Download size={15} />}{' '}
                  {installed.has(item.id) ? c.installed : c.install}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {showForm && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="extension-dialog"
            aria-label={c.addMcp}
            onSubmit={(e) => {
              e.preventDefault();
              void saveServer();
            }}
          >
            <button
              type="button"
              className="icon-button extension-dialog__close"
              aria-label={c.cancel}
              onClick={() => setShowForm(false)}
            >
              <X size={16} />
            </button>
            <h2>{c.addMcp}</h2>
            <label>
              {c.name}
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              {c.transport}
              <select
                value={form.transport}
                onChange={(e) =>
                  setForm({ ...form, transport: e.target.value as typeof form.transport })
                }
              >
                <option value="streamable_http">Streamable HTTP</option>
                <option value="stdio">stdio</option>
              </select>
            </label>
            {form.transport === 'streamable_http' ? (
              <label>
                {c.url}
                <input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
            ) : (
              <>
                <label>
                  {c.command}
                  <input
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                  />
                </label>
                <label>
                  {c.args}
                  <input
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              {c.credential}
              <input
                value={form.credential}
                onChange={(e) => setForm({ ...form, credential: e.target.value })}
              />
            </label>
            <label>
              Secret
              <input
                type="password"
                autoComplete="off"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
              />
            </label>
            <p>{c.legacy}</p>
            <div>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setShowForm(false)}
              >
                {c.cancel}
              </button>
              <button className="button button--primary">{c.save}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
