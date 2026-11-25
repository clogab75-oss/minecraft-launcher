const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { importFiles, listOwn, removeOwn } = require('../src/main/userfiles');
const { syncFiles } = require('../src/main/sync');

/** Fabrique un petit zip (non compressé) contenant un seul fichier vide. */
function zip(name) {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length, 16);
  return Buffer.concat([local, n, central, n, end]);
}

test('ajouts du joueur : plusieurs fichiers, tri automatique, conservés à la synchro', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'src-'));
  const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'game-'));
  const make = async (name, data) => { const p = path.join(source, name); await fs.writeFile(p, data); return p; };
  const paths = [
    await make('pack.zip', zip('pack.mcmeta')), await make('ombres.zip', zip('shaders/a.fsh')),
    await make('autre.zip', zip('photo.png')), await make('perso.jar', 'x'), await make('serveur.zip', zip('pack.mcmeta')),
  ];
  const options = { gameDir, strict: true, serverFiles: [{ category: 'resourcepack', filename: 'serveur.zip' }] };
  const result = await importFiles(paths, options);
  assert.deepEqual(result.added, ['pack.zip', 'ombres.zip']);
  assert.equal(result.refused.length, 3);
  await syncFiles({ gameDir, files: [], strict: true });
  assert.deepEqual((await listOwn(options)).map((f) => f.category), ['resourcepack', 'shaderpack']);
  await assert.rejects(removeOwn('resourcepack', '../x.zip', options));
  await assert.rejects(removeOwn('resourcepack', 'serveur.zip', options));
  await removeOwn('resourcepack', 'pack.zip', options);
  assert.equal((await listOwn(options)).length, 1);
  assert.deepEqual((await importFiles([paths[3]], { ...options, strict: false })).added, ['perso.jar']);
});
