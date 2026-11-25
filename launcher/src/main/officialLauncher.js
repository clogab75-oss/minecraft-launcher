const { execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const profileBaseId = 'serveur-launcher-fabric';
const storeLauncherAppId = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function samePath(left, right) {
  return typeof left === 'string' && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function profileIdFor(profilesByFile, gameDir) {
  for (let suffix = 1; suffix < 1000; suffix++) {
    const id = suffix === 1 ? profileBaseId : `${profileBaseId}-${suffix}`;
    const available = profilesByFile.every(({ data }) => {
      const current = data?.profiles?.[id];
      return !current || samePath(current.gameDir, gameDir);
    });
    if (available) return id;
  }
  throw new Error('Impossible de créer un profil Fabric sans remplacer une installation existante.');
}

async function readProfileFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error(`Le fichier de profils Minecraft est illisible : ${path.basename(file)}.`);
    throw error;
  }
}

async function writeProfileFile(file, data) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function registerOfficialProfile({ launcherDir, gameDir, versionId, name, javaArgs = '' }) {
  await fs.mkdir(launcherDir, { recursive: true });
  const candidates = [
    path.join(launcherDir, 'launcher_profiles.json'),
    path.join(launcherDir, 'launcher_profiles_microsoft_store.json'),
  ];
  const profilesByFile = [];
  for (const file of candidates) {
    const data = await readProfileFile(file);
    if (data) profilesByFile.push({ file, data });
  }
  if (!profilesByFile.length) profilesByFile.push({ file: candidates[0], data: {} });

  for (const { data } of profilesByFile) {
    if (!isObject(data)) throw new Error('Le fichier de profils Minecraft a un format invalide.');
    if (data.profiles !== undefined && !isObject(data.profiles)) {
      throw new Error('La liste des profils Minecraft a un format invalide.');
    }
  }

  const profileId = profileIdFor(profilesByFile, gameDir);
  const now = new Date().toISOString();
  for (const { file, data } of profilesByFile) {
    data.profiles ||= {};
    const existing = isObject(data.profiles[profileId]) ? data.profiles[profileId] : {};
    data.profiles[profileId] = {
      ...existing,
      name,
      type: 'custom',
      created: existing.created || now,
      lastUsed: now,
      lastVersionId: versionId,
      gameDir,
      javaArgs,
    };
    data.selectedProfile = profileId;
    await writeProfileFile(file, data);
  }
  return profileId;
}

function launchProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function storeLauncherInstalled() {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-StartApps | Where-Object { $_.AppID -eq '${storeLauncherAppId}' } | Select-Object -First 1 -ExpandProperty AppID`,
  ], { timeout: 10000, windowsHide: true });
  return stdout.trim() === storeLauncherAppId;
}

async function assertOfficialLauncherClosed() {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-Process -Name Minecraft,MinecraftLauncher -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ProcessName',
  ], { timeout: 10000, windowsHide: true });
  if (stdout.trim()) {
    throw new Error('Ferme le launcher Minecraft officiel avant de préparer le profil, puis réessaie.');
  }
}

async function openOfficialLauncher(env = process.env) {
  if (process.platform !== 'win32') {
    throw new Error('L’ouverture automatique du launcher Minecraft officiel est disponible sous Windows.');
  }

  let lookupError;
  try {
    if (await storeLauncherInstalled()) {
      await launchProcess('explorer.exe', [`shell:AppsFolder\\${storeLauncherAppId}`]);
      return;
    }
  } catch (error) {
    lookupError = error;
  }

  const executables = [
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
  ].filter(Boolean);

  for (const executable of executables) {
    try {
      await fs.access(executable);
      await launchProcess(executable, []);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const detail = lookupError ? ` (${lookupError.message})` : '';
  throw new Error(`Le launcher Minecraft officiel est introuvable. Installe-le puis réessaie.${detail}`);
}

module.exports = { registerOfficialProfile, assertOfficialLauncherClosed, openOfficialLauncher };
