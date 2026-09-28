import packageJson from './package.json' with { type: 'json' };
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const excludedRoots = new Set([
  '.env',
  '.git',
  '.github',
  '.npm-cache',
  '.playwright',
  '.superpowers',
  '.worktrees',
  'data',
  'docs',
  'playwright-report',
  'test-results',
  'tests',
  'tmp',
  '验证论文',
]);

function shouldIgnore(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized) return false;
  const root = normalized.split('/')[0];
  if (excludedRoots.has(root)) return true;
  return (
    normalized === '.env.example' ||
    normalized.endsWith('.log') ||
    normalized === 'design-qa.md' ||
    normalized === 'paper-audit-copilot-visual.png'
  );
}

export default {
  packagerConfig: {
    name: 'PaperAuditCopilot',
    executableName: 'PaperAuditCopilot',
    arch: 'x64',
    asar: true,
    ignore: shouldIgnore,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'paper_audit_copilot',
        authors: 'Paper Audit Copilot',
        description: '本地运行的论文评审工作台',
        setupExe: `PaperAuditCopilot-Setup-${packageJson.version}.exe`,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
      },
    },
  ],
  plugins: [new AutoUnpackNativesPlugin({})],
};
