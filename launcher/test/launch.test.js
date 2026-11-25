const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Version, generateArguments } = require('@xmcl/core');

test('arguments de lancement Fabric 26.2', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-'));
  const write = async (id, json) => {
    await fs.mkdir(path.join(root, 'versions', id), { recursive: true });
    await fs.writeFile(path.join(root, 'versions', id, `${id}.json`), JSON.stringify(json));
  };
  await write('26.2', {
    id: '26.2', type: 'release', time: '2026-01-01', releaseTime: '2026-01-01', minimumLauncherVersion: 21,
    mainClass: 'net.minecraft.client.main.Main', assets: '30',
    assetIndex: { id: '30', sha1: 'a', size: 1, totalSize: 1, url: 'https://x' },
    downloads: { client: { sha1: 'a', size: 1, url: 'https://x' } }, libraries: [],
    javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 },
    arguments: { game: ['--username', '${auth_player_name}', '--xuid', '${auth_xuid}'], jvm: ['-cp', '${classpath}'] },
  });
  await write('26.2-fabric1', {
    id: '26.2-fabric1', inheritsFrom: '26.2', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'net.fabricmc:fabric-loader:1', url: 'https://maven.fabricmc.net/' }],
    arguments: { game: [], jvm: [] }, time: '2026-01-01', releaseTime: '2026-01-01',
  });
  const resolved = await Version.parse(root, '26.2-fabric1');
  assert.equal(resolved.javaVersion.component, 'java-runtime-epsilon');
  const args = await generateArguments({
    gamePath: root, javaPath: 'java', version: resolved, gameProfile: { name: 'Steve', id: 'abc' }, accessToken: 't',
    features: { launcher: { auth_xuid: '0', clientid: '0' } }, quickPlayMultiplayer: 'play.exemple.fr:25565', maxMemory: 4096,
  });
  assert.ok(args.includes('net.fabricmc.loader.impl.launch.knot.KnotClient'));
  assert.equal(args[args.indexOf('--xuid') + 1], '0');
  assert.equal(args[args.indexOf('--quickPlayMultiplayer') + 1], 'play.exemple.fr:25565');
  assert.match(args[args.indexOf('-cp') + 1], /fabric-loader-1\.jar.*26\.2\.jar/);
});
