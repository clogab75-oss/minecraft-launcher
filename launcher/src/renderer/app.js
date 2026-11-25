// Interface du launcher. Tout le contenu distant est inséré en texte (jamais en HTML).
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const https = (url) => (/^https:\/\//i.test(url || '') ? url : '');

let state;
let working = false;
let loggingIn = false;
let notice = ''; // message automatique (hors ligne, maintenance)

function applyTheme(s) {
  const t = s.theme;
  const root = document.documentElement.style;
  const colors = { '--bg': t.bg, '--surface': t.surface, '--text': t.text, '--muted': t.muted, '--accent': t.accent, '--accent-text': t.accentText };
  for (const [k, v] of Object.entries(colors)) root.setProperty(k, v);
  root.setProperty('--surface-alpha', `${Math.round(t.surfaceOpacity * 100)}%`);
  root.setProperty('--overlay', t.bgImage ? t.bgOverlay : 0);
  root.setProperty('--radius', `${Number(t.radius) || 0}px`);
  root.setProperty('--logo-size', `${Number(t.logoSize) || 72}px`);
  $('background').style.backgroundImage = https(t.bgImage) ? `url(${JSON.stringify(t.bgImage)})` : '';

  // Police Google Fonts facultative
  const font = String(t.font || '').replace(/[^\w -]/g, '').trim();
  let link = $('google-font');
  if (font) {
    if (!link) { link = el('link', { id: 'google-font', rel: 'stylesheet' }); document.head.prepend(link); }
    const href = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, '+')}&display=swap`;
    if (link.href !== href) link.href = href;
    root.setProperty('--font', `"${font}", "Segoe UI", sans-serif`);
  } else {
    link?.remove();
    root.removeProperty('--font');
  }
  document.body.className = `sidebar-${t.sidebar} play-${t.playAlign}`;
  $('custom-css').textContent = t.customCss || '';
}

function renderHome() {
  const { settings: s, news, account, maintenance } = { ...state, maintenance: state.settings.maintenance };
  $('news').hidden = !s.features.news || news.length === 0;
  $('news-list').replaceChildren(...news.map((n) => el('article', { className: 'news-item' },
    ...(https(n.image_url) ? [el('img', { src: n.image_url, alt: '' })] : []),
    el('strong', { textContent: n.title }),
    el('small', { textContent: new Date(n.created_at).toLocaleDateString('fr-FR') }),
    el('p', { textContent: n.body }),
  )));
  $('login').hidden = Boolean(account);
  $('login').disabled = loggingIn;
  $('cancel-login').hidden = !loggingIn;
  $('login-hint').hidden = Boolean(account);
  $('play').hidden = !account;
  $('play').disabled = working || state.gameRunning || maintenance.enabled || state.updateRequired;
  $('play').textContent = state.gameRunning ? s.texts.running : working ? s.texts.preparing : s.texts.play;
  const next = maintenance.enabled ? maintenance.message
    : state.online ? '' : 'Hors ligne : impossible de récupérer les dernières informations.';
  if (next) showMessage(next);
  else if (notice && $('message').textContent === notice) showMessage('');
  notice = next;
}

function renderAccount() {
  const { account, settings: s } = state;
  $('player').textContent = account?.name || '';
  $('logout').hidden = !account || state.gameRunning || working;
  const avatar = $('avatar');
  avatar.hidden = !account || !s.features.avatar;
  if (!avatar.hidden) avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(account.id)}/64`;
}

function renderMods() {
  const labels = { mod: 'Mod', resourcepack: 'Resource pack', shaderpack: 'Shader' };
  const files = state.files.filter((f) => labels[f.category]);
  $('mod-list').replaceChildren(...files.map((f) => {
    const box = el('input', { type: 'checkbox', checked: !f.optional || (state.prefs.choices[f.id] ?? f.default_on), disabled: !f.optional });
    box.setAttribute('aria-label', f.name);
    box.addEventListener('change', async () => {
      state.prefs = await window.api.savePrefs({ choices: { ...state.prefs.choices, [f.id]: box.checked } });
    });
    return el('label', { className: 'mod' },
      ...(https(f.icon_url) ? [el('img', { src: f.icon_url, alt: '' })] : []),
      el('div', {}, el('strong', { textContent: f.name }),
        el('small', { textContent: `${labels[f.category]} · ${f.optional ? 'optionnel' : 'obligatoire'}${f.description ? ' · ' + f.description : ''}` })),
      box);
  }));
  if (!files.length) $('mod-list').append(el('p', { textContent: 'Aucun contenu pour le moment.' }));
}

