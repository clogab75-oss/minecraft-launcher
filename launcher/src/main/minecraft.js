// Installe Minecraft + Fabric + Java, puis lance le jeu.
const fs = require('fs/promises');
const path = require('path');
const { Version, launch } = require('@xmcl/core');
const {
  getVersionList, installTask, installDependenciesTask, installFabric,
  fetchJavaRuntimeManifest, installJavaRuntimeTask,
} = require('@xmcl/installer');
const { readJson, writeJson, exists } = require('./util');

async function runTask(task, label, report) {
  let last = 0;
  await task.startAndWait({
    onUpdate: () => {
      if (Date.now() - last < 150) return;
      last = Date.now();
      report(label, task.total ? Math.min(1, task.progress / task.total) : null);
    },
  });
}

async function latestLoader(version) {
  const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Fabric ne répond pas (erreur ${res.status}).`);
  const list = await res.json();
  const found = list.find((x) => x.loader.stable) || list[0];
  if (!found) throw new Error(`Fabric n'est pas disponible pour Minecraft ${version}.`);
  return found.loader.version;
}

async function installJava(root, component, report) {
  const home = path.join(root, 'runtime', component);
  const bin = path.join(home, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  const marker = path.join(home, '.ok');
  if (await exists(marker) && await exists(bin)) return bin;
  report('Installation de Java', null);
  const manifest = await fetchJavaRuntimeManifest({ target: component });
  await runTask(installJavaRuntimeTask({ destination: home, manifest }), 'Installation de Java', report);
  await fs.writeFile(marker, manifest.version?.name || 'ok');
  return bin;
}

/** Prépare tout et renvoie ce qu'il faut pour lancer. `repair` force la vérification en ligne. */
async function prepare({ root, version, loader, report }) {
  const stateFile = path.join(root, 'installed.json');
  const state = await readJson(stateFile, {});
  report(`Vérification de Minecraft ${version}`, null);

  let loaderVersion = loader;
  if (!loaderVersion) {
    try { loaderVersion = await latestLoader(version); } catch (error) {
      if (state.version !== version) throw error;
      loaderVersion = state.loader; // hors ligne : on garde la version installée
    }
  }

  const same = state.version === version && state.loader === loaderVersion;
  if (!same) {
    const { versions } = await getVersionList();
    const meta = versions.find((v) => v.id === version);
    if (!meta) throw new Error(`Version Minecraft introuvable : ${version}`);
    await runTask(installTask(meta, root), `Téléchargement de Minecraft ${version}`, report);
    await installFabric({ minecraftVersion: version, version: loaderVersion, minecraft: root });
  }

  const id = same ? state.id : `${version}-fabric${loaderVersion}`;
  const resolved = await Version.parse(root, id);
  await runTask(installDependenciesTask(resolved), 'Vérification des fichiers du jeu', report);
  const javaPath = await installJava(root, resolved.javaVersion.component, report);
  await writeJson(stateFile, { version, loader: loaderVersion, id });
  return { id, resolved, javaPath, versionJar: path.join(root, 'versions', version, `${version}.jar`) };
}

async function start({ root, prepared, session, ram, minRam, jvmArgs, server, resolution, name, launcherVersion }) {
  const max = Math.max(1024, ram);
  return launch({
    gamePath: root,
    resourcePath: root,
    javaPath: prepared.javaPath,
    version: prepared.id,
    gameProfile: { id: session.id, name: session.name },
    accessToken: session.accessToken,
    userType: 'msa',
    launcherName: name,
    launcherBrand: launcherVersion,
    minMemory: Math.min(minRam, max),
    maxMemory: max,
    extraJVMArgs: [
      '-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M',
      ...String(jvmArgs || '').split(/\s+/).filter(Boolean),
    ],
    features: { launcher: { auth_xuid: '0', clientid: '0' } },
    quickPlayMultiplayer: server || undefined,
    resolution,
    extraExecOption: { cwd: root, detached: true },
  });
}

module.exports = { prepare, start };
