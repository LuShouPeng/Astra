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

test('opens a session timeline and records a deterministic follow-up', async ({ page }) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  const tree = page.getByRole('tree', { name: 'Projects and sessions' });
  await tree.getByRole('link', { name: 'Fix intermittent login timeout Unread' }).click();

  await expect(page.getByRole('heading', { name: 'Fix intermittent login timeout' })).toBeVisible();
  await expect(page.getByText('Claude started the deterministic demo session.')).toBeVisible();
  await expect(page.getByText('rg "session timeout" src/auth')).toBeVisible();
  await expect(page.getByText('0 passed, 0 failed')).toBeVisible();

  await page.getByRole('tab', { name: 'Changes 4' }).click();
  await expect(page.getByRole('option', { name: /src\/auth\/session\.ts/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline 6' }).click();

  await page.getByLabel('Follow-up message').fill('Check the refresh token boundary.');
  await page.getByRole('button', { name: 'Send follow-up' }).click();
  await expect(page.getByText('Check the refresh token boundary.')).toBeVisible();
  await expect(page.locator('.session-status')).toHaveText('running');
  await expectNoDocumentOverflow(page);
});

test('resolves attention and synchronizes command center counts', async ({ page }) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await page.getByRole('link', { name: 'Needs Attention' }).click();

  await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(6);
  await page.getByRole('button', { name: 'Approve Dependency approval required' }).click();
  await page.getByRole('button', { name: 'Retry TypeScript typecheck failed' }).click();
  await expect(page.getByText('No open items in this filter.')).toBeVisible();

  await page.getByRole('link', { name: 'Command Center' }).click();
  await expect(page.locator('[data-status="running"] strong')).toHaveText('4');
  await expect(page.locator('[data-status="waiting"] strong')).toHaveText('0');
  await expect(page.locator('[data-status="failed"] strong')).toHaveText('0');
  await expect(page.getByText('0 items need attention')).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('reviews a text diff and requests a deterministic rerun', async ({ page }) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await page.getByRole('link', { name: 'Changes', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Review Changes' })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(4);
  await expect(page.getByText('-const timeout = 5000;')).toBeVisible();
  await page.getByRole('option', { name: /docs\/auth-flow\.png/ }).click();
  await expect(page.getByText('Binary preview unavailable')).toBeVisible();
  await page.getByRole('option', { name: /src\/auth\/session\.ts/ }).click();

  await page.getByRole('button', { name: 'Request Changes' }).click();
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await page
    .getByLabel('Requested changes')
    .fill('Cover the refresh-token boundary without changing the public API.');
  await page.getByLabel('Severity').selectOption('high');
  await page.getByRole('button', { name: 'Submit request' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Changes requested' })).toBeVisible();
  await page.getByRole('link', { name: 'Open Session' }).click();
  await expect(
    page.getByText('[High] Cover the refresh-token boundary without changing the public API.'),
  ).toBeVisible();
  await expect(page.locator('.session-status')).toHaveText('running');
  await expectNoDocumentOverflow(page);
});

test('opens notifications, follows a target, and persists notification settings', async ({
  page,
}) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await page.getByRole('link', { name: 'Notifications' }).click();

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Codex needs approval' }).click();
  await expect(page.getByRole('heading', { name: 'Fix mobile navigation layout' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Notifications' }).click();
  await page.getByRole('checkbox', { name: 'Notify on Completed' }).uncheck();
  await page.getByRole('button', { name: 'Send test notification' }).click();
  await expect(page.getByRole('status')).toHaveText('Desktop notification sent');
  await expectNoDocumentOverflow(page);
});

test('plays, steps, and resets the deterministic demo', async ({ page }) => {
  await page.goto('/?scenario=populated');
  await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Demo' }).click();

  await expect(page.getByText('Step 0 of 3')).toBeVisible();
  await page.getByRole('radio', { name: '2x' }).click();
  await page.getByRole('button', { name: 'Play demo' }).click();
  await expect(page.getByText(/^Step [1-3] of 3$/)).toBeVisible({ timeout: 5_000 });
  const pause = page.getByRole('button', { name: 'Pause demo' });
  if (await pause.isVisible()) await pause.click();
  await page.getByRole('button', { name: 'Reset Demo Data' }).click();
  await expect(page.getByText('Step 0 of 3')).toBeVisible();

  await page.getByRole('button', { name: 'Next demo step' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next demo step' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next demo step' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();

  await page.getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByText('Claude simulation completed')).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Demo' }).click();
  await page.getByRole('button', { name: 'Reset Demo Data' }).click();
  await expect(page.getByText('Step 0 of 3')).toBeVisible();
  await expectNoDocumentOverflow(page);
});
