import packageJson from './package.json' with { type: 'json' };
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const runtimeRoots = new Set(['desktop', 'dist', 'server', 'shared', 'public', 'node_modules']);

function shouldIgnore(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized) return false;
  const root = normalized.split('/')[0];
  if (normalized === 'package.json' || normalized === 'LICENSE') return false;
  if (normalized === 'scripts' || normalized === 'scripts/account.js') return false;
  return !runtimeRoots.has(root) || normalized.endsWith('.log');
}

export default {
  packagerConfig: {
    name: 'PaperAuditCopilot',
    executableName: 'PaperAuditCopilot',
    arch: 'x64',
    asar: true,
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
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
