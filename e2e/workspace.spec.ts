import { expect, test, type Page } from '@playwright/test';

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

test('cold start renders an empty projects screen', async ({ page }) => {
  await page.goto('/?scenario=empty');

  await expect(page.getByRole('heading', { name: 'Recent Workspaces', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Folder' })).toBeEnabled();
  await expect(page.getByText('No recent workspaces')).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('opens a recent workspace and returns to Projects', async ({ page }) => {
  await page.goto('/?scenario=populated');

  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
  await expect(page.getByRole('tree', { name: 'Projects and sessions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Command Center' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('2 items need attention')).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.getByRole('button', { name: 'Back to Projects' }).click();
  await expect(page.getByRole('heading', { name: 'Recent Workspaces' })).toBeVisible();
});

test('blocks and safely removes a missing workspace', async ({ page }) => {
  await page.goto('/?scenario=missing');

  await expect(page.getByText('Missing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Archived Prototype' })).toBeDisabled();
  await page.getByRole('button', { name: 'More actions for Archived Prototype' }).click();
  await page.getByRole('menuitem', { name: 'Remove from Recent' }).click();

  const dialog = page.getByRole('alertdialog', { name: 'Remove from Recent?' });
  await expect(dialog).toContainText('will not delete the local folder');
  await dialog.getByRole('button', { name: 'Remove' }).click();

  await expect(page.getByText('Archived Prototype')).toHaveCount(0);
  await expect(page.getByText('1 workspace')).toBeVisible();
});

test('manages projects without deleting local files', async ({ page }) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('frontend');
  await expect(page.getByRole('heading', { name: 'frontend' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'backend-api' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('');

  await page.getByRole('button', { name: 'Add Project' }).click();
  await expect(page.getByRole('heading', { name: 'Astra Nexus' })).toBeVisible();
  await expect(page.getByText('4 projects')).toBeVisible();

  await page.getByRole('button', { name: 'Remove backend-api' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Remove project?' });
  await expect(dialog).toContainText('Files on disk will not be deleted');
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: 'backend-api' })).toHaveCount(0);
  await expectNoDocumentOverflow(page);
});
