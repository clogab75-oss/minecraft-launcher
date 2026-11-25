const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { registerOfficialProfile } = require('../src/main/officialLauncher');

test('sélectionne le profil Fabric dans les fichiers officiels sans écraser les autres données', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-profiles-'));
  const gameDir = path.join(root, 'ServeurLauncher', 'game');
  const otherGameDir = path.join(root, 'OtherGame');
  const standardFile = path.join(root, 'launcher_profiles.json');
  const storeFile = path.join(root, 'launcher_profiles_microsoft_store.json');
  await fs.writeFile(standardFile, JSON.stringify({
    selectedProfile: 'default',
    authenticationDatabase: { preserved: true },
    profiles: {
      default: { name: 'Latest', lastVersionId: '26.2' },
      'serveur-launcher-fabric': { name: 'Other', gameDir: otherGameDir, lastVersionId: '1.20' },
    },
  }));
  await fs.writeFile(storeFile, JSON.stringify({ profiles: {} }));

  const profileId = await registerOfficialProfile({
    launcherDir: root,
    gameDir,
    versionId: '26.2-fabric1.0',
    name: 'Mon serveur - Fabric 26.2',
    javaArgs: '-Xms2048M -Xmx4096M',
  });

  assert.equal(profileId, 'serveur-launcher-fabric-2');
  for (const file of [standardFile, storeFile]) {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(data.selectedProfile, profileId);
    assert.equal(data.profiles[profileId].lastVersionId, '26.2-fabric1.0');
    assert.equal(data.profiles[profileId].gameDir, gameDir);
    assert.equal(data.profiles[profileId].javaArgs, '-Xms2048M -Xmx4096M');
  }
  const standard = JSON.parse(await fs.readFile(standardFile, 'utf8'));
  assert.deepEqual(standard.authenticationDatabase, { preserved: true });
  assert.equal(standard.profiles.default.lastVersionId, '26.2');
  assert.equal(standard.profiles['serveur-launcher-fabric'].lastVersionId, '1.20');
});

test('ne remplace pas un fichier de profils illisible', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-profiles-invalid-'));
  const file = path.join(root, 'launcher_profiles.json');
  await fs.writeFile(file, '{not json');

  await assert.rejects(registerOfficialProfile({
    launcherDir: root,
    gameDir: path.join(root, 'game'),
    versionId: '26.2-fabric1.0',
    name: 'Mon serveur - Fabric 26.2',
  }), /fichier de profils Minecraft est illisible/);
  assert.equal(await fs.readFile(file, 'utf8'), '{not json');
});
