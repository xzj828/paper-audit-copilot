import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { chromium } from 'playwright';

export const defaultTemplate = {
  id: 'review-report@1',
  name: '完整评审报告',
  title: '论文评审报告',
  introduction: '',
  sections: ['conclusion', 'coverage', 'findings', 'results', 'literature', 'provenance'],
};
const labels = {
  conclusion: '总体意见',
  coverage: '覆盖范围与限制',
  findings: '问题与修改建议',
  results: '分项判断',
  literature: '外部文献比较',
  provenance: '溯源信息',
};
const assessment = (v) =>
  ({
    supported: '有证据支持',
    issue: '发现问题',
    unable_to_assess: '待核验',
    not_checked: '未检查',
  })[v] || v;
const recommendation = (v) =>
  ({ accept: '录用', minor_revision: '小修', major_revision: '大修', reject: '拒稿' })[v] ||
  '暂无法判定';
const evidence = (e) =>
  `${e.kind === 'visual' ? '视觉观察（非逐字引文）' : '原文'} [${e.elementId}] ${e.section || ''}${e.bbox ? ' 区域 ' + e.bbox.join(', ') : ''}：${e.quote}`;

export function reportBlocks(report, projectTitle) {
  const template = report.templateSnapshot || defaultTemplate;
  const blocks = [
    { heading: 1, text: template.title },
    { text: report.projectTitle || projectTitle },
    {
      text: report.demo
        ? '演示报告，不能用于投稿决策。'
        : report.trial
          ? '试运行评审，未经专家校准。'
          : '解析报告，尚未进行科学评审。',
    },
  ];
  if (template.introduction) blocks.push({ text: template.introduction });
  for (const section of template.sections) {
    blocks.push({ heading: 2, text: labels[section] });
    const add = (text) => {
      if (text) blocks.push({ text: String(text) });
    };
    if (section === 'conclusion') {
      add(`系统暂定建议：${recommendation(report.recommendation)}`);
      add(report.conclusion);
    }
    if (section === 'coverage') {
      add(report.coverage);
      if (report.usage)
        add(
          `调用 ${report.usage.requests} 次，失败 ${report.usage.failedRequests} 次；图片输入 ${report.usage.imageInputs} 张次。提供用量记录 ${report.usage.reportedRequests} 次；输入 ${report.usage.promptTokens} token，输出 ${report.usage.completionTokens} token，缓存命中 ${report.usage.cachedTokens} token。`,
        );
      if (report.score)
        add(
          `已评得分 ${report.score.earned}/${report.score.assessedMaximum}；加权覆盖率：${(report.score.coverage * 100).toFixed(1)}%；完整总分 ${report.score.total ?? '未形成'}`,
        );
      report.warnings?.forEach(add);
      for (const page of report.visual?.pages || []) {
        add(`第 ${page.page} 页：${page.readable ? '已阅读' : '待核验'}。${page.observation}`);
        page.uncertainties?.forEach((note) => add(`待核验：${note}`));
      }
      for (const batch of report.visual?.batches || [])
        if (batch.status !== 'completed')
          add(`第 ${batch.pages.join('、')} 页：${batch.error || '未完成视觉检查'}`);
      for (const detail of report.visual?.details || [])
        add(
          `局部核查 ${detail.id}：${detail.observation} ${(detail.uncertainties || []).join('；')}`,
        );
    }
    if (section === 'findings') {
      if (!report.findings.length) add('当前没有通过复核的问题，不代表论文无缺陷。');
      for (const finding of report.findings) {
        blocks.push({ heading: 3, text: finding.title });
        add(finding.explanation);
        if (finding.claimPointer) add(`被评主张：${finding.claimPointer}`);
        if (finding.severityRationale)
          add(
            `严重性依据：${finding.severityRationale}；是否阻碍当前结论：${finding.blocking ? '是' : '否'}`,
          );
        add(`建议：${finding.suggestion}`);
        if (finding.resolutionTest) add(`复查条件：${finding.resolutionTest}`);
        if (finding.repairability)
          add(
            `修复路径：${{ clarification: '补充说明或收缩结论', reanalysis: '重新分析现有数据', new_data: '补充观测或重新采样', unknown: '待核实' }[finding.repairability] || '待核实'}`,
          );
        (finding.evidence || [finding.anchor]).forEach((e) => add(evidence(e)));
      }
    }
    if (section === 'results')
      if (!report.results?.length) add('本快照没有保存分项结果，不补造判断或分数。');
    if (section === 'results')
      for (const result of report.results || []) {
        blocks.push({ heading: 3, text: `${result.checkId} ${result.name || ''}` });
        add(`${assessment(result.assessment)}；等级 ${result.level ?? '未评分'}`);
        add(result.observation);
        add(result.suggestion);
        result.evidence?.forEach((e) => add(evidence(e)));
        add(result.verification?.reason);
        for (const issue of result.issues || []) {
          const status =
            issue.kind === 'material_request'
              ? '材料请求，不计分'
              : issue.duplicateOf
                ? `与 ${issue.duplicateOf} 重复，不重复计分`
                : issue.verification?.reasoning === 'passed'
                  ? '已复核独立问题'
                  : '待核验，不计分';
          blocks.push({ heading: 3, text: `${issue.id} ${issue.title} · ${status}` });
          add(issue.observation);
          add(`建议：${issue.suggestion}`);
          add(`复查条件：${issue.resolutionTest}`);
          add(issue.verification?.reason);
          issue.evidence?.forEach((e) => add(evidence(e)));
        }
      }
    if (section === 'literature') {
      add(
        report.literature
          ? `${report.literature.searchedAt}，查询：${report.literature.query}。${report.literature.limits}`
          : '未提供检索快照。',
      );
      for (const result of report.results || [])
        for (const c of result.comparisons || []) {
          add(
            `本文主张：${c.claim}\n最接近研究：${c.title} (${c.doi})\n已有工作：${c.priorWork}\n本文增量：${c.increment}\n本文证据：${c.evidence}\n摘要引文：${c.quote}\n剩余疑问：${c.remainingQuestion}\n访问级别：摘要；${c.url}`,
          );
        }
    }
    if (section === 'provenance')
      add(
        `报告 ${report.id}\n任务 ${report.runId}\n版本 ${report.versionId}\n解析 ${report.parseId || '未提供'}\n方案 ${report.scheme}\n规则指纹 ${report.packHash || '未提供'}\n模型 ${report.model?.model || '无'}\n模板 ${template.id}\n生成时间 ${report.createdAt}`,
      );
  }
  return blocks;
}
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function reportHtml(report, title) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>论文评审报告</title><style>@page{size:A4;margin:18mm}body{font:11pt/1.65 "Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#20332b}h1{font-size:24pt}h2{font-size:16pt;border-bottom:1px solid #bacdc1;padding-bottom:6px}h3{font-size:12pt}h1,h2,h3{break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}footer{font-size:9pt;color:#68776d}</style><body>${reportBlocks(
    report,
    title,
  )
    .map(
      (b) =>
        `<${b.heading ? 'h' + b.heading : 'p'}>${escape(b.text)}</${b.heading ? 'h' + b.heading : 'p'}>`,
    )
    .join('')}</body></html>`;
}
let activeExports = 0;
export async function exportReport(report, title, format) {
  if (format === 'md')
    return Buffer.from(
      reportBlocks(report, title)
        .map((b) => `${b.heading ? '#'.repeat(b.heading) + ' ' : ''}${b.text}`)
        .join('\n\n'),
      'utf8',
    );
  if (format === 'docx')
    return Packer.toBuffer(
      new Document({
        sections: [
          {
            children: reportBlocks(report, title).map(
              (b) =>
                new Paragraph({
                  text: b.text,
                  ...(b.heading
                    ? {
                        heading: [
                          null,
                          HeadingLevel.HEADING_1,
                          HeadingLevel.HEADING_2,
                          HeadingLevel.HEADING_3,
                        ][b.heading],
                      }
                    : {}),
                  spacing: { after: 160 },
                }),
            ),
          },
        ],
        styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
      }),
    );
  if (format !== 'pdf') throw Object.assign(new Error('不支持的报告格式'), { status: 400 });
  if (activeExports >= 2)
    throw Object.assign(new Error('正在导出其他报告，请稍后再试'), { status: 409 });
  activeExports++;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.platform === 'win32'
        ? {
            executablePath:
              process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
          }
        : {}),
    });
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(reportHtml(report, title), { timeout: 15000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:9px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    });
  } catch {
    throw Object.assign(new Error('PDF导出失败，请确认服务端已安装Chrome或Playwright Chromium'), {
      status: 502,
    });
  } finally {
    await browser?.close();
    activeExports--;
  }
}
