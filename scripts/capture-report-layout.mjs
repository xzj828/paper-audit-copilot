// Read a saved report into an isolated QA account; never modify the source workspace.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { createStore } from '../server/store.js';
import { createPaperAuditApplication } from '../server/application.js';
import { provisionTestAccount } from '../tests/account-helper.js';

const [projectId, label = 'after'] = process.argv.slice(2);
if (!projectId) throw new Error('Usage: node scripts/capture-report-layout.mjs <project-id> [label]');
const db = new DatabaseSync(path.resolve('data/copilot.sqlite'), { readOnly: true });
const row = db.prepare('SELECT data FROM projects WHERE id=?').get(projectId);
db.close();
if (!row) throw new Error('Report project not found');
const project = JSON.parse(row.data);
const directory = await mkdtemp(path.join(os.tmpdir(), 'report-layout-qa-'));
const user = await provisionTestAccount(directory);
const store = createStore(directory);
store.save(user.workspaceId, project);
store.db.close();
const app = createPaperAuditApplication({ dataDirectory: directory, rootDirectory: process.cwd() });
const { origin } = await app.start({ port: 0 });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const output = 'docs/design/report-readability-2026-11-10';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1010, height: 900 } });
  const login = await page.request.post(`${origin}/api/auth/login`, { data: { username: user.username, password: user.password } });
  if (!login.ok()) throw new Error('QA account login failed');
  await page.goto(`${origin}/#paper/${projectId}`);
  await page.getByRole('button', { name: /查看论文$/ }).click();
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  await page.getByRole('button', { name: '最大化预览', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const report = page.getByRole('article', { name: '报告正文' });
  await report.getByRole('heading', { name: '审稿意见', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/${label}-desktop.png` });
  const sources = report.locator('.report-evidence').first();
  if (await sources.count()) {
    await sources.locator('summary').click();
    await sources.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${label}-sources.png` });
    await sources.locator('summary').click();
  }
  await report.locator('.report-issue').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/${label}-issue.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await report.evaluate(el => { el.closest('.artifact-scroll').scrollTop = 0; });
  await page.screenshot({ path: `${output}/${label}-mobile.png` });
  console.log(`Saved ${label} report screenshots to ${output}`);
} finally {
  await browser.close();
  await app.close();
  if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('report-layout-qa-')) {
    await rm(directory, { recursive: true, force: true });
  }
}
