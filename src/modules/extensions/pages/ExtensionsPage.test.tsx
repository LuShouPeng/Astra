import { render, screen } from '@testing-library/react';
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
  });
});
