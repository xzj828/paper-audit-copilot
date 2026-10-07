import { test as base } from '@playwright/test';
import path from 'node:path';
import { createStore } from '../../server/store.js';
import { makeDemo } from '../fixtures.js';

// Legacy UI tests need controlled findings/report snapshots. Seed only the dedicated
// E2E database and the current test's isolated workspace, never the application.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.request.get('/api/projects');
    const cookie = (await page.context().cookies()).find((item) => item.name === 'audit_workspace');
    const store = createStore(path.resolve('test-results/e2e-data'));
    try {
      if (!cookie || !store.hasWorkspace(cookie.value)) throw new Error('Missing test workspace');
      const project = makeDemo();
      // Render the saved text through the supported DOCX preview, not a removed demo UI.
      project.versions[0].format = 'docx';
      project.versions[0].filename = '合成控制论文.docx';
      project.versions[0].parse.sections = project.versions[0].parse.sections.map((section) => ({
        ...section,
        text: `${section.text}${section.after ? ` ${section.after}` : ''}`,
        after: undefined,
      }));
      store.save(cookie.value, project);
    } finally {
      store.db.close();
    }
    await use(page);
  },
});
