// Lumora – Electron Hauptprozess
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, net, safeStorage, Menu } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

// Einstellungen des Hauptprozesses (müssen vor app.ready gelesen werden)
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; } }
const mainSettings = readSettings();
if (mainSettings.hardwareAcceleration === false) app.disableHardwareAcceleration();
const recoveryDir = () => { const d = path.join(app.getPath('userData'), 'recovery'); fs.mkdirSync(d, { recursive: true }); return d; };
const safeName = (n) => String(n).replace(/[^a-zA-Z0-9._-]/g, '_');

// Eigenes Protokoll app:// – ermöglicht Fetch, Web Worker und Multithreading (Cross-Origin-Isolation) für die KI
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.onnx': 'application/octet-stream', '.json': 'application/json', '.svg': 'image/svg+xml' };
function registerAppProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(distDir, rel));
    if (!file.startsWith(distDir)) return new Response('Verboten', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers();
      headers.set('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, headers });
    } catch (e) { return new Response('Nicht gefunden', { status: 404 }); }
  });
}

let win = null;
let allowClose = false;
let pendingOpenPath = process.argv.find((a) => /\.(lumora|sakura|psd|png|jpe?g|webp|gif|bmp)$/i.test(a)) || null;

function workFolder() {
  // Arbeitsordner auf dem Desktop: Desktop\Lumora\Projekte
  const dir = path.join(app.getPath('desktop'), 'Lumora', 'Projekte');
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
    title: 'Lumora',
    icon: path.join(__dirname, '..', 'dist', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  win.loadURL('app://bundle/index.html');
  // Rechtschreibprüfung für Texteingaben (Deutsch + Englisch), Vorschläge per Rechtsklick
  try { win.webContents.session.setSpellCheckerLanguages(['de-DE', 'en-US']); } catch (e) { /* Sprache nicht verfügbar */ }
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return;
    const items = [];
    if (params.misspelledWord) {
      for (const sug of params.dictionarySuggestions.slice(0, 6)) items.push({ label: sug, click: () => win.webContents.replaceMisspelling(sug) });
      if (!params.dictionarySuggestions.length) items.push({ label: 'Keine Vorschläge', enabled: false });
      items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Ausschneiden', role: 'cut' }, { label: 'Kopieren', role: 'copy' }, { label: 'Einfügen', role: 'paste' }, { type: 'separator' }, { label: 'Alles auswählen', role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
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
    const f = argv.find((a) => /\.(lumora|sakura|psd|png|jpe?g|webp|gif|bmp)$/i.test(a));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-path', f);
    }
  });
  app.whenReady().then(() => { registerAppProtocol(); workFolder(); createWindow(); });
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

ipcMain.handle('confirm-close', () => {
  allowClose = true;
  try { for (const f of fs.readdirSync(recoveryDir())) fs.unlinkSync(path.join(recoveryDir(), f)); } catch (e) { /* */ }
  if (win) win.close();
});
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

