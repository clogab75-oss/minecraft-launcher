// Active automatiquement un resource pack la première fois qu'il est installé.
const fs = require('fs/promises');
const path = require('path');
const yauzl = require('yauzl');
const { readJson, writeJson } = require('./util');

/** Lit "world_version" dans le jar du jeu, pour créer un options.txt valide. */
function dataVersion(jar) {
  return new Promise((resolve) => {
    yauzl.open(jar, { lazyEntries: true }, (error, zip) => {
      if (error) return resolve(null);
      zip.on('end', () => resolve(null)).on('error', () => resolve(null));
      zip.on('entry', (entry) => {
        if (entry.fileName !== 'version.json') return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err) return resolve(null);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c)).on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks)).world_version); } catch { resolve(null); }
            zip.close();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function addPacks(text, names) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const index = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  let list = ['vanilla'];
  if (index >= 0) {
    try { list = JSON.parse(lines[index].slice('resourcePacks:'.length)); } catch { /* ligne illisible : on repart de zéro */ }
  }
  for (const name of names) if (!list.includes(`file/${name}`)) list.push(`file/${name}`);
  const line = `resourcePacks:${JSON.stringify(list)}`;
  if (index >= 0) lines[index] = line; else lines.push(line);
  return lines.join('\n') + '\n';
}

async function enableResourcePacks(gameDir, installed, versionJar) {
  const stateFile = path.join(gameDir, '.launcher-packs.json');
  const done = await readJson(stateFile, []);
  const current = installed.filter((f) => f.category === 'resourcepack').map((f) => f.filename);
  const fresh = current.filter((n) => !done.includes(n));
  if (fresh.length) {
    const optionsFile = path.join(gameDir, 'options.txt');
    let text = await fs.readFile(optionsFile, 'utf8').catch(() => null);
    if (text === null) {
      const version = await dataVersion(versionJar);
      text = version ? `version:${version}\n` : '';
    }
    await fs.writeFile(optionsFile, addPacks(text, fresh));
  }
  await writeJson(stateFile, current);
}

async function setFullscreen(gameDir, fullscreen) {
  const optionsFile = path.join(gameDir, 'options.txt');
  let text;
  try {
    text = await fs.readFile(optionsFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    text = '';
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const index = lines.findIndex((line) => line.startsWith('fullscreen:'));
  const setting = `fullscreen:${Boolean(fullscreen)}`;
  if (index >= 0) lines[index] = setting;
  else lines.push(setting);
  await fs.writeFile(optionsFile, `${lines.join('\n')}\n`, 'utf8');
}

module.exports = { enableResourcePacks, setFullscreen, addPacks };
