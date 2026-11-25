import { addFromModrinth, searchModrinth, checkUpdates } from './modrinth.js';
import { renderReleases } from './releases.js';

const config = window.LAUNCHER_CONFIG;
const db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
const BUCKET = 'launcher';
const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}
export const card = (title, ...children) => el('section', { className: 'card' }, el('h2', { textContent: title }), ...children);
export function button(text, onclick, className = '') {
  const b = el('button', { type: 'button', textContent: text, className });
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onclick(); } catch (error) { toast(error.message, true); }
    b.disabled = false;
  });
  return b;
}
let toastTimer;
export function toast(message, bad = false) {
  const box = $('toast');
  box.textContent = message;
  box.className = bad ? 'bad' : '';
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, bad ? 8000 : 3500);
}
/** Lève une erreur lisible si Supabase en renvoie une. */
export async function check(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

let defaults;
let saved;
let draft;
let files = [];
let news = [];
let tab = 'appearance';
let category = 'mod';

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObject(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(isObject(over) ? over : {})) out[k] = isObject(base[k]) ? merge(base[k], v) : v;
  return out;
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

// ---------- Stockage ----------
export async function sha1(blob) {
  const digest = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const ascii = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');

async function upload(path, file) {
  await check(db.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' }));
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
const removeStored = (path) => path && check(db.storage.from(BUCKET).remove([path]));

function pickFile(accept, multiple, onPick) {
  const input = el('input', { type: 'file', accept, multiple });
  input.addEventListener('change', () => onPick([...input.files]).catch((e) => toast(e.message, true)));
  input.click();
}

async function uploadImage(file) {
  return upload(`images/${(await sha1(file)).slice(0, 12)}-${ascii(file.name)}`, file);
}

// ---------- Réglages ----------
function changed() {
  $('savebar').hidden = JSON.stringify(draft) === JSON.stringify(saved);
  sendPreview();
}

/** Champ lié à un réglage : [chemin, libellé, type, options] */
function field([path, label, type = 'text', options]) {
  const value = getPath(draft, path);
  const update = (v) => { setPath(draft, path, v); changed(); };
  if (type === 'check') {
    const input = el('input', { type: 'checkbox', checked: value });
    input.addEventListener('change', () => update(input.checked));
    return el('label', { className: 'check' }, input, label);
  }
  if (type === 'select') {
    const input = el('select', {}, ...options.map(([v, t]) => el('option', { value: v, textContent: t })));
    input.value = value;
    input.addEventListener('change', () => update(input.value));
    return el('label', {}, label, input);
  }
  if (type === 'range') {
    const input = el('input', { type: 'range', min: options[0], max: options[1], step: options[2], value });
    const out = el('span', { textContent: `${label} : ${value}` });
    input.addEventListener('input', () => { out.textContent = `${label} : ${input.value}`; update(Number(input.value)); });
    return el('label', {}, out, input);
  }
  if (type === 'area' || type === 'code') {
    const input = el('textarea', { value, className: type === 'code' ? 'code' : '', spellcheck: false });
    input.addEventListener('input', () => update(input.value));
    return el('label', {}, label, input);
  }
  const input = el('input', { type: type === 'image' ? 'url' : type, value });
  input.addEventListener('input', () => update(type === 'number' ? Number(input.value) : input.value.trim() === '' ? '' : input.value));
  if (type !== 'image') return el('label', {}, label, input);
  const send = button('Envoyer', async () => pickFile(options || 'image/*', false, async ([file]) => {
    input.value = await uploadImage(file);
    update(input.value);
    toast('Image envoyée. Pense à enregistrer.');
  }));
  return el('label', {}, label, el('div', { className: 'row nowrap' }, input, send));
}
const group = (title, fields, note) => card(title, note && el('small', { textContent: note }), el('div', { className: 'grid' }, ...fields.map(field)));

const pages = {
  appearance: ['Apparence', () => [
    group('Identité', [['general.name', 'Nom du serveur'], ['general.subtitle', 'Sous-titre'], ['theme.logoUrl', 'Logo', 'image'], ['theme.logoSize', 'Taille du logo', 'range', [32, 160, 4]]]),
    group('Couleurs', [['theme.bg', 'Fond', 'color'], ['theme.surface', 'Panneaux', 'color'], ['theme.text', 'Texte', 'color'], ['theme.muted', 'Texte discret', 'color'], ['theme.accent', 'Couleur principale', 'color'], ['theme.accentText', 'Texte sur couleur principale', 'color']]),
    group('Fond et formes', [['theme.bgImage', 'Image de fond', 'image'], ['theme.bgOverlay', "Assombrissement de l'image", 'range', [0, 1, 0.05]], ['theme.surfaceOpacity', 'Opacité des panneaux', 'range', [0, 1, 0.05]], ['theme.radius', 'Arrondis', 'range', [0, 30, 1]], ['theme.font', 'Police Google Fonts (ex : Poppins)']]),
    group('Disposition', [['theme.sidebar', 'Menu', 'select', [['left', 'À gauche'], ['right', 'À droite'], ['top', 'En haut']]], ['theme.playAlign', 'Bouton Jouer', 'select', [['left', 'À gauche'], ['center', 'Au centre'], ['right', 'À droite']]], ['features.news', 'Afficher les actualités', 'check'], ['features.mods', 'Afficher la page des mods', 'check'], ['features.status', "Afficher l'état du serveur", 'check'], ['features.avatar', 'Afficher la tête du joueur', 'check']]),
    card('CSS personnalisé (avancé)', el('small', { textContent: 'Tout le launcher est modifiable ici. Exemples : #play { text-transform: uppercase; }  #sidebar { width: 280px; }  .news-item { border: 1px solid var(--accent); }' }), field(['theme.customCss', 'CSS', 'code'])),
    group("Installeur (appliqué à la prochaine version publiée)", [['general.exeName', "Nom de l'application Windows"], ['theme.iconUrl', 'Icône PNG (256×256 minimum)', 'image', 'image/png']]),
  ]],
  texts: ['Textes & liens', () => [
    group('Textes du launcher', Object.keys(defaults.texts).map((k) => [`texts.${k}`, defaults.texts[k]])),
    linksCard(),
  ]],
  game: ['Serveur & jeu', () => [
    group('Serveur Minecraft', [['server.ip', 'Adresse IP ou domaine'], ['server.port', 'Port', 'number'], ['server.autoJoin', 'Connecter les joueurs au serveur dès le lancement', 'check']]),
    group('Version du jeu', [['minecraft.version', 'Version de Minecraft'], ['minecraft.loader', 'Fabric Loader (vide = dernière version stable)'], ['minecraft.defaultRam', 'RAM par défaut (Mo)', 'number'], ['minecraft.minRam', 'RAM minimum (Mo)', 'number'], ['minecraft.jvmArgs', 'Arguments Java en plus'], ['modsPolicy.strict', 'Interdire les mods personnels des joueurs (packs et shaders toujours autorisés)', 'check']], 'Si tu changes de version, remplace aussi les mods dans "Mods & fichiers".'),
    group('Connexion Microsoft', [['microsoft.clientId', "ID d'application (client) Azure"]], "Cet identifiant doit être approuvé par Mojang, voir le guide (README)."),
    group('Maintenance', [['maintenance.enabled', 'Bloquer le bouton Jouer', 'check'], ['maintenance.message', 'Message affiché', 'area']]),
  ]],
  files: ['Mods & fichiers', filesPage],
  news: ['Actualités', newsPage],
  updates: ['Mises à jour', () => [
    group('Mise à jour obligatoire', [['update.minVersion', 'Version minimale pour jouer (vide = aucune)']], 'Mets uniquement un numéro de version déjà publié.'),
    renderReleases(),
  ]],
};

function linksCard() {
  const list = el('div', { className: 'card' });
  const draw = () => {
    list.replaceChildren(el('h2', { textContent: 'Liens (Discord, site, boutique…)' }), ...draft.links.map((link, i) => {
      const input = (key, placeholder) => {
        const node = el('input', { value: link[key], placeholder });
        node.setAttribute('aria-label', placeholder);
        node.addEventListener('input', () => { link[key] = node.value; changed(); });
        return node;
      };
      return el('div', { className: 'row nowrap' }, input('label', 'Nom'), input('url', 'https://…'),
        button('Retirer', () => { draft.links.splice(i, 1); changed(); draw(); }, 'danger'));
    }), el('div', {}, button('Ajouter un lien', () => { draft.links.push({ label: 'Discord', url: 'https://' }); changed(); draw(); })));
  };
  draw();
  return list;
}

// ---------- Mods & fichiers ----------
const categories = { mod: ['Mods', '.jar'], resourcepack: ['Resource packs', '.zip'], shaderpack: ['Shaders', '.zip'], config: ['Configs', ''] };

async function loadFiles() { files = await check(db.from('files').select('*').order('name')); }

/** Ajoute ou remplace un fichier, et nettoie l'ancien dans le stockage. */
export async function saveFile(row) {
  const old = files.find((f) => (row.id && f.id === row.id) || (f.category === row.category && f.filename === row.filename));
  const value = old ? { ...old, ...row, id: old.id } : row;
  await check(db.from('files').upsert(value));
  if (old?.storage_path && old.storage_path !== value.storage_path) await removeStored(old.storage_path);
  await loadFiles();
}

let uploading = false;

async function uploadFiles(list, target, folder) {
  if (uploading) throw new Error('Un envoi est déjà en cours.');
  uploading = true;
  const [, extension] = categories[target];
  const failed = [];
  let sent = 0;
  try {
    for (const [index, file] of list.entries()) {
      toast(`Envoi ${index + 1}/${list.length} : ${file.name}`);
      try {
        if (extension && !file.name.toLowerCase().endsWith(extension)) throw new Error(`un fichier ${extension} est attendu`);
        if (file.size > 50 * 1024 * 1024) throw new Error("plus de 50 Mo (limite de l'offre gratuite Supabase)");
        const filename = target === 'config' && folder ? `${folder}/${file.name}` : file.name;
        if (/[<>:"\\|?*]/.test(filename) || filename.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error('nom refusé');
        const hash = await sha1(file);
        const path = `files/${target}/${hash.slice(0, 12)}-${ascii(filename)}`;
        const url = await upload(path, file);
        const name = files.find((f) => f.category === target && f.filename === filename)?.name || file.name;
        await saveFile({ category: target, filename, url, storage_path: path, sha1: hash, size: file.size, name, project_id: null, version_id: null });
        sent++;
      } catch (error) {
        failed.push(`${file.name} : ${error.message}`);
      }
    }
  } finally { uploading = false; }
  toast(`${sent}/${list.length} fichier(s) ajouté(s).${failed.length ? ' Refusés : ' + failed.join(' ; ') : ''}`, failed.length > 0);
  render();
}

function fileRow(file) {
  const toggle = (key, label) => {
    const input = el('input', { type: 'checkbox', checked: file[key] });
    input.addEventListener('change', async () => {
      try {
        await check(db.from('files').update({ [key]: input.checked }).eq('id', file.id));
        file[key] = input.checked;
        sendPreview();
        render();
      } catch (error) { toast(error.message, true); }
    });
    return el('label', { className: 'check' }, input, label);
  };
  return el('div', { className: 'item' },
    file.icon_url && el('img', { src: file.icon_url, alt: '' }),
    el('div', { className: 'grow' }, el('strong', { textContent: file.name }), el('small', { textContent: `${file.filename} · ${(file.size / 1048576).toFixed(1)} Mo · ${file.project_id ? 'Modrinth' : 'envoyé'}` })),
    toggle('enabled', 'Actif'),
    file.category !== 'config' && toggle('optional', 'Optionnel'),
    file.optional && toggle('default_on', 'Coché par défaut'),
    file.category === 'config' && toggle('overwrite', 'Écraser les réglages du joueur'),
    button('Supprimer', async () => {
      if (!confirm(`Supprimer ${file.name} ?`)) return;
      await check(db.from('files').delete().eq('id', file.id));
      await removeStored(file.storage_path);
      await loadFiles();
      render();
    }, 'danger'));
}

function filesPage() {
  const switcher = el('div', { className: 'row' }, ...Object.entries(categories).map(([key, [label]]) => button(label, () => { category = key; render(); }, key === category ? 'primary' : '')));
  const folder = el('input', { placeholder: 'Sous-dossier dans config/ (facultatif)' });
  const send = (list) => uploadFiles(list, category, folder.value.trim().replace(/^\/+|\/+$/g, ''));
  const drop = el('div', { className: 'drop' },
    el('strong', { textContent: 'Glisse tous tes fichiers ici' }),
    button('Choisir des fichiers', () => pickFile(categories[category][1], true, send), 'primary'),
    el('small', { textContent: '50 Mo maximum par fichier. Les changements sont visibles immédiatement par les joueurs.' }));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    send([...e.dataTransfer.files]).catch((error) => toast(error.message, true));
  });
  const add = card(`Envoyer des ${categories[category][0].toLowerCase()} depuis ton PC`, category === 'config' && folder, drop);
  const shown = files.filter((f) => f.category === category);
  const parts = [switcher];
  if (category !== 'config') {
    const query = el('input', { type: 'search', placeholder: `Rechercher sur Modrinth (${draft.minecraft.version})` });
    const results = el('div');
    const selected = new Set();
    const addMany = async (ids) => {
      const target = category;
      const added = [];
      const failed = [];
      for (const id of ids) {
        toast(`Ajout depuis Modrinth… ${added.length} fichier(s)`);
        try { added.push(...await addFromModrinth(id, target, saved.minecraft.version, () => files, saveFile)); } catch (error) { failed.push(error.message); }
      }
      toast(`Ajoutés : ${added.join(', ') || 'aucun'}${failed.length ? ' · Erreurs : ' + failed.join(' ; ') : ''}`, failed.length > 0);
      render();
    };
    const addSelected = button('Ajouter la sélection', () => addMany([...selected]), 'primary');
    addSelected.hidden = true;
    const search = button('Rechercher', async () => {
      const found = await searchModrinth(query.value, category, saved.minecraft.version);
      selected.clear();
      addSelected.hidden = true;
      const pick = (hit) => {
        const box = el('input', { type: 'checkbox' });
        box.setAttribute('aria-label', `Sélectionner ${hit.title}`);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(hit.project_id); else selected.delete(hit.project_id);
          addSelected.hidden = !selected.size;
        });
        return box;
      };
      results.replaceChildren(...found.map((hit) => el('div', { className: 'item' },
        !files.some((f) => f.project_id === hit.project_id) && pick(hit),
        hit.icon_url && el('img', { src: hit.icon_url, alt: '' }),
        el('div', { className: 'grow' }, el('strong', { textContent: hit.title }), el('small', { textContent: hit.description })),
        files.some((f) => f.project_id === hit.project_id) ? el('span', { className: 'muted', textContent: 'Ajouté' }) : button('Ajouter', () => addMany([hit.project_id]), 'primary'))));
      if (!found.length) results.textContent = 'Aucun résultat compatible avec cette version.';
    });
    query.addEventListener('keydown', (e) => { if (e.key === 'Enter') search.click(); });
    parts.push(card('Ajouter depuis Modrinth', el('div', { className: 'row nowrap' }, query, search), results, addSelected));
  }
  parts.push(add, card(`${categories[category][0]} (${shown.length})`,
    shown.some((f) => f.project_id) && el('div', {}, button('Mettre à jour depuis Modrinth', async () => {
      const updated = await checkUpdates(shown, saved.minecraft.version, () => files, saveFile);
      toast(updated.length ? `Mis à jour : ${updated.join(', ')}` : 'Tout est à jour.');
      render();
    })),
    ...shown.map(fileRow), !shown.length && el('p', { className: 'muted', textContent: 'Rien pour le moment.' })));
  return parts;
}

// ---------- Actualités ----------
async function loadNews() { news = await check(db.from('news').select('*').order('created_at', { ascending: false })); }
let editing = null;

function newsPage() {
  const item = editing || { title: '', body: '', image_url: '', published: true };
  const title = el('input', { value: item.title, maxLength: 150 });
  const body = el('textarea', { value: item.body });
  const image = el('input', { type: 'url', value: item.image_url || '' });
  const published = el('input', { type: 'checkbox', checked: item.published });
  const refresh = async () => { await loadNews(); sendPreview(); render(); };
  const form = card(editing ? "Modifier l'actualité" : 'Nouvelle actualité',
    el('label', {}, 'Titre', title), el('label', {}, 'Texte', body),
    el('label', {}, 'Image (facultatif)', el('div', { className: 'row nowrap' }, image, button('Envoyer', () => pickFile('image/*', false, async ([f]) => { image.value = await uploadImage(f); })))),
    el('label', { className: 'check' }, published, 'Publiée'),
    el('div', { className: 'row' }, button('Enregistrer', async () => {
      if (!title.value.trim()) throw new Error('Ajoute un titre.');
      const row = { title: title.value.trim(), body: body.value, image_url: image.value.trim() || null, published: published.checked };
      await check(editing ? db.from('news').update(row).eq('id', editing.id) : db.from('news').insert(row));
      editing = null;
      await refresh();
      toast('Actualité enregistrée.');
    }, 'primary'), editing && button('Annuler', () => { editing = null; render(); })));
  return [form, card('Publications', ...news.map((n) => el('div', { className: 'item' },
    el('div', { className: 'grow' }, el('strong', { textContent: n.title }), el('small', { textContent: `${new Date(n.created_at).toLocaleDateString('fr-FR')} · ${n.published ? 'publiée' : 'brouillon'}` })),
    button('Modifier', () => { editing = n; render(); }),
    button('Supprimer', async () => {
      if (!confirm(`Supprimer "${n.title}" ?`)) return;
      await check(db.from('news').delete().eq('id', n.id));
      await refresh();
    }, 'danger'))))];
}

// ---------- Aperçu ----------
function sendPreview() {
  if (!draft) return;
  $('preview').contentWindow?.postMessage({ type: 'preview', state: {
    settings: structuredClone(draft), files: files.filter((f) => f.enabled), news: news.filter((n) => n.published),
    account: { id: '8667ba71b85a4004af54457a9734eed7', name: 'Steve' },
  } }, location.origin);
}
function scalePreview() {
  $('preview').style.transform = `scale(${$('preview-box').clientWidth / 1100})`;
}
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'preview-ready') sendPreview(); });
new ResizeObserver(scalePreview).observe($('preview-box'));