async function renderOwn() {
  const labels = { mod: 'Mod', resourcepack: 'Resource pack', shaderpack: 'Shader' };
  const files = await window.api.ownFiles();
  $('own-list').replaceChildren(...files.map((f) => {
    const remove = el('button', { className: 'secondary', textContent: 'Retirer' });
    remove.addEventListener('click', async () => {
      try { await window.api.removeOwn(f.category, f.name); } catch (error) { $('own-message').textContent = error.message; }
      renderOwn();
    });
    return el('div', { className: 'mod' }, el('div', {}, el('strong', { textContent: f.name }), el('small', { textContent: labels[f.category] })), remove);
  }));
}

async function addOwn(action) {
  try {
    const { added, refused } = await action();
    const lines = refused.slice();
    if (added.length) lines.unshift(`${added.length} fichier(s) ajouté(s). Active tes packs et shaders dans les options du jeu.`);
    $('own-message').textContent = lines.join('\n');
  } catch (error) { $('own-message').textContent = error.message; }
  renderOwn();
}

function renderSettings() {
  const { prefs, settings: s, totalRam } = state;
  const ram = $('ram');
  ram.min = 1024;
  ram.max = Math.max(2048, Math.floor((totalRam - 1024) / 512) * 512);
  ram.value = prefs.ram || s.minecraft.defaultRam;
  $('ram-value').textContent = `${(ram.value / 1024).toLocaleString('fr-FR')} Go`;
  $('fullscreen').checked = prefs.fullscreen;
  $('hideOnPlay').checked = prefs.hideOnPlay;
}

function renderUpdate(update, required) {
  const text = {
    downloading: `Mise à jour ${update.version || ''} en téléchargement… ${update.percent || 0} %`,
    ready: `Mise à jour ${update.version || ''} prête.`,
    error: required ? 'Mise à jour obligatoire impossible : télécharge la dernière version du launcher.' : '',
  }[update.state] || (required ? 'Mise à jour obligatoire du launcher…' : '');
  $('banner').hidden = !text;
  $('banner-text').textContent = text;
  $('banner-button').hidden = update.state !== 'ready';
}

function render(next) {
  state = next;
  const s = state.settings;
  applyTheme(s);
  document.title = s.general.name;
  $('title-name').textContent = s.general.name;
  $('title-version').textContent = `v${state.version}`;
  $('name').textContent = s.general.name;
  $('subtitle').textContent = s.general.subtitle;
  $('logo').hidden = !https(s.theme.logoUrl);
  if (!$('logo').hidden) $('logo').src = s.theme.logoUrl;
  for (const node of document.querySelectorAll('[data-text]')) node.textContent = s.texts[node.dataset.text] ?? '';
  const modsTab = document.querySelector('[data-page="mods"]');
  modsTab.hidden = !s.features.mods;
  if (modsTab.hidden && modsTab.classList.contains('active')) showPage('home');
  $('links').replaceChildren(...(s.links || []).filter((l) => https(l.url)).map((l) => {
    const button = el('button', { className: 'chip', textContent: l.label });
    button.addEventListener('click', () => window.api.openLink(l.url));
    return button;
  }));
  renderHome();
  renderAccount();
  renderMods();
  renderOwn().catch(() => {});
  renderSettings();
  renderUpdate(state.update, state.updateRequired);
}

function showMessage(text) {
  $('message').textContent = text || '';
  $('message').hidden = !text;
}

function showPage(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.page === name);
  for (const page of document.querySelectorAll('.page')) page.classList.toggle('active', page.id === `page-${name}`);
}

