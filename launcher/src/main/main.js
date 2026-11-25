const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { loadRemote } = require('./remote');
const { syncFiles } = require('./sync');
const { enableResourcePacks, setFullscreen } = require('./options');
const minecraft = require('./minecraft');
const { registerOfficialProfile, assertOfficialLauncherClosed, openOfficialLauncher } = require('./officialLauncher');
const { ping } = require('./ping');
const userFiles = require('./userfiles');
const { readJson, writeJson, compareVersions } = require('./util');

// Dossier fixe : les données des joueurs restent même si le launcher change de nom.
app.setPath('userData', path.join(app.getPath('appData'), 'ServeurLauncher'));
const dataDir = app.getPath('userData');
const gameDir = path.join(dataDir, 'game');
const prefsFile = path.join(dataDir, 'prefs.json');

let win;
let remote;
let busy = false;
let update = { state: 'idle' };
const logs = [];

const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);

function log(line) {
  logs.push(line);
  if (logs.length > 600) logs.shift();
}

const getPrefs = async () => ({ ram: 0, choices: {}, fullscreen: false, hideOnPlay: true, ...await readJson(prefsFile, {}) });

function updateRequired() {
  const min = remote?.settings.update.minVersion;
  return Boolean(app.isPackaged && min && compareVersions(app.getVersion(), min) < 0);
}

async function refresh() {
  remote = await loadRemote(dataDir);
  const state = {
    ...remote,
    version: app.getVersion(),
    update,
    updateRequired: updateRequired(),
    totalRam: Math.floor(os.totalmem() / 1048576),
    prefs: await getPrefs(),
  };
  win?.setTitle(remote.settings.general.name);
  return state;
}

function setUpdate(next) {
  update = next;
  send('update', { ...update, required: updateRequired() });
  // Mise à jour obligatoire : on installe dès que c'est prêt.
  if (next.state === 'ready' && updateRequired() && !busy) {
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 2500);
  }
}

const importOptions = () => ({ gameDir, serverFiles: remote?.files || [], strict: remote?.settings.modsPolicy.strict ?? true });

function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ ...update, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => { log(`Mise à jour : ${e.message}`); setUpdate({ state: 'error' }); });
  const check = () => update.state !== 'downloading' && update.state !== 'ready' && autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 15 * 60 * 1000);
}

async function play() {
  if (busy) return;
  busy = true;
  const report = (label, ratio) => send('progress', { label, ratio });
  try {
    report('Préparation', null);
    const state = await refresh();
    send('state', state);
    const s = remote.settings;
    if (s.maintenance.enabled) throw new Error(s.maintenance.message);
    if (updateRequired()) {
      autoUpdater.checkForUpdates().catch(() => {});
      throw new Error('Une mise à jour obligatoire du launcher est en cours.');
    }
    // Sans liste fiable, ne rien synchroniser (sinon on effacerait les mods).
    if (!remote.online && !remote.cached) throw new Error('Impossible de joindre le serveur de configuration. Vérifie ta connexion.');

    await assertOfficialLauncherClosed();
    const prefs = await getPrefs();

    const prepared = await minecraft.prepare({ root: gameDir, version: s.minecraft.version, loader: s.minecraft.loader, report });
    const installed = await syncFiles({
      gameDir, files: remote.files, choices: prefs.choices, strict: s.modsPolicy.strict,
      onProgress: (done, total, name) => report(`Synchronisation : ${name}`, done / total),
    });
    await enableResourcePacks(gameDir, installed, prepared.versionJar);
    await setFullscreen(gameDir, prefs.fullscreen);

    const maxRam = Math.max(1024, prefs.ram || s.minecraft.defaultRam);
    const minRam = Math.min(s.minecraft.minRam, maxRam);
    const javaArgs = [
      `-Xms${minRam}M`,
      `-Xmx${maxRam}M`,
      ...String(s.minecraft.jvmArgs || '').split(/\s+/).filter(Boolean),
    ].join(' ');
    await registerOfficialProfile({
      launcherDir: path.join(app.getPath('appData'), '.minecraft'),
      gameDir,
      versionId: prepared.id,
      name: `${s.general.name} - Fabric ${s.minecraft.version}`,
      javaArgs,
    });
    report('Ouverture du launcher Minecraft officiel', null);
    await openOfficialLauncher();
    if (prefs.hideOnPlay) win?.hide();
  } finally {
    busy = false;
    send('progress', null);
  }
}

/** Renvoie les erreurs au format { error } pour un message propre côté interface. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.senderFrame !== win?.webContents.mainFrame) return { error: 'Refusé' };
    try { return { data: await fn(...args) }; } catch (error) {
      log(error.stack || String(error));
      return { error: error.message || String(error) };
    }
  });
}

function registerIpc() {
  handle('state', refresh);
  handle('play', play);
  handle('savePrefs', async (patch) => {
    const prefs = await getPrefs();
    for (const key of ['ram', 'choices', 'fullscreen', 'hideOnPlay']) {
      if (patch && key in patch) prefs[key] = patch[key];
    }
    await writeJson(prefsFile, prefs);
    return prefs;
  });
  handle('status', () => {
    const { ip, port } = remote?.settings.server || {};
    return ip ? ping(ip, Number(port) || 25565) : null;
  });
  handle('logs', () => logs.join('\n'));
  handle('openFolder', async () => { await fs.mkdir(gameDir, { recursive: true }); await shell.openPath(gameDir); });
  handle('repair', async () => {
    if (busy) throw new Error('Attends la fin de la préparation avant de réparer.');
    await fs.rm(path.join(gameDir, 'installed.json'), { force: true });
  });
  handle('ownFiles', () => userFiles.listOwn(importOptions()));
  handle('pickFiles', async () => {
    const { filePaths } = await dialog.showOpenDialog(win, {
      title: 'Ajouter des fichiers', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Packs, shaders et mods', extensions: ['zip', 'jar'] }],
    });
    return userFiles.importFiles(filePaths, importOptions());
  });
  handle('importFiles', (paths) => {
    if (!Array.isArray(paths)) throw new Error('Fichiers invalides.');
    return userFiles.importFiles(paths.filter((p) => typeof p === 'string' && p), importOptions());
  });
  handle('removeOwn', (category, name) => userFiles.removeOwn(category, name, importOptions()));
  handle('openLink', (url) => { if (/^https:\/\//i.test(url)) return shell.openExternal(url); });
  handle('installUpdate', () => { if (update.state === 'ready' && !busy) autoUpdater.quitAndInstall(true, true); });
  handle('window', (action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 680, minWidth: 900, minHeight: 580,
    frame: false, show: false, backgroundColor: '#0e1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    setupUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}
