const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

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
  chooseFolder: (opts) => ipcRenderer.invoke('choose-folder', opts),
  writeFileIn: (dir, name, data) => ipcRenderer.invoke('write-file-in', dir, name, data),
  recoveryWrite: (name, data) => ipcRenderer.invoke('recovery-write', name, data),
  recoveryDelete: (name) => ipcRenderer.invoke('recovery-delete', name),
  recoveryList: () => ipcRenderer.invoke('recovery-list'),
  recoveryClear: () => ipcRenderer.invoke('recovery-clear'),
  setMainSetting: (k, v) => ipcRenderer.invoke('set-main-setting', k, v),
  setZoom: (f) => { try { webFrame.setZoomFactor(Number(f) || 1); } catch (e) { /* */ } },
  aiModelRead: (f) => ipcRenderer.invoke('ai-model-read', f),
  aiModelExists: (f) => ipcRenderer.invoke('ai-model-exists', f),
  aiModelDownload: (f, url) => ipcRenderer.invoke('ai-model-download', f, url),
  listDir: (dir) => ipcRenderer.invoke('list-dir', dir),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch (e) { return null; } },
  on: (ch, fn) => {
    const allowed = ['close-request', 'open-path', 'win-state', 'ai-progress'];
    if (!allowed.includes(ch)) return;
    ipcRenderer.on(ch, (_e, ...args) => fn(...args));
  },
});