async function updateStatus() {
  if (!state?.settings.features.status || !state.settings.server.ip) { $('status').hidden = true; return; }
  const result = await window.api.status().catch(() => null);
  if (!result) return;
  $('status').hidden = false;
  $('status').classList.toggle('up', result.online);
  $('status').querySelector('span').textContent = result.online
    ? `${result.players}/${result.max} ${state.settings.texts.online}` : state.settings.texts.offline;
}

async function reload() {
  if (working || loggingIn) return;
  render(await window.api.state());
  updateStatus();
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showPage(tab.dataset.page));
for (const button of document.querySelectorAll('[data-window]')) button.addEventListener('click', () => window.api.window(button.dataset.window));

$('login').addEventListener('click', async () => {
  showMessage('');
  loggingIn = true;
  renderHome();
  try {
    state.account = await window.api.login();
  } catch (error) {
    showMessage(error.message);
  }
  loggingIn = false;
  renderHome();
  renderAccount();
});
$('cancel-login').addEventListener('click', () => window.api.cancelLogin());
$('logout').addEventListener('click', async () => {
  await window.api.logout();
  state.account = null;
  renderHome();
  renderAccount();
});
$('play').addEventListener('click', async () => {
  showMessage('');
  working = true;
  renderHome();
  renderAccount();
  let failure;
  try { await window.api.play(); } catch (error) { failure = error.message; }
  working = false;
  state = await window.api.state();
  render(state);
  if (failure) showMessage(failure);
});

$('ram').addEventListener('input', () => { $('ram-value').textContent = `${($('ram').value / 1024).toLocaleString('fr-FR')} Go`; });
$('ram').addEventListener('change', async () => { state.prefs = await window.api.savePrefs({ ram: Number($('ram').value) }); });
for (const key of ['fullscreen', 'hideOnPlay']) {
  $(key).addEventListener('change', async () => { state.prefs = await window.api.savePrefs({ [key]: $(key).checked }); });
}
$('add-files').addEventListener('click', () => addOwn(() => window.api.pickFiles()));
// Un fichier lâché à côté de la zone ne doit pas remplacer la page.
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());
$('page-mods').addEventListener('dragover', () => $('drop').classList.add('over'));
$('page-mods').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('page-mods').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop').classList.remove('over');
  const paths = [...event.dataTransfer.files].map((f) => window.api.filePath(f));
  if (paths.length) addOwn(() => window.api.importFiles(paths));
});
$('open-folder').addEventListener('click', () => window.api.openFolder());
$('repair').addEventListener('click', async () => {
  try {
    await window.api.repair();
    $('settings-message').textContent = 'Les fichiers seront revérifiés et Java réinstallé au prochain lancement.';
  } catch (error) { $('settings-message').textContent = error.message; }
});
$('show-logs').addEventListener('click', async () => {
  $('logs').textContent = await window.api.logs() || 'Aucun log pour le moment.';
  $('logs').hidden = false;
  $('logs').scrollTop = $('logs').scrollHeight;
});
$('banner-button').addEventListener('click', () => window.api.installUpdate());

window.api.on('state', (next) => render(next));
window.api.on('progress', (p) => {
  $('progress').hidden = !p;
  if (!p) return;
  $('progress-label').textContent = p.ratio == null ? p.label : `${p.label} — ${Math.round(p.ratio * 100)} %`;
  $('progress-fill').classList.toggle('unknown', p.ratio == null);
  $('progress-fill').style.width = `${(p.ratio || 0) * 100}%`;
});
window.api.on('game', (game) => {
  state.gameRunning = game.running;
  renderHome();
  renderAccount();
  if (!game.running && game.code !== 0) showMessage(`Minecraft s'est fermé avec une erreur (code ${game.code}). Regarde les logs dans les réglages.`);
});
window.api.on('update', (update) => {
  state.update = update;
  state.updateRequired = update.required;
  renderUpdate(update, update.required);
  renderHome();
});

reload();
setInterval(() => reload().catch(() => {}), 60000);
