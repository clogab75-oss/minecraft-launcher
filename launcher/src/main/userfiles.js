// Fichiers ajoutés par le joueur (resource packs, shaders, et mods si le serveur l'autorise).
const fs = require('fs/promises');
const path = require('path');
const yauzl = require('yauzl');
const { FOLDERS, relativePath } = require('./sync');
const { readJson, exists } = require('./util');

const OWN = ['resourcepack', 'shaderpack', 'mod'];

/** Reconnaît le type d'une archive à son contenu. */
function zipCategory(file) {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return resolve(null);
      let found = null;
      const end = () => { zip.close(); resolve(found); };
      zip.on('error', end).on('end', end);
      zip.on('entry', (entry) => {
        if (entry.fileName === 'pack.mcmeta') { found = 'resourcepack'; return end(); }
        if (/^([^/]+\/)?shaders\//.test(entry.fileName)) { found = 'shaderpack'; return end(); }
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

async function serverPaths({ gameDir, serverFiles }) {
  const state = await readJson(path.join(gameDir, '.launcher-files.json'), { managed: {} });
  const paths = Object.keys(state.managed);
  for (const file of serverFiles) {
    try { paths.push(relativePath(file)); } catch { /* entrée invalide ignorée */ }
  }
  return new Set(paths.map((p) => p.toLowerCase()));
}

async function importFiles(paths, options) {
  const reserved = await serverPaths(options);
  const added = [];
  const refused = [];
  for (const source of paths) {
    const name = path.basename(source);
    try {
      const extension = path.extname(name).toLowerCase();
      const category = extension === '.jar' ? 'mod' : extension === '.zip' ? await zipCategory(source) : null;
      if (!category) throw new Error("ce n'est ni un resource pack, ni un shader, ni un mod");
      if (category === 'mod' && options.strict) throw new Error('les mods personnels sont désactivés sur ce serveur');
      const rel = relativePath({ category, filename: name });
      if (reserved.has(rel.toLowerCase())) throw new Error('un fichier du serveur porte déjà ce nom');
      const target = path.join(options.gameDir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (path.resolve(source) !== path.resolve(target)) await fs.copyFile(source, target);
      added.push(name);
    } catch (error) {
      refused.push(`${name} : ${error.message}`);
    }
  }
  return { added, refused };
}

async function listOwn(options) {
  const reserved = await serverPaths(options);
  const list = [];
  for (const category of OWN) {
    const entries = await fs.readdir(path.join(options.gameDir, FOLDERS[category]), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const extension = category === 'mod' ? '.jar' : '.zip';
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(extension)) continue;
      if (!reserved.has(`${FOLDERS[category]}/${entry.name}`.toLowerCase())) list.push({ category, name: entry.name });
    }
  }
  return list;
}

async function removeOwn(category, name, options) {
  if (!OWN.includes(category)) throw new Error('Catégorie refusée.');
  const rel = relativePath({ category, filename: name });
  if ((await serverPaths(options)).has(rel.toLowerCase())) throw new Error('Ce fichier appartient au serveur.');
  const target = path.join(options.gameDir, rel);
  if (await exists(target)) await fs.rm(target);
}

module.exports = { importFiles, listOwn, removeOwn };
