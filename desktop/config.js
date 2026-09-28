import path from 'node:path';

export function resolveDesktopDataDirectory(userDataPath) {
  if (typeof userDataPath !== 'string' || !userDataPath.trim()) {
    throw new TypeError('Electron user data path is required');
  }
  return path.join(userDataPath, 'data');
}

export function createWindowOptions() {
  return {
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f1ea',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
    },
  };
}

export function isAllowedNavigation(target, origin) {
  try {
    return new URL(target).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function isExternalHttps(target) {
  try {
    return new URL(target).protocol === 'https:';
  } catch {
    return false;
  }
}
