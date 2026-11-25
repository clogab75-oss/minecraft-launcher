const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const official = require('../src/main/official');

test('installation dans le launcher officiel', async () => {
  const minecraftDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotmc-'));
  const options = {
    minecraftDir, gameDir: path.join(minecraftDir, 'jeu'), name: 'Mon Sérveur', version: '26.2', loader: '', ram: 4096, minRam: 2048,
    server: 'play.exemple.fr:25565', getProfile: async () => ({ id: 'fabric', inheritsFrom: '26.2', arguments: { game: [] } }),
  };
  await assert.rejects(official.install(options), /introuvable/);
  const file = path.join(minecraftDir, 'launcher_profiles.json');
  await fs.writeFile(file, JSON.stringify({ profiles: { perso: { name: 'perso' } }, settings: { a: 1 } }));
  await official.install(options);
  const id = await official.install(options);
  assert.equal(id, 'mon-serveur-26.2');
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(data.profiles), ['perso', 'mon-serveur']);
  assert.equal(data.settings.a, 1);
  assert.equal(data.profiles['mon-serveur'].lastVersionId, id);
  assert.match(data.profiles['mon-serveur'].javaArgs, /^-Xmx4096M -Xms2048M$/);
  const version = JSON.parse(await fs.readFile(path.join(minecraftDir, 'versions', id, `${id}.json`), 'utf8'));
  assert.deepEqual(version.arguments.game, ['--quickPlayMultiplayer', 'play.exemple.fr:25565']);
  // Hors ligne : la version déjà installée est conservée.
  await official.install({ ...options, getProfile: async () => { throw new Error('hors ligne'); } });
});