ipcMain.handle('choose-folder', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { title: opts.title || 'Ordner wählen', defaultPath: opts.defaultPath || workFolder(), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('write-file-in', (_e, dir, name, data) => {
  const p = path.join(dir, path.basename(name));
  fs.writeFileSync(p, Buffer.from(data));
  return p;
});
ipcMain.handle('recovery-write', (_e, name, data) => { fs.writeFileSync(path.join(recoveryDir(), safeName(name)), Buffer.from(data)); return true; });
ipcMain.handle('recovery-delete', (_e, name) => { try { fs.unlinkSync(path.join(recoveryDir(), safeName(name))); } catch (e) { /* nicht vorhanden */ } return true; });
ipcMain.handle('recovery-list', () => {
  try { return fs.readdirSync(recoveryDir()).filter((f) => (f.endsWith('.lumora') || f.endsWith('.sakura'))).map((f) => ({ name: f, data: fs.readFileSync(path.join(recoveryDir(), f)) })); } catch (e) { return []; }
});
ipcMain.handle('recovery-clear', () => { try { for (const f of fs.readdirSync(recoveryDir())) fs.unlinkSync(path.join(recoveryDir(), f)); } catch (e) { /* */ } return true; });
ipcMain.handle('set-main-setting', (_e, key, value) => {
  const cur = readSettings(); cur[key] = value;
  fs.writeFileSync(settingsFile(), JSON.stringify(cur, null, 2));
  return true;
});

// Zusätzliche KI-Modelle im Benutzerordner
const modelsDir = () => { const d = path.join(app.getPath('userData'), 'models'); fs.mkdirSync(d, { recursive: true }); return d; };
ipcMain.handle('ai-model-read', (_e, file) => {
  const p = path.join(modelsDir(), path.basename(file));
  if (fs.existsSync(p)) return fs.readFileSync(p);
  return null;
});
ipcMain.handle('ai-model-exists', (_e, file) => fs.existsSync(path.join(modelsDir(), path.basename(file))) || fs.existsSync(path.join(distDir, 'models', path.basename(file))));
ipcMain.handle('ai-model-download', async (e, file, url) => {
  const dest = path.join(modelsDir(), path.basename(file));
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download fehlgeschlagen (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0, last = 0;
  for await (const chunk of res.body) {
    out.write(Buffer.from(chunk)); got += chunk.length;
    const now = Date.now();
    if (now - last > 250) { last = now; e.sender.send('ai-progress', { file, got, total }); }
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, dest);
  e.sender.send('ai-progress', { file, got, total, done: true });
  return true;
});

// ---- Geheimnisse (API-Schlüssel) verschlüsselt speichern ----
const secretFile = () => path.join(app.getPath('userData'), 'secrets.bin');
function readSecrets() {
  try {
    const raw = fs.readFileSync(secretFile());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(txt);
  } catch (e) { return {}; }
}
function writeSecrets(o) {
  const txt = JSON.stringify(o);
  fs.writeFileSync(secretFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt));
}
ipcMain.handle('secret-has', (_e, k) => !!readSecrets()[k]);
ipcMain.handle('secret-set', (_e, k, v) => { const s = readSecrets(); if (v) s[k] = v; else delete s[k]; writeSecrets(s); return true; });

// ---- Generative Füllung über die OpenAI-Bild-API (eigener Schlüssel des Nutzers) ----
ipcMain.handle('genfill', async (_e, { prompt, image, mask, size }) => {
  const key = readSecrets().openai;
  if (!key) throw new Error('Kein API-Schlüssel hinterlegt');
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  fd.append('prompt', prompt);
  fd.append('size', size || '1024x1024');
  fd.append('n', '1');
  fd.append('image', new Blob([Buffer.from(image)], { type: 'image/png' }), 'image.png');
  fd.append('mask', new Blob([Buffer.from(mask)], { type: 'image/png' }), 'mask.png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new Error('Keine Bilddaten in der Antwort');
  return Buffer.from(b64, 'base64');
});

// ---- Plugins: JavaScript-Dateien im Benutzerordner ----
const pluginsDir = () => { const d = path.join(app.getPath('userData'), 'plugins'); fs.mkdirSync(d, { recursive: true }); return d; };
const SAMPLE_PLUGIN = `// Beispiel-Plugin für Lumora: fügt einen Sepia-Filter und einen Befehl hinzu.
// Plugins liegen in diesem Ordner; nach Änderungen: Hilfe › Plugins neu laden.
lumora.registerFilter({
  id: 'sepia', name: 'Sepia…',
  params: [{ key: 'amount', label: 'Stärke %', min: 0, max: 100, def: 80 }],
  apply(canvas, p) {
    const out = lumora.makeCanvas(canvas.width, canvas.height);
    const x = out.getContext('2d'); x.drawImage(canvas, 0, 0);
    const id = x.getImageData(0, 0, out.width, out.height), d = id.data, k = p.amount / 100;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = r + (Math.min(255, r * .393 + g * .769 + b * .189) - r) * k;
      d[i + 1] = g + (Math.min(255, r * .349 + g * .686 + b * .168) - g) * k;
      d[i + 2] = b + (Math.min(255, r * .272 + g * .534 + b * .131) - b) * k;
    }
    x.putImageData(id, 0, 0);
    return out;
  },
});
lumora.registerCommand({ label: 'Dokumentinfo anzeigen', run() { const d = lumora.document(); lumora.toast(d ? d.name + ': ' + d.w + ' × ' + d.h + ' Px, ' + d.layers.length + ' Ebenen' : 'Kein Dokument'); } });
`;
ipcMain.handle('plugins-list', () => {
  const dir = pluginsDir();
  const marker = path.join(dir, '.beispiel-angelegt');
  if (!fs.existsSync(marker)) { fs.writeFileSync(path.join(dir, 'beispiel-sepia.js'), SAMPLE_PLUGIN); fs.writeFileSync(marker, '1'); }
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') }));
});
ipcMain.handle('plugins-open', () => shell.openPath(pluginsDir()));

ipcMain.handle('list-dir', (_e, dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|gif|bmp|psd|lumora|sakura|tiff?)$/i.test(f)).map((f) => ({ name: f, path: path.join(dir, f) }));
  } catch (e) { return []; }
});

ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-work-folder', () => shell.openPath(workFolder()));
ipcMain.handle('print', () => new Promise((res) => {
  if (!win) return res(false);
  win.webContents.print({ printBackground: true }, (ok) => res(ok));
}));
ipcMain.handle('app-icon', () => nativeImage.createFromPath(path.join(__dirname, '..', 'dist', 'icon.png')).toDataURL());
