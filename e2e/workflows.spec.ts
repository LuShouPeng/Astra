import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

async function openWorkbench(page: Page) {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
}

test('generates, edits, validates, and creates a workflow run', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('link', { name: 'Workflows' }).click();
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await page.getByLabel('Workflow goal').fill('Implement authentication and run tests');
  await page.getByRole('button', { name: 'Generate draft' }).click();

  await expect(page).toHaveURL(/#\/workflows\/workflow-/);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.locator('.react-flow__node').first().click();
  const nodeName = page.locator('.workflow-inspector').getByLabel('Name');
  const originalNodeName = await nodeName.inputValue();
  await nodeName.fill('Edited Agent');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.locator('.react-flow__node').first().click();
  await expect(page.locator('.workflow-inspector').getByLabel('Name')).toHaveValue(
    originalNodeName,
  );
  await page.getByRole('button', { name: 'Duplicate node' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.locator('.react-flow__node').last().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.locator('.react-flow__node').last().click();
  await page.getByRole('button', { name: 'Delete node' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: /Add$/ }).first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.keyboard.press('Control+KeyZ');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.keyboard.press('Control+KeyY');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await page.locator('.react-flow__edge-path').first().click({ force: true });
  await page.getByLabel('Branch outcome').selectOption('success');
  await expect(
    page.locator('.react-flow__edge-text', { hasText: 'success' }).first(),
  ).toBeVisible();
  await page.locator('.react-flow__node').last().click();
  await page.getByRole('button', { name: /Delete node/ }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText('DAG is valid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { name: 'Workflow run' })).toBeVisible();
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve worktree creation' }).click();
  await expect(page.getByText('ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start orchestration' }).click();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
});

test('registers MCP and keeps workflow surfaces contained at target sizes', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('link', { name: 'Extensions' }).click();
  await page.getByRole('button', { name: 'Add MCP server' }).click();
  await page.getByLabel('Name').fill('Local tools');
  await page.getByLabel('URL').fill('https://example.test/mcp');
  await page.getByLabel('Credential reference').fill('astra/local-tools');
  await page.getByRole('button', { name: 'Save server' }).click();
  await expect(page.getByText('Local tools')).toBeVisible();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const skillCard = page.getByText('UI/UX Pro Max').locator('xpath=ancestor::article');
  await skillCard.getByRole('button', { name: 'Install' }).click();
  await expect(page.getByRole('heading', { name: 'Installed Skills' })).toBeVisible();

  await page.getByRole('link', { name: 'Workflows' }).click();
  await page.getByLabel('Workflow goal').fill('Research the repository with local tools');
  await page.getByRole('button', { name: 'Generate draft' }).click();
  const agentNode = page.locator('.react-flow__node').first();
  await page.getByRole('button', { name: 'Local tools MCP' }).dragTo(agentNode);
  await page.getByRole('button', { name: 'UI/UX Pro Max Skill' }).dragTo(agentNode);
  await agentNode.click();
  await expect(page.getByRole('checkbox', { name: 'Local tools' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'UI/UX Pro Max' })).toBeChecked();

  await page.getByRole('link', { name: 'Extensions' }).click();

  for (const viewport of [
    { width: 1200, height: 640 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoDocumentOverflow(page);
  }

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
  await page.getByRole('link', { name: '工作流' }).click();
  await expect(page.getByRole('heading', { name: '工作流', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成草案' })).toBeVisible();
  await expectNoDocumentOverflow(page);
});
