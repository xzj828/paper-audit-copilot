import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { updateElectronApp } from 'update-electron-app';
import { createPaperAuditApplication } from '../server/application.js';
import { createDesktopOnboarding } from './onboarding.js';
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
let booting = true;
let setupWindow;

// An explicit profile is useful for a separate workstation or a disposable smoke test.
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir');
if (profileDirectory) app.setPath('userData', path.resolve(profileDirectory));

if (squirrelStartup) app.quit();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function focusMainWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.show();
    setupWindow.focus();
    return;
  }
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

async function setupAccount(dataDirectory) {
  const onboarding = createDesktopOnboarding(dataDirectory);
  try {
    if (!onboarding.state().required) return undefined;
    setupWindow = new BrowserWindow({
      width: 600, height: 800, minWidth: 520, minHeight: 740,
      show: false, autoHideMenuBar: true, backgroundColor: '#f6f5f2',
      webPreferences: {
        preload: path.join(rootDirectory, 'desktop', 'setup-preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    setupWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const trusted = (event) => setupWindow && event.sender === setupWindow.webContents &&
      event.senderFrame === setupWindow.webContents.mainFrame;
    const completed = new Promise((resolve) => {
      setupWindow.once('closed', () => resolve(null));
      ipcMain.handle('desktop-setup:state', (event) => {
        if (!trusted(event)) throw new Error('不允许的请求');
        return onboarding.state();
      });
      ipcMain.handle('desktop-setup:create', async (event, details) => {
        if (!trusted(event)) return { ok: false, error: '不允许的请求' };
        try {
          const user = await onboarding.create(details);
          resolve({ username: user.username, password: details.password });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
    });
    setupWindow.once('ready-to-show', () => setupWindow?.show());
    await setupWindow.loadFile(path.join(rootDirectory, 'desktop', 'setup.html'));
    return await completed;
  } finally {
    ipcMain.removeHandler('desktop-setup:state');
    ipcMain.removeHandler('desktop-setup:create');
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    setupWindow = undefined;
    onboarding.close();
  }
}

async function startDesktop() {
  const dataDirectory = resolveDesktopDataDirectory(app.getPath('userData'));
  Menu.setApplicationMenu(null);
  let credentials = await setupAccount(dataDirectory);
  if (credentials === null) { app.quit(); return; }
  application = createPaperAuditApplication({ dataDirectory, rootDirectory });
  const address = await application.start({ host: '127.0.0.1', port: 0, desktop: true });
  origin = address.origin;
  if (credentials) {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ ...credentials, remember: true }),
    });
    credentials = undefined;
    if (response.ok) {
      const cookie = response.headers.get('set-cookie')?.match(/audit_session=([a-f0-9]{64})/);
      if (cookie) await session.defaultSession.cookies.set({
        url: origin, name: 'audit_session', value: cookie[1],
        httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 30 * 86400,
      });
    }
  }
  await createMainWindow();
  booting = false;
}

async function closeApplication() {
  if (!shutdownPromise) shutdownPromise = application ? application.close() : Promise.resolve();
  return shutdownPromise;
}

if (hasSingleInstanceLock && !squirrelStartup) {
  updateElectronApp();
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

  app.on('window-all-closed', () => { if (!booting) app.quit(); });
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    exiting = true;
    void closeApplication().finally(() => app.exit(0));
  });
}
