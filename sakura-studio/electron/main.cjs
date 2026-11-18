// Sakura Studio – Electron Hauptprozess
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let allowClose = false;
let pendingOpenPath = process.argv.find((a) => /\.(sakura|psd|png|jpe?g|webp|gif|bmp)$/i.test(a)) || null;

function workFolder() {
  // Arbeitsordner auf dem Desktop: Desktop\Sakura Studio\Projekte
  const dir = path.join(app.getPath('desktop'), 'Sakura Studio', 'Projekte');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  return dir;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    backgroundColor: '#1b1730',
    title: 'Sakura Studio',
    icon: path.join(__dirname, '..', 'dist', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('maximize', () => win.webContents.send('win-state', true));
  win.on('unmaximize', () => win.webContents.send('win-state', false));
  win.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('close-request');
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find((a) => /\.(sakura|psd|png|jpe?g|webp|gif|bmp)$/i.test(a));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-path', f);
    }
  });
  app.whenReady().then(() => { workFolder(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('win', (_e, cmd) => {
  if (!win) return;
  if (cmd === 'min') win.minimize();
  else if (cmd === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (cmd === 'close') win.close();
  else if (cmd === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (cmd === 'devtools') win.webContents.toggleDevTools();
  return win.isMaximized();
});

ipcMain.handle('confirm-close', () => { allowClose = true; if (win) win.close(); });
ipcMain.handle('work-folder', () => workFolder());
ipcMain.handle('pending-open', () => { const p = pendingOpenPath; pendingOpenPath = null; return p; });

ipcMain.handle('open-dialog', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'Öffnen',
    defaultPath: opts.defaultPath || workFolder(),
    filters: opts.filters,
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
  });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ path: p, name: path.basename(p), data: fs.readFileSync(p) }));
});

ipcMain.handle('read-file', (_e, p) => {
  try { return { path: p, name: path.basename(p), data: fs.readFileSync(p) }; } catch (e) { return null; }
});

ipcMain.handle('save-dialog', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, {
    title: opts.title || 'Speichern unter',
    defaultPath: path.join(opts.dir || workFolder(), opts.name || 'Unbenannt'),
    filters: opts.filters,
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
});

ipcMain.handle('write-file', (_e, p, data) => {
  fs.writeFileSync(p, Buffer.from(data));
  return true;
});

ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-work-folder', () => shell.openPath(workFolder()));
ipcMain.handle('print', () => new Promise((res) => {
  if (!win) return res(false);
  win.webContents.print({ printBackground: true }, (ok) => res(ok));
}));
ipcMain.handle('app-icon', () => nativeImage.createFromPath(path.join(__dirname, '..', 'dist', 'icon.png')).toDataURL());
