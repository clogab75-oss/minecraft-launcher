// Mode "launcher officiel" : prépare une installation (Fabric, mods, packs) dans le launcher Minecraft,
// puis l'ouvre. La connexion Microsoft est faite par le launcher officiel.
const fs = require('fs/promises');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { readJson, writeJson, exists } = require('./util');

const PROFILE_FILES = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'];
const STORE_ID = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe';

const slug = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'serveur';

/** Le launcher officiel réécrit ses profils : il doit être fermé pendant l'installation. */
function launcherRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 10e6 }, (error, out) => {
      resolve(!error && /^"(MinecraftLauncher|Minecraft)\.exe"/im.test(out));
    });
  });
}

async function profileFiles(minecraftDir) {
  const found = [];
  for (const name of PROFILE_FILES) {
    const file = path.join(minecraftDir, name);
    if (await exists(file)) found.push(file);
  }
  if (!found.length) {
    throw new Error('Launcher Minecraft introuvable : installe-le, ouvre-le une fois, connecte-toi, ferme-le puis réessaie.');
  }
  return found;
}

async function fabricProfile(version, loader) {
  const base = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`;
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Fabric ne répond pas (erreur ${res.status}).`);
    return res.json();
  };
  let chosen = loader;
  if (!chosen) {
    const list = await get(base);
    chosen = (list.find((x) => x.loader.stable) || list[0])?.loader.version;
    if (!chosen) throw new Error(`Fabric n'est pas disponible pour Minecraft ${version}.`);
  }
  return get(`${base}/${encodeURIComponent(chosen)}/profile/json`);
}

async function install({ minecraftDir, gameDir, name, version, loader, ram, minRam, jvmArgs, server, getProfile = fabricProfile }) {
  const files = await profileFiles(minecraftDir);
  const key = slug(name);
  const id = `${key}-${version.replace(/[^\w.-]/g, '')}`;
  const versionDir = path.join(minecraftDir, 'versions', id);
  const jsonFile = path.join(versionDir, `${id}.json`);

  let profile;
  try { profile = await getProfile(version, loader); } catch (error) {
    if (!await exists(jsonFile)) throw error; // hors ligne : on garde la version déjà installée
  }
  if (profile) {
    profile.id = id;
    // Connexion directe au serveur : argument ajouté à ceux du jeu.
    profile.arguments = { ...profile.arguments, game: [...(profile.arguments?.game || [])] };
    if (server) profile.arguments.game.push('--quickPlayMultiplayer', server);
    await writeJson(jsonFile, profile);
    const jar = path.join(versionDir, `${id}.jar`);
    if (!await exists(jar)) await fs.writeFile(jar, '');
  }

  const max = Math.max(1024, ram);
  const now = new Date().toISOString();
  for (const file of files) {
    const data = await readJson(file, null);
    if (!data) throw new Error(`Fichier illisible : ${path.basename(file)}. Ouvre puis ferme le launcher Minecraft.`);
    if (!await exists(file + '.avant-launcher')) await fs.copyFile(file, file + '.avant-launcher');
    data.profiles ||= {};
    data.profiles[key] = {
      icon: 'Grass', created: now, ...data.profiles[key],
      name, type: 'custom', lastUsed: now, lastVersionId: id, gameDir,
      javaArgs: [`-Xmx${max}M`, `-Xms${Math.min(minRam, max)}M`, String(jvmArgs || '').trim()].filter(Boolean).join(' '),
    };
    await writeJson(file, data);
  }
  return id;
}

/** Ouvre le launcher officiel. Renvoie false s'il n'a pas été trouvé. */
async function open() {
  if (process.platform !== 'win32') return false;
  const start = (command, args = []) => {
    spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
  };
  // Version Microsoft Store (la plus courante)
  if (await exists(path.join(process.env.LOCALAPPDATA || '', 'Packages', STORE_ID))) {
    return start('explorer.exe', [`shell:AppsFolder\\${STORE_ID}!Minecraft`]);
  }
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    path.join(process.env.ProgramFiles || '', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    path.join(process.env.SystemDrive || 'C:', '\\XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
  ];
  for (const exe of candidates) if (await exists(exe)) return start(exe);
  return false;
}

module.exports = { install, open, launcherRunning };
