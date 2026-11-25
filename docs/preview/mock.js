// Faux "launcher" pour l'aperçu en direct sur le site admin.
(() => {
  let current;
  let ready;
  let listener;
  const first = new Promise((resolve) => { ready = resolve; });
  const prefs = { ram: 0, choices: {}, fullscreen: false, hideOnPlay: true };

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'preview') return;
    current = {
      ...event.data.state, online: true, version: '1.0.0', update: { state: 'idle' }, updateRequired: false,
      totalRam: 16384, prefs, gameRunning: false,
    };
    const message = document.getElementById('message');
    if (!current.settings.maintenance.enabled) message.hidden = true;
    ready();
    listener?.(current);
  });

  const nothing = async () => {};
  window.api = {
    state: async () => { await first; return current; },
    status: async () => ({ online: true, players: 12, max: 100 }),
    savePrefs: async (patch) => Object.assign(prefs, patch),
    login: async () => ({ id: '8667ba71b85a4004af54457a9734eed7', name: 'Steve' }),
    logs: async () => 'Aperçu : pas de logs.',
    cancelLogin: nothing, logout: nothing, play: nothing, openFolder: nothing, repair: nothing,
    openLink: nothing, installUpdate: nothing, window: nothing,
    ownFiles: async () => [],
    pickFiles: async () => ({ added: [], refused: [] }),
    importFiles: async () => ({ added: [], refused: [] }),
    filePath: () => '',
    removeOwn: nothing,
    on: (name, callback) => { if (name === 'state') listener = callback; },
  };
  window.parent.postMessage({ type: 'preview-ready' }, location.origin);
})();
