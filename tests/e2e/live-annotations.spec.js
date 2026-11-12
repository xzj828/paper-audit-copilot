import { test, expect } from './authenticated-test.js';
import { docxFixture, multipagePdfFixture } from '../fixtures.js';
import { mkdir, readFile } from 'node:fs/promises';

const output = 'docs/design/live-annotations-2026-11-10';
async function screenshot(page, name) {
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function setup(page, format = 'pdf', documentBuffer) {
  const project = await (
    await page.request.post('/api/projects', { data: { title: '实时批注验证' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      file: {
        name: `研究论文.${format}`,
        mimeType:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer:
          documentBuffer ||
          (format === 'pdf'
            ? multipagePdfFixture(3)
            : docxFixture(
                '样本来自同一地点的多次测量。研究直接将这些测量视为独立重复，并据此推广到全部研究区域。',
              )),
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/projects/${project.id}`)).json()).versions[0].status,
    )
    .toBe('ready');
  const snapshot = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const version = snapshot.versions[0];
  version.findings = [];
  version.runs = [
    {
      id: 'live-run',
      scope: 'scientific-trial',
      status: 'running',
      stage: '正在核对原文',
      modules: [],
      createdAt: new Date().toISOString(),
    },
  ];
  const chat = await (await page.request.post('/api/studio/chats', { data: {} })).json();
  chat.run = {
    id: 'chat-run',
    status: 'running',
    stage: '正在评审论文',
    createdAt: new Date().toISOString(),
  };
  chat.messages = [
    {
      id: 'user-message',
      role: 'user',
      text: '评审这篇论文，重点检查研究方法。',
      at: new Date().toISOString(),
    },
    {
      id: 'live-review',
      role: 'tool',
      name: 'review_document',
      status: 'running',
      at: new Date().toISOString(),
      result: { reviewProjectId: project.id, reviewVersionId: version.id },
    },
  ];
  await page.route(`**/api/projects/${project.id}`, (route) => route.fulfill({ json: snapshot }));
  await page.route(`**/api/studio/chats/${chat.id}`, (route) => route.fulfill({ json: chat }));
  await page.goto(`/#chat/${chat.id}`);
  const collapse = page.getByRole('button', { name: '收起导航栏', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await expect(page.getByRole('complementary', { name: '评审预览', exact: true })).toBeVisible();
  return { snapshot, version, chat };
}
function finding(version, id, page = 1) {
  const section =
    version.format === 'pdf'
      ? version.parse.sections.find((s) => s.id === `page-${page}`)
      : version.parse.sections.at(-1);
  return {
    id,
    title: `问题 ${id}：补充研究依据`,
    suggestion: '请说明独立样本的来源，并限定结论适用范围。',
    explanation: '当前材料不足以支持该推断。',
    severity: '主要问题',
    status: 'open',
    verification: { citation: 'passed', reasoning: 'passed' },
    anchor: {
      elementId: section.id,
      section: section.title,
      quote: section.text,
      offset: 0,
      ...(version.format === 'pdf' ? { page } : {}),
    },
  };
}

test('upload parses and automatically previews PDF and structured Word without opening the file picker again', async ({
  page,
}) => {
  await page.goto('/#new');
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
  await page
    .locator('input[type=file]:not([webkitdirectory])')
    .first()
    .setInputFiles({
      name: '自动预览.pdf',
      mimeType: 'application/pdf',
      buffer: multipagePdfFixture(2),
    });
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  await expect(page.getByRole('tab', { name: '自动预览.pdf' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .locator('input[type=file]:not([webkitdirectory])')
    .first()
    .setInputFiles({
      name: '自动预览.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxFixture('上传完成后即可阅读论文段落。'),
    });
  await expect(page.locator('.uploaded-paper')).toContainText('上传完成后即可阅读论文段落。');
  await expect(page.getByRole('tab', { name: '自动预览.docx' })).toBeVisible();
});

test('live PDF marks precede typing; manual reading pauses, report opens on click, tabs retain position', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { version, chat } = await setup(page);
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveCount(0);
  version.findings.push(finding(version, 'one'));
  const note = page.locator('.paper-margin-note[data-finding-id="one"] .paper-note-written');
  const mark = page.locator('.paper-ink-mark[data-finding-id="one"]').first();
  await expect(mark).toBeVisible();
  await expect(note).toHaveText('');
  await expect.poll(() => note.textContent()).toMatch(/^请/);
  await page.getByRole('button', { name: '暂停跟随', exact: true }).click();
  const pausedText = await note.textContent();
  version.findings.push(finding(version, 'two', 2));
  await page.waitForTimeout(1300);
  expect(await note.textContent()).toBe(pausedText);
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  await page.getByRole('button', { name: '继续跟随', exact: true }).click();
  await page.getByRole('button', { name: '跳过当前动画', exact: true }).click();
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '2',
  );
  await expect(
    page.locator('.paper-margin-note[data-finding-id="two"] .paper-note-written'),
  ).toContainText('适用范围');
  version.runs[0].status = 'completed';
  chat.run.status = 'completed';
  chat.messages[1].status = 'completed';
  chat.messages[1].result.artifact = {
    id: 'report-file',
    path: '评审报告.md',
    kind: 'file',
    revision: 1,
  };
  await expect(page.getByRole('button', { name: '查看评审报告', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveCount(0);
  await expect(page.locator('.report-viewer:visible')).toHaveCount(0);
  await screenshot(page, 'pdf-desktop');
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.annotation-workspace')).toBeHidden();
  await screenshot(page, 'report-tabs');
  await mkdir('docs/design/preview-tabs-refinement-2026-11-10', { recursive: true });
  const tabStrip = page.getByRole('tablist', { name: '预览文件' });
  await tabStrip.screenshot({ path: 'docs/design/preview-tabs-refinement-2026-11-10/default.png' });
  await page.getByRole('tab', { name: '研究论文.pdf', exact: true }).hover();
  await tabStrip.screenshot({ path: 'docs/design/preview-tabs-refinement-2026-11-10/hover.png' });
  const inactiveTab = page.locator('.preview-browser-tab:not(.active)');
  const inactiveBox = await inactiveTab.boundingBox();
  const hitArea = await inactiveTab.locator('.preview-tab-hitarea').boundingBox();
  await page.mouse.move(hitArea.x + hitArea.width / 2, hitArea.y + hitArea.height / 2);
  expect(await inactiveTab.evaluate((el) => el.matches(':hover'))).toBe(true);
  // Empty strip below the rounded tab must not hover or select that tab.
  await page.mouse.move(
    inactiveBox.x + inactiveBox.width / 2,
    inactiveBox.y + inactiveBox.height - 1,
  );
  expect(await inactiveTab.evaluate((el) => el.matches(':hover'))).toBe(false);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByRole('tab', { name: '评审报告', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '研究论文.pdf', exact: true }).click();
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '2',
  );
  await expect(
    page.locator('.paper-margin-note[data-finding-id="two"] .paper-note-written'),
  ).toContainText('适用范围');
  await page.getByRole('button', { name: '关闭评审报告标签', exact: true }).click();
  await page.getByRole('button', { name: '查看评审报告', exact: true }).click();
  await expect(page.locator('.report-viewer')).toBeVisible();
  await page.getByRole('tab', { name: '评审报告', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '研究论文.pdf', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.paper-ink-mark[data-finding-id="one"]').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileNote = await page.locator('.paper-margin-note[data-finding-id="one"]').boundingBox();
  expect(mobileNote.x).toBeGreaterThanOrEqual(0);
  expect(mobileNote.x + mobileNote.width).toBeLessThanOrEqual(390);
  await screenshot(page, 'pdf-mobile');
  expect(errors).toEqual([]);
});

test('completed animations survive closing; final arrivals queue while paused and reduced motion is immediate', async ({
  page,
}) => {
  const { version, chat } = await setup(page);
  version.findings.push(finding(version, 'persisted'));
  await expect(page.locator('.paper-ink-mark').first()).toBeVisible();
  await page.getByRole('button', { name: '跳过当前动画', exact: true }).click();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(page.getByRole('complementary', { name: '评审预览' })).toHaveCount(0);
  await page.getByRole('button', { name: '查看论文', exact: true }).click();
  await expect(page.locator('.paper-margin-note .paper-note-written')).toContainText('适用范围');
  await expect(page.locator('.paper-ink-mark.is-drawing')).toHaveCount(0);
  await page.getByLabel('论文预览滚动区').dispatchEvent('wheel', { deltaY: 80 });
  await expect(page.getByRole('button', { name: '继续跟随', exact: true })).toBeVisible();
  version.findings.push(finding(version, 'final', 3));
  version.runs[0].status = 'completed';
  chat.messages[1].status = 'completed';
  chat.run.status = 'completed';
  await expect(page.getByRole('button', { name: '查看评审报告', exact: true })).toBeVisible();
  await expect(page.locator('[data-finding-id="final"]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '继续跟随', exact: true }).click();
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '3',
  );
  await expect(
    page.locator('.paper-margin-note[data-finding-id="final"] .paper-note-written'),
  ).toContainText('适用范围');
  await expect(page.locator('.paper-ink-mark.is-drawing')).toHaveCount(0);
});

test('late parse results cannot reopen a preview after navigation', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/studio/files/*/text', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/#new');
  await expect(page.getByLabel('发送消息', { exact: true })).toBeEnabled();
  await page.locator('input[type=file]:not([webkitdirectory])').first().setInputFiles({
    name: '延迟解析.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await expect(page.getByRole('tab', { name: '延迟解析.docx' })).toBeVisible();
  await page.getByLabel('新聊天', { exact: true }).click();
  const parsed = page.waitForResponse((response) => response.url().includes('/text'));
  release();
  await (await parsed).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await expect(page).toHaveURL(/#new$/);
  await expect(page.getByRole('complementary', { name: '内容预览' })).toHaveCount(0);
});

test('Word annotations show every nearby note while preserving all exact text marks', async ({
  page,
}) => {
  const { version } = await setup(page, 'docx');
  const first = finding(version, 'one');
  const second = finding(version, 'two');
  second.anchor = {
    ...second.anchor,
    quote: '推广到全部研究区域',
    offset: second.anchor.quote.indexOf('推广到全部研究区域'),
  };
  version.findings.push(first, second);
  await expect(page.locator('.paper-ink-mark').first()).toBeVisible();
  await page.getByRole('button', { name: '跳过当前动画', exact: true }).click();
  await expect(
    page.locator('.paper-margin-note[data-finding-id="two"] .paper-note-written'),
  ).toContainText('适用范围');
  await expect(page.locator('.paper-margin-note')).toHaveCount(2);
  await expect(page.locator('.paper-ink-mark[data-finding-id="one"]').first()).toBeVisible();
  await screenshot(page, 'docx-desktop');
  // Unmatched source text stays a note without inventing a highlighted location.
  const missing = finding(version, 'missing');
  missing.anchor.quote = '这句话不存在于原文';
  version.findings.push(missing);
  await expect(page.locator('.paper-margin-note[data-finding-id="missing"]')).toContainText(
    '适用范围',
  );
  await expect(page.locator('.paper-ink-mark[data-finding-id="missing"]')).toHaveCount(0);
});

test('all page notes alternate sides and a plain handwritten popover preserves the complete annotation', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { version, chat } = await setup(page);
  chat.messages[0].configuration = { pack: { id: 'test-pack', name: '生态学实证研究评审' } };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '最大化预览', exact: true }).click();
  await expect
    .poll(() => page.locator('.embedded-review').evaluate((el) => el.clientWidth))
    .toBeGreaterThan(1050);
  const scroller = page.getByLabel('论文预览滚动区');
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '1',
  );
  const baseline = await scroller.evaluate((el) => el.scrollHeight);
  const short = '样本仅覆盖部分城市物种，建议收窄结论的适用范围。';
  const explanation = '样本仅覆盖部分城市物种，不能代表全部动物类群。';
  const suggestion =
    '建议把引言中的研究缺口限定为北美城市中记录较充分的陆生动物类群，并在讨论中说明物种记录的地域偏倚与代表性边界。';
  const longSuggestion = suggestion.repeat(25) + '完整建议的最后一句必须保留。';
  for (let i = 0; i < 12; i++)
    version.findings.push({
      ...finding(version, `dense-${i}`),
      title: `E03 · 研究范围与代表性 ${i + 1}`,
      marginNote: short,
      explanation,
      suggestion: i >= 10 ? longSuggestion : suggestion,
    });
  await expect(page.locator('.paper-ink-mark')).toHaveCount(12);
  await expect(page.locator('.paper-margin-note.is-writing')).toHaveCount(0);
  await expect(page.locator('.paper-margin-note')).toHaveCount(12);
  const sides = await page
    .locator('.paper-note-group')
    .evaluateAll((els) => els.map((el) => el.dataset.side));
  expect(sides).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 ? 'right' : 'left')));
  for (const side of ['left', 'right']) {
    const boxes = await page.locator(`.paper-note-group[data-side="${side}"]`).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }),
    );
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom + 11);
  }
  expect(await scroller.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(baseline + 12);
  const output = 'docs/design/handwritten-notes-2026-11-10';
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/all-notes.png` });
  await page.locator('.paper-margin-note[data-finding-id="dense-0"]').click();
  const popup = page.getByRole('note', { name: '论文批注' });
  await expect(popup).toBeVisible();
  await expect(popup).toHaveText(`${explanation}\n\n${suggestion}`);
  await expect(popup.locator('button,h1,h2,h3,h4,nav,blockquote')).toHaveCount(0);
  expect(await popup.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
  await page.screenshot({ path: `${output}/popover.png` });
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await page.locator('.paper-margin-note[data-finding-id="dense-11"]').click();
  await expect(popup).toHaveText(`${explanation}\n\n${longSuggestion}`);
  expect((await popup.boundingBox()).height).toBeLessThanOrEqual(320);
  expect(await popup.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await popup.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.locator('.paper-margin-note[data-finding-id="dense-11"]').click();
  await expect(popup).toBeVisible();
  expect(await popup.evaluate((el) => el.scrollTop)).toBe(0);
  await popup.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.keyboard.press('Escape');
  await page.locator('.paper-margin-note[data-finding-id="dense-10"]').click();
  await expect(popup).toBeVisible();
  expect(await popup.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: '继续跟随', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '恢复预览', exact: true }).click();
  await expect(page.locator('.paper-margin-note')).toHaveCount(12);
  await expect(page.locator('.message-configuration')).toBeVisible();
  expect(
    await page
      .locator('.message-configuration')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  expect(
    await page.locator('.message-configuration').evaluate((el) => getComputedStyle(el).color),
  ).toBe('rgb(36, 76, 130)');
  await page.locator('.message-configurations').screenshot({ path: `${output}/review-tag.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.paper-annotations[data-layout="bottom"]')).toHaveCount(1);
  await expect(page.locator('.paper-margin-note')).toHaveCount(12);
  const card = page.locator('.paper-margin-note').last();
  await card.scrollIntoViewIfNeeded();
  const bounds = await card.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await card.click();
  await expect(popup).toBeVisible();
  await expect
    .poll(async () => {
      const r = await popup.boundingBox();
      return r.x + r.width;
    })
    .toBeLessThanOrEqual(390);
  const floating = await popup.boundingBox();
  expect(floating.x).toBeGreaterThanOrEqual(0);
  expect(floating.x + floating.width).toBeLessThanOrEqual(390);
  expect(floating.y + floating.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  const controls = page.getByRole('group', { name: '阅读控制' });
  await expect(controls).toBeInViewport();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  await expect(page.getByRole('spinbutton', { name: 'PDF 页码' })).toBeInViewport();
  await controls.screenshot({ path: `${output}/page-controls.png` });
  await page.screenshot({ path: `${output}/mobile.png` });
  expect(errors).toEqual([]);
});

test('published PDF displays alternating handwritten notes at real text positions', async ({
  page,
}) => {
  const { version } = await setup(
    page,
    'pdf',
    await readFile('tests/fixtures/published-pdf/beule-2021.pdf'),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '最大化预览', exact: true }).click();
  const parsed = version.parse.pages.find((p) => p.page === 2);
  const items = parsed.items.filter((item) => item.bbox && item.text.length >= 20);
  const notes = [
    [
      '请进一步界定研究对象，并说明结论适用的生态背景。',
      '建议结合研究区域、土壤类型与采样季节，进一步界定结论适用的生态背景，避免将特定条件下的结果直接推广到其他区域。',
    ],
    [
      '建议补充关键概念的定义，便于读者理解比较依据。',
      '建议在首次使用关键概念时给出具体定义，并说明其与本研究比较指标之间的关系，使后续分析的依据更加清楚。',
    ],
    [
      '请说明已有研究与本文的联系，突出具体研究问题。',
      '建议说明引用研究在研究对象和方法上的异同，并明确本文希望回答的具体问题，使文献回顾与研究设计之间建立直接联系。',
    ],
    [
      '建议区分背景判断与本文证据，保留必要的限定条件。',
      '建议将文献中的背景判断与本文数据直接支持的结论区分表述，保留地域、时间和样本范围等必要限定条件。',
    ],
  ];
  notes.forEach(([marginNote, suggestion], i) => {
    const item = items[Math.floor(((i + 1) * items.length) / 6)];
    version.findings.push({
      ...finding(version, `published-${i}`, 2),
      marginNote,
      suggestion,
      explanation: '',
      anchor: {
        elementId: 'page-2',
        section: '第 2 页',
        page: 2,
        quote: item.text,
        offset: item.offset,
      },
    });
  });
  await expect(page.locator('.paper-margin-note')).toHaveCount(4);
  await expect(page.getByLabel('论文 PDF 原文', { exact: true })).toHaveAttribute(
    'data-rendered-page',
    '2',
  );
  await expect(page.locator('.paper-margin-note.is-writing')).toHaveCount(0);
  const output = 'docs/design/handwritten-notes-2026-11-10';
  async function checkArrowTargets() {
    await expect(page.locator('.paper-note-connector-line')).toHaveCount(4);
    await expect
      .poll(async () => {
        const errors = await page.locator('.paper-note-connector-line').evaluateAll((paths) =>
          paths.map((line) => {
            const group = line.parentElement;
            const mark = document.querySelector(
              `.paper-ink-mark[data-finding-id="${group.dataset.findingId}"]`,
            );
            const rect = mark.getBoundingClientRect();
            const point = line.getPointAtLength(line.getTotalLength());
            const end = new DOMPoint(point.x, point.y).matrixTransform(line.getScreenCTM());
            const edge = group.dataset.side === 'left' ? rect.left - 2 : rect.right + 2;
            return Math.max(Math.abs(end.x - edge), Math.abs(end.y - (rect.top + rect.bottom) / 2));
          }),
        );
        return Math.max(...errors);
      })
      .toBeLessThan(2);
  }
  await checkArrowTargets();
  await page.screenshot({ path: `${output}/published-paper.png` });
  await page.locator('.paper-margin-note').first().click();
  await expect(page.getByRole('note', { name: '论文批注' })).toHaveText(notes[0][1]);
  await page.screenshot({ path: `${output}/published-popover.png` });
  await page
    .getByRole('note', { name: '论文批注' })
    .screenshot({ path: `${output}/plain-popover.png` });
  await page.getByRole('tab', { name: '研究论文.pdf', exact: true }).click();
  await expect(page.getByRole('note', { name: '论文批注' })).toBeHidden();
  await page.setViewportSize({ width: 1100, height: 900 });
  await checkArrowTargets();
  await page.screenshot({ path: `${output}/arrows-resized.png` });
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await checkArrowTargets();
});
