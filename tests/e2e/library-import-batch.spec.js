import path from 'node:path';
import { provisionTestAccount } from '../account-helper.js';
import { test, expect } from './authenticated-test.js';

test('paper import uses the current browser workspace and is safe to reopen', async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  await page.goto('/#library');
  await expect(page.locator('.library-heading .catalog-title')).toContainText('0 篇');
  const importer = await page.context().newPage();
  await importer.goto('/imports/ecology-seven-20261107/index.html');
  await expect(importer).toHaveURL(/#library$/, { timeout: 60000 });
  await expect(importer.locator('.library-heading .catalog-title')).toContainText('7 篇');
  // The library tab was open before the import; returning must update its empty list.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.library-heading .catalog-title')).toContainText('7 篇', { timeout: 10000 });
  let projects = await (await page.request.get('/api/projects')).json();
  expect(projects).toHaveLength(7);
  expect(projects.every(p => p.purpose === 'library')).toBe(true);
  await expect(page.locator('.recent-projects .project-row')).toHaveCount(0);
  expect(projects.flatMap(p => p.versions).every(v => v.status === 'ready')).toBe(true);
  const ids = projects.map(p => p.id).sort();
  const other = await browser.newContext({ baseURL });
  try {
    const user = await provisionTestAccount(path.resolve(process.env.E2E_DATA_DIR || 'test-results/e2e-data'));
    await other.request.post('/api/auth/login', { data: { username: user.username, password: user.password } });
    const untouched = await (await other.request.get('/api/projects')).json();
    expect(untouched).toHaveLength(0);
  } finally { await other.close(); }
  await page.goto('/imports/ecology-seven-20261107/index.html');
  await expect(page).toHaveURL(/#library$/, { timeout: 15000 });
  projects = await (await page.request.get('/api/projects')).json();
  expect(projects.map(p => p.id).sort()).toEqual(ids);
});
