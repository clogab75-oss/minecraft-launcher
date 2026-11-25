const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { syncFiles, relativePath } = require('../src/main/sync');
const { addPacks, setFullscreen } = require('../src/main/options');
const { compareVersions, deepMerge, exists } = require('../src/main/util');
const { ping } = require('../src/main/ping');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const file = (category, filename, content = filename, extra = {}) =>
  ({ id: filename, name: filename, category, filename, url: `https://x/${content}`, sha1: sha(content), optional: false, default_on: true, overwrite: true, ...extra });
const fakeFetch = async (url, target) => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, url.slice('https://x/'.length));
};

test('refuse les chemins dangereux', () => {
  for (const name of ['../a.jar', 'a/b.jar', '..', 'C:\\a.jar', 'con.jar', 'a.jar.', '']) {
    assert.throws(() => relativePath({ category: 'mod', filename: name }), undefined, name);
  }
  for (const name of ['../x', '/etc/x', 'a/../../x', 'a//b']) assert.throws(() => relativePath({ category: 'config', filename: name }));
  assert.equal(relativePath({ category: 'config', filename: 'sodium/options.json' }), 'config/sodium/options.json');
});

test('synchronisation : ajout, retrait, optionnels, mode strict, configs', async () => {
  const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-'));
  const has = (p) => exists(path.join(gameDir, p));
  const run = (files, extra = {}) => syncFiles({ gameDir, files, fetchFile: fakeFetch, ...extra });
  await fs.mkdir(path.join(gameDir, 'mods'), { recursive: true });
  await fs.writeFile(path.join(gameDir, 'mods', 'triche.jar'), 'x');
  const a = file('mod', 'a.jar');
  const opt = file('mod', 'opt.jar', 'opt', { optional: true, default_on: false });
  const cfg = file('config', 'k.txt', 'v1', { overwrite: false });

  await run([a, opt, cfg]);
  assert.ok(await has('mods/a.jar'));
  assert.ok(!await has('mods/opt.jar'));
  assert.ok(!await has('mods/triche.jar'));

  await fs.writeFile(path.join(gameDir, 'config', 'k.txt'), 'joueur');
  await run([a, opt, cfg], { choices: { 'opt.jar': true } });
  assert.ok(await has('mods/opt.jar'));
  assert.equal(await fs.readFile(path.join(gameDir, 'config', 'k.txt'), 'utf8'), 'joueur');

  await run([file('config', 'k.txt', 'v2', { overwrite: false })]);
  assert.ok(!await has('mods/a.jar'));
  assert.equal(await fs.readFile(path.join(gameDir, 'config', 'k.txt'), 'utf8'), 'v2');

  await fs.writeFile(path.join(gameDir, 'mods', 'perso.jar'), 'x');
  await run([], { strict: false });
  assert.ok(await has('mods/perso.jar'));
});

test('activation des resource packs', () => {
  const out = addPacks('version:1\nresourcePacks:["vanilla"]\nfov:0.0\n', ['p.zip']);
  assert.match(out, /resourcePacks:\["vanilla","file\/p.zip"\]/);
  assert.match(out, /fov:0.0/);
});

test('préserve les options du jeu en appliquant le plein écran', async () => {
  const gameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'options-'));
  const optionsFile = path.join(gameDir, 'options.txt');
  await fs.writeFile(optionsFile, 'fov:0.0\nfullscreen:false\n');
  await setFullscreen(gameDir, true);
  assert.equal(await fs.readFile(optionsFile, 'utf8'), 'fov:0.0\nfullscreen:true\n');
});

test('versions et fusion des réglages', () => {
  assert.equal(compareVersions('1.0.9', '1.0.10'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [] }, { a: { b: 3 }, l: [1] }), { a: { b: 3, c: 2 }, l: [1] });
});

test('ping du serveur', async () => {
  const body = Buffer.from(JSON.stringify({ players: { online: 3, max: 20 } }));
  const payload = Buffer.concat([Buffer.from([0, body.length]), body]);
  const server = net.createServer((s) => s.once('data', () => s.write(Buffer.concat([Buffer.from([payload.length]), payload]))));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  assert.deepEqual(await ping('127.0.0.1', server.address().port), { online: true, players: 3, max: 20 });
  server.close();
});
