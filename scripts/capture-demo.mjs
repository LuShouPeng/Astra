import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'artifacts', 'demo');
const screenshotDir = path.join(outputDir, 'screenshots');
const recordingDir = path.join(outputDir, 'recording');
const baseUrl = process.env.ASTRA_DEMO_URL ?? 'http://127.0.0.1:1422/?scenario=populated';
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(recordingDir, { recursive: true, force: true });
await fs.mkdir(recordingDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: recordingDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();

await page.goto(baseUrl);
await page.getByRole('button', { name: 'Open Astra Nexus' }).click();
await page.getByRole('heading', { name: 'Command Center' }).waitFor();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '01-command-center.png') });

await page.getByRole('link', { name: 'Needs Attention' }).click();
await page.getByRole('heading', { name: 'Needs Attention' }).waitFor();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '02-attention.png') });
await page.getByRole('button', { name: 'Approve Dependency approval required' }).click();
await pause(1_000);

await page.evaluate(() => {
  location.hash = '/sessions/session-backend-claude';
});
await page.getByRole('heading', { name: 'Fix intermittent login timeout' }).waitFor();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '03-session-timeline.png') });

await page.getByRole('tab', { name: 'Changes 4' }).click();
await page.getByText('-const timeout = 5000;').waitFor();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '04-review-changes.png') });

await page.getByRole('link', { name: 'Settings' }).click();
await page.getByRole('tab', { name: 'Demo' }).click();
await page.getByRole('radio', { name: '2x' }).click();
await pause(800);
await page.screenshot({ path: path.join(screenshotDir, '05-demo-controls.png') });
for (let step = 0; step < 3; step += 1) {
  await page.getByRole('button', { name: 'Next demo step' }).click();
  await pause(900);
}

await page.getByRole('link', { name: 'Notifications' }).click();
await page.getByText('Claude simulation completed').waitFor();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '06-notifications.png') });

await page.getByRole('link', { name: 'Command Center' }).click();
await pause(1_500);
await page.screenshot({ path: path.join(screenshotDir, '07-command-center-final.png') });

const video = page.video();
await context.close();
await browser.close();
if (!video) throw new Error('Playwright did not create a demo recording.');
await fs.copyFile(await video.path(), path.join(outputDir, 'astra-nexus-demo-raw.webm'));
