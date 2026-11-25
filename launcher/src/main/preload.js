const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result.error) throw new Error(result.error);
  return result.data;
};

const api = {};
for (const name of ['state', 'login', 'cancelLogin', 'logout', 'play', 'savePrefs', 'status', 'logs',
  'openFolder', 'repair', 'ownFiles', 'pickFiles', 'removeOwn', 'openLink', 'installUpdate', 'window']) {
  api[name] = (...args) => call(name, ...args);
}
api.on = (event, callback) => {
  if (['progress', 'game', 'update', 'state'].includes(event)) ipcRenderer.on(event, (_e, data) => callback(data));
};

// Glisser-déposer : seul le preload peut retrouver le chemin d'un fichier.
api.filePath = (file) => webUtils.getPathForFile(file);
api.importFiles = (paths) => call('importFiles', paths);

contextBridge.exposeInMainWorld('api', api);
