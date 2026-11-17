const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopSetup', {
  state: () => ipcRenderer.invoke('desktop-setup:state'),
  create: (details) => ipcRenderer.invoke('desktop-setup:create', details),
});