// ---------- Navigation ----------
function render() {
  const [title, build] = pages[tab];
  $('title').textContent = title;
  for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.tab === tab);
  $('content').replaceChildren(...build().filter(Boolean));
  changed();
}

$('tabs').replaceChildren(...Object.entries(pages).map(([key, [title]]) => {
  const b = el('button', { type: 'button', textContent: title });
  b.dataset.tab = key;
  b.addEventListener('click', () => { tab = key; render(); scrollTo(0, 0); });
  return b;
}));

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const rows = await check(db.from('settings').update({ data: draft, updated_at: new Date().toISOString() }).eq('id', 1).select());
    if (!rows.length) throw new Error('Enregistrement refusé : vérifie que ton compte est admin.');
    saved = structuredClone(draft);
    changed();
    toast('Enregistré. Les launchers se mettent à jour en moins d’une minute.');
  } catch (error) { toast(error.message, true); }
  $('save').disabled = false;
});
$('cancel').addEventListener('click', () => { draft = structuredClone(saved); render(); });
window.addEventListener('beforeunload', (e) => { if (draft && !$('savebar').hidden) e.preventDefault(); });

async function open() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    const admin = await check(db.from('admins').select('user_id'));
    if (admin.length) {
      defaults = await (await fetch('defaults.json', { cache: 'no-store' })).json();
      const rows = await check(db.from('settings').select('data').eq('id', 1));
      saved = merge(defaults, rows[0]?.data);
      draft = structuredClone(saved);
      await Promise.all([loadFiles(), loadNews()]);
      $('login').hidden = true;
      $('app').hidden = false;
      render();
      scalePreview();
      return;
    }
    await db.auth.signOut();
    $('login-error').textContent = "Ce compte n'est pas administrateur (voir supabase/ajouter-admin.sql).";
  }
  $('app').hidden = true;
  $('login').hidden = false;
}
const showError = (error) => { $('login').hidden = false; $('login-error').textContent = error.message; };

$('login').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  try {
    await check(db.auth.signInWithPassword({ email: $('email').value, password: $('password').value }));
    $('password').value = '';
    await open();
  } catch (error) { showError(error); }
});
$('logout').addEventListener('click', async () => {
  await db.auth.signOut();
  sessionStorage.clear();
  location.reload();
});

open().catch(showError);
