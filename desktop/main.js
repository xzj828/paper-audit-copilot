import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { createPaperAuditApplication } from '../server/application.js';
import {
  createWindowOptions,
  isAllowedNavigation,
  isExternalHttps,
  resolveDesktopDataDirectory,
} from './config.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let application;
let mainWindow;
let origin;
let shutdownPromise;
let exiting = false;

if (squirrelStartup) app.quit();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createMainWindow() {
  mainWindow = new BrowserWindow(createWindowOptions());
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedNavigation(target, origin)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttps(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  await mainWindow.loadURL(origin);
}

async function startDesktop() {
  const dataDirectory = resolveDesktopDataDirectory(app.getPath('userData'));
  application = createPaperAuditApplication({ dataDirectory, rootDirectory });
  const address = await application.start({ host: '127.0.0.1', port: 0, desktop: true });
  origin = address.origin;
  Menu.setApplicationMenu(null);
  await createMainWindow();
}

async function closeApplication() {
  if (!shutdownPromise) shutdownPromise = application ? application.close() : Promise.resolve();
  return shutdownPromise;
}

if (hasSingleInstanceLock && !squirrelStartup) {
  app.on('second-instance', focusMainWindow);
  app
    .whenReady()
    .then(startDesktop)
    .catch(async (error) => {
      dialog.showErrorBox('论文评审助手启动失败', error?.message || String(error));
      await closeApplication().catch(() => {});
      app.exit(1);
    });

  app.on('activate', () => {
    if (mainWindow) focusMainWindow();
    else if (origin) void createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    exiting = true;
    void closeApplication().finally(() => app.exit(0));
  });
}
