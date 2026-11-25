// Publication d'une nouvelle version du launcher via GitHub Actions.
import { el, card, button, toast } from './admin.js';

const store = {
  get(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* stockage indisponible */ } },
};

function guessRepo() {
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return owner && repo ? `${owner}/${repo}` : '';
}

async function github(repo, path, token, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', ...(token && { Authorization: `Bearer ${token}` }) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`GitHub : ${body.message || res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const nextVersion = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v || '');
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
};

export function renderReleases() {
  const repo = el('input', { value: store.get('repo') || guessRepo(), placeholder: 'pseudo/nom-du-depot' });
  const token = el('input', { type: 'password', value: store.get('token'), autocomplete: 'off', placeholder: 'github_pat_…' });
  const version = el('input', { placeholder: '1.0.0' });
  const notes = el('textarea', { placeholder: 'Ce qui change dans cette version' });
  const list = el('div');
  const runs = el('p', { className: 'muted' });

  const refresh = async () => {
    const name = repo.value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error('Indique le dépôt au format pseudo/nom-du-depot.');
    store.set('repo', name);
    store.set('token', token.value.trim());
    const releases = await github(name, '/releases?per_page=10', token.value.trim());
    if (!version.value) version.value = nextVersion(releases[0]?.tag_name);
    list.replaceChildren(...releases.map((r) => {
      const exe = r.assets.find((a) => a.name.endsWith('.exe'));
      return el('div', { className: 'item' },
        el('div', { className: 'grow' }, el('strong', { textContent: r.tag_name }), el('small', { textContent: `${new Date(r.published_at).toLocaleString('fr-FR')} · ${exe ? exe.download_count + ' téléchargement(s)' : 'sans .exe'}` })),
        exe && el('a', { className: 'button', href: exe.browser_download_url, textContent: 'Télécharger le .exe' }));
    }));
    if (!releases.length) list.textContent = 'Aucune version publiée.';
    const { workflow_runs: [last] } = await github(name, '/actions/workflows/release.yml/runs?per_page=1', token.value.trim());
    const status = { queued: 'en attente', in_progress: 'en cours', success: 'réussie ✅', failure: 'échouée ❌', cancelled: 'annulée' };
    runs.textContent = last ? `Dernière compilation : ${status[last.conclusion || last.status] || last.status}` : '';
  };

  const publish = async () => {
    const name = repo.value.trim();
    const v = version.value.trim().replace(/^v/, '');
    if (!token.value.trim()) throw new Error('Colle ton jeton GitHub.');
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('Version au format 1.2.3.');
    if (!confirm(`Publier la version ${v} à tous les joueurs ?`)) return;
    const existing = await github(name, '/releases?per_page=100', token.value.trim());
    if (existing.some((r) => r.tag_name === `v${v}`)) throw new Error(`La version ${v} existe déjà.`);
    const info = await github(name, '', token.value.trim());
    await github(name, '/actions/workflows/release.yml/dispatches', token.value.trim(), {
      method: 'POST', body: JSON.stringify({ ref: info.default_branch, inputs: { version: v, notes: notes.value } }),
    });
    store.set('token', token.value.trim());
    toast('Compilation lancée. Compte environ 5 minutes, puis clique sur Actualiser.');
  };

  if (repo.value) refresh().catch((e) => { list.textContent = e.message; });
  return card('Publier une version du launcher',
    el('div', { className: 'grid' }, el('label', {}, 'Dépôt GitHub', repo), el('label', {}, 'Jeton GitHub (gardé le temps de cet onglet)', token), el('label', {}, 'Nouvelle version', version)),
    el('label', {}, 'Notes', notes),
    el('div', { className: 'row' }, button('Publier', publish, 'primary'), button('Actualiser', refresh)),
    runs, list);
}
