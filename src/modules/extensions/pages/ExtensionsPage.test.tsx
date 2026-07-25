import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { fromRuntimeMcp } from '../model/extensionRuntime';
import { ExtensionsPage } from './ExtensionsPage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe('ExtensionsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('preserves a disabled MCP server loaded from the runtime registry', () => {
    expect(
      fromRuntimeMcp({
        id: 'exa',
        name: 'Exa',
        transport: 'streamable_http',
        args: [],
        url: 'https://mcp.exa.ai/mcp',
        enabled: false,
      }).enabled,
    ).toBe(false);
  });

  it('registers a Streamable HTTP MCP server without persisting a secret', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/extensions?tab=mcp']}>
          <ExtensionsPage />
        </MemoryRouter>
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add MCP server' }));
    await user.type(screen.getByLabelText('Name'), 'Exa');
    await user.type(screen.getByLabelText('URL'), 'https://mcp.exa.ai/mcp');
    await user.type(screen.getByLabelText('Credential reference'), 'windows:astra/exa');
    await user.type(screen.getByLabelText('Secret'), 'api-key-must-be-cleared');
    await user.click(screen.getByRole('button', { name: 'Save server' }));
    expect(screen.getByText('Exa')).toBeVisible();
    expect(localStorage.getItem('astra.extensions.mcp.v1')).not.toContain('api-key');
    await user.click(screen.getByRole('button', { name: 'Add MCP server' }));
    expect(screen.getByLabelText('Secret')).toHaveValue('');
  }, 15_000);

  it('shows a runtime validation error when MCP registration is rejected', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockImplementation((command) => {
      if (command === 'orchestration_list_mcp_servers' || command === 'orchestration_list_skills') {
        return Promise.resolve([]);
      }
      if (command === 'orchestration_save_mcp_server') {
        return Promise.reject(new Error('The MCP URL must use HTTPS or local HTTP.'));
      }
      return Promise.resolve(undefined);
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/extensions?tab=mcp']}>
          <ExtensionsPage />
        </MemoryRouter>
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add MCP server' }));
    await user.type(screen.getByLabelText('Name'), 'Unsafe');
    await user.type(screen.getByLabelText('URL'), 'http://localhost.evil.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Save server' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The MCP URL must use HTTPS or local HTTP.',
    );
    expect(screen.getByRole('heading', { name: 'Add MCP server' })).toBeVisible();
  });

  it('registers, tests, and removes a stdio MCP server in browser mode', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/extensions?tab=mcp']}>
          <ExtensionsPage />
        </MemoryRouter>
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add MCP server' }));
    await user.type(screen.getByLabelText('Name'), 'Local tools');
    await user.selectOptions(screen.getByLabelText('Transport'), 'stdio');
    await user.type(screen.getByLabelText('Command'), 'node.exe');
    await user.type(screen.getByLabelText('Arguments'), 'server.js --quiet');
    await user.click(screen.getByRole('button', { name: 'Save server' }));
    const row = screen.getByText('Local tools').closest('article')!;
    expect(within(row).getByText('node.exe server.js --quiet')).toBeVisible();
    await user.click(within(row).getByRole('checkbox', { name: 'Enabled' }));
    expect(within(row).getByRole('checkbox', { name: 'Disabled' })).not.toBeChecked();
    expect(localStorage.getItem('astra.extensions.mcp.v1')).toContain('"enabled":false');
    await user.click(within(row).getByRole('button', { name: 'Test connection' }));
    expect(within(row).getByRole('button', { name: 'Connected · 3 tools' })).toHaveAttribute(
      'title',
      'search, fetch, read',
    );
    await user.click(within(row).getByRole('button', { name: 'Uninstall Local tools' }));
    expect(screen.getByText('No MCP servers registered')).toBeVisible();
  }, 15_000);

  it('installs, filters, exports, and uninstalls a curated Skill', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/extensions?tab=skills']}>
          <ExtensionsPage />
        </MemoryRouter>
      </I18nProvider>,
    );
    const search = screen.getByLabelText('Search extensions');
    await user.type(search, 'UI/UX');
    expect(screen.getByText('UI/UX Pro Max')).toBeVisible();
    expect(screen.queryByText('Everything Claude Code')).not.toBeInTheDocument();
    const catalogCard = screen.getByText('UI/UX Pro Max').closest('article')!;
    await user.click(within(catalogCard).getByRole('button', { name: 'Install' }));
    expect(screen.getByRole('heading', { name: 'Installed Skills' })).toBeVisible();
    const installedRow = screen.getAllByText('UI/UX Pro Max')[0].closest('article')!;
    await user.click(within(installedRow).getByRole('button', { name: 'Export to Provider' }));
    await user.type(screen.getByLabelText('Provider Skills directory'), 'C:\\skills');
    await user.click(screen.getByLabelText('Replace an existing package'));
    await user.click(screen.getByRole('button', { name: 'Confirm export' }));
    expect(screen.queryByRole('dialog', { name: 'Export to Provider' })).not.toBeInTheDocument();
    await user.click(within(installedRow).getByRole('button', { name: 'Uninstall UI/UX Pro Max' }));
    expect(screen.queryByRole('heading', { name: 'Installed Skills' })).not.toBeInTheDocument();
  }, 15_000);

  it('installs a local Skill and recovers from corrupt extension storage', async () => {
    localStorage.setItem('astra.extensions.skills.v1', '{broken');
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/extensions?tab=skills']}>
          <ExtensionsPage />
        </MemoryRouter>
      </I18nProvider>,
    );
    const source = screen.getByLabelText('Git or local source');
    await user.type(source, 'C:\\skills\\review');
    await user.click(within(source.closest('form')!).getByRole('button', { name: 'Install' }));
    expect(screen.getByText('review')).toBeVisible();
    expect(localStorage.getItem('astra.extensions.skills.v1')).toContain('review');
  }, 15_000);
});
