// Récupère la configuration depuis Supabase (avec cache local si hors ligne).
const path = require('path');
const config = require('../config.json');
const defaults = require('../shared/defaults.json');
const { readJson, writeJson, deepMerge } = require('./util');

async function query(table, params) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${params}`, {
    headers: { apikey: config.supabaseKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase (${table}) : erreur ${res.status}`);
  return res.json();
}

async function loadRemote(dataDir) {
  const cacheFile = path.join(dataDir, 'remote-cache.json');
  try {
    const [settings, files, news] = await Promise.all([
      query('settings', 'select=data&id=eq.1'),
      query('files', 'select=*&enabled=is.true&order=name.asc'),
      query('news', 'select=*&published=is.true&order=created_at.desc&limit=20'),
    ]);
    const data = { settings: settings[0]?.data || {}, files, news };
    await writeJson(cacheFile, data);
    return { ...data, settings: deepMerge(defaults, data.settings), online: true };
  } catch (error) {
    const cache = await readJson(cacheFile, null);
    return {
      settings: deepMerge(defaults, cache?.settings),
      files: cache?.files || [],
      news: cache?.news || [],
      online: false,
      cached: Boolean(cache),
      error: error.message,
    };
  }
}

module.exports = { loadRemote };
