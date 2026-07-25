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
  await page.getByRole('button', { name: /Add$/ }).first().click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.locator('.react-flow__node').last().click();
  await page.getByRole('button', { name: /Delete node/ }).click();
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText('DAG is valid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('heading', { name: 'Workflow run' })).toBeVisible();
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve worktree creation' }).click();
  await expect(page.getByText('ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and start Agent' }).click();
  await expect(page.getByText('succeeded', { exact: true })).toBeVisible();
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
