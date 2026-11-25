// Synchronise mods, resource packs, shaders et configs avec la liste du site.
const fs = require('fs/promises');
const path = require('path');
const { createWriteStream } = require('fs');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { readJson, writeJson, exists, sha1File } = require('./util');

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shaderpack: 'shaderpacks', config: 'config' };
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function safeSegment(s) {
  return s.length > 0 && s !== '.' && s !== '..' && !/[<>:"\\|?*\x00-\x1f]/.test(s) && !/[. ]$/.test(s) && !RESERVED.test(s);
}

/** Chemin relatif (au dossier du jeu) d'un fichier. Refuse toute sortie du dossier. */
function relativePath(file) {
  const folder = FOLDERS[file.category];
  if (!folder) throw new Error(`Catégorie inconnue : ${file.category}`);
  const parts = String(file.filename).split('/');
  if ((file.category !== 'config' && parts.length > 1) || !parts.every(safeSegment)) {
    throw new Error(`Nom de fichier refusé : ${file.filename}`);
  }
  return [folder, ...parts].join('/');
}

/** Un fichier optionnel suit le choix du joueur, sinon la valeur par défaut du site. */
function isWanted(file, choices) {
  if (!file.optional) return true;
  return choices[file.id] ?? file.default_on;
}

async function download(url, target, sha1) {
  if (!url.startsWith('https://')) throw new Error(`Lien non sécurisé refusé : ${url}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.part';
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!res.ok) throw new Error(`erreur ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(temp));
      if (await sha1File(temp) !== sha1) throw new Error('fichier corrompu (empreinte différente)');
      await fs.rm(target, { force: true });
      await fs.rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      await fs.rm(temp, { force: true });
    }
  }
  throw new Error(`Téléchargement échoué (${path.basename(target)}) : ${lastError.message}`);
}

async function syncFiles({ gameDir, files, choices = {}, strict = true, onProgress = () => {}, fetchFile = download }) {
  const stateFile = path.join(gameDir, '.launcher-files.json');
  const state = await readJson(stateFile, { managed: {} });
  const wanted = new Map();
  for (const file of files) {
    if (isWanted(file, choices)) wanted.set(relativePath(file), file);
  }

  // 1. Retire ce que le launcher avait installé et qui n'est plus voulu.
  for (const [rel, info] of Object.entries(state.managed)) {
    if (wanted.has(rel)) continue;
    if (info.category !== 'config') await fs.rm(path.join(gameDir, rel), { force: true });
    delete state.managed[rel];
  }

  // 2. Mode strict : seuls les mods du serveur sont autorisés.
  if (strict) {
    const modsDir = path.join(gameDir, 'mods');
    const entries = await fs.readdir(modsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar') && !wanted.has(`mods/${entry.name}`)) {
        await fs.rm(path.join(modsDir, entry.name), { force: true });
      }
    }
  }

  // 3. Télécharge ce qui manque ou a changé.
  let done = 0;
  const queue = [...wanted.entries()];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [rel, file] = item;
      const target = path.join(gameDir, rel);
      const present = await exists(target);
      // Config "non écrasée" : installée une fois par version, les réglages du joueur sont gardés.
      const keep = present && file.category === 'config' && !file.overwrite && state.managed[rel]?.sha1 === file.sha1;
      if (!keep && !(present && await sha1File(target) === file.sha1)) {
        const keepExisting = present && file.category === 'config' && !file.overwrite && !state.managed[rel];
        if (!keepExisting) await fetchFile(file.url, target, file.sha1);
      }
      state.managed[rel] = { sha1: file.sha1, category: file.category };
      onProgress(++done, wanted.size, file.name);
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await writeJson(stateFile, state);
  }
  return [...wanted.values()];
}

module.exports = { FOLDERS, syncFiles, relativePath, isWanted, download };
