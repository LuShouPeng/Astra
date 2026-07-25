import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { ExtensionsPage } from './ExtensionsPage';

describe('ExtensionsPage', () => {
  beforeEach(() => localStorage.clear());

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
    await user.click(screen.getByRole('button', { name: 'Save server' }));
    expect(screen.getByText('Exa')).toBeVisible();
    expect(localStorage.getItem('astra.extensions.mcp.v1')).not.toContain('api-key');
  }, 15_000);

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
    await user.click(within(row).getByRole('button', { name: 'Test connection' }));
    expect(within(row).getByRole('button', { name: 'Connected' })).toBeVisible();
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
