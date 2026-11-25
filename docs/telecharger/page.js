// Page publique : dernière version publiée sur GitHub, aux couleurs du launcher.
(async () => {
  const $ = (id) => document.getElementById(id);
  const https = (url) => /^https:\/\//i.test(url || '');
  const json = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) throw Object.assign(new Error(`erreur ${res.status}`), { status: res.status });
    return res.json();
  };
  const config = window.LAUNCHER_CONFIG;
  const defaults = await json('../defaults.json', { cache: 'no-store' });
  const rows = await json(`${config.supabaseUrl}/rest/v1/settings?select=data&id=eq.1`, { headers: { apikey: config.supabaseKey } }).catch(() => []);
  const data = rows[0]?.data || {};
  const general = { ...defaults.general, ...data.general };
  const theme = { ...defaults.theme, ...data.theme };
  const page = { ...defaults.page, ...data.page };

  const style = document.documentElement.style;
  for (const [name, key] of [['--bg', 'bg'], ['--surface', 'surface'], ['--text', 'text'], ['--muted', 'muted'], ['--accent', 'accent'], ['--accent-text', 'accentText']]) {
    style.setProperty(name, theme[key]);
  }
  style.setProperty('--radius', `${Number(theme.radius) || 0}px`);
  style.setProperty('--overlay', https(theme.bgImage) ? `${theme.bgOverlay * 100}%` : '0%');
  if (https(theme.bgImage)) document.body.style.backgroundImage = `url(${JSON.stringify(theme.bgImage)})`;
  if (https(theme.logoUrl)) { $('logo').src = theme.logoUrl; $('logo').hidden = false; }
  $('name').textContent = general.name;
  document.title = `Télécharger ${general.name}`;
  $('description').textContent = page.description;
  $('help').textContent = page.help;
  for (const link of data.links || []) {
    if (!https(link.url)) continue;
    $('links').append(Object.assign(document.createElement('a'), { href: link.url, textContent: link.label, target: '_blank', rel: 'noopener noreferrer' }));
  }

  // Dépôt : réglage du site admin, sinon déduit de l'adresse pseudo.github.io/depot/
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = page.repo.trim() || (owner && first && first !== 'telecharger' ? `${owner}/${first}` : '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { $('info').textContent = 'Téléchargement pas encore configuré.'; return; }

  const show = (url, text) => {
    $('download').href = url;
    $('download').textContent = page.button;
    $('download').hidden = false;
    $('info').textContent = text;
  };
  try {
    const release = await json(`https://api.github.com/repos/${repo}/releases/latest`);
    const exe = release.assets.find((a) => a.name.endsWith('.exe'));
    if (!exe) { $('info').textContent = 'La nouvelle version arrive, reviens dans quelques minutes.'; return; }
    show(exe.browser_download_url, `Version ${release.tag_name.replace(/^v/, '')} · ${Math.round(exe.size / 1048576)} Mo · Windows 64 bits`);
  } catch (error) {
    if (error.status === 404) { $('info').textContent = 'Aucune version disponible pour le moment.'; return; }
    // Limite de requêtes GitHub atteinte : lien vers la page des versions.
    show(`https://github.com/${repo}/releases/latest`, 'Ouvre la page puis choisis le fichier .exe.');
  }
})().catch(() => { document.getElementById('info').textContent = 'Impossible de charger la page, réessaie plus tard.'; });
