const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createReadStream } = require('fs');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await fs.rename(file + '.tmp', file);
}

const exists = (p) => fs.access(p).then(() => true, () => false);

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    createReadStream(file).on('error', reject).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex')));
  });
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObject(base)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(isObject(over) ? over : {})) {
    if (k === '__proto__') continue;
    out[k] = isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Compare deux versions "1.2.3". Renvoie -1, 0 ou 1. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

module.exports = { readJson, writeJson, exists, sha1File, deepMerge, compareVersions };
