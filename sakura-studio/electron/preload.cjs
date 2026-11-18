const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isElectron: true,
  win: (cmd) => ipcRenderer.invoke('win', cmd),
  confirmClose: () => ipcRenderer.invoke('confirm-close'),
  workFolder: () => ipcRenderer.invoke('work-folder'),
  openWorkFolder: () => ipcRenderer.invoke('open-work-folder'),
  pendingOpen: () => ipcRenderer.invoke('pending-open'),
  openDialog: (opts) => ipcRenderer.invoke('open-dialog', opts),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  print: () => ipcRenderer.invoke('print'),
  on: (ch, fn) => {
    const allowed = ['close-request', 'open-path', 'win-state'];
    if (!allowed.includes(ch)) return;
    ipcRenderer.on(ch, (_e, ...args) => fn(...args));
  },
});
