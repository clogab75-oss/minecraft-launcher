// Installe Minecraft et Fabric pour le launcher officiel.
const path = require('path');
const { Version } = require('@xmcl/core');
const {
  getVersionList, installTask, installDependenciesTask, installFabric,
} = require('@xmcl/installer');
const { readJson, writeJson } = require('./util');

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

/** Prépare Minecraft et Fabric pour le launcher officiel. */
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
  await writeJson(stateFile, { version, loader: loaderVersion, id });
  return { id, resolved, versionJar: path.join(root, 'versions', version, `${version}.jar`) };
}

module.exports = { prepare };
