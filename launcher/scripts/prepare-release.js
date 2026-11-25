// Exécuté par GitHub Actions : applique la version, le nom, l'icône et le dépôt avant le build.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
const config = require('../src/config.json');

async function main() {
  const pkgFile = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const version = (process.env.RELEASE_VERSION || '').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Version invalide : "${version}" (format attendu 1.2.3)`);
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY manquant');

  pkg.version = version;
  pkg.build.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
  pkg.build.releaseInfo = { releaseNotes: process.env.RELEASE_NOTES || `Version ${version}` };

  let settings = {};
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/settings?select=data&id=eq.1`, { headers: { apikey: config.supabaseKey } });
    if (!res.ok) throw new Error(`erreur ${res.status}`);
    settings = (await res.json())[0]?.data || {};
  } catch (error) {
    // Mieux vaut échouer que publier une version avec le mauvais nom.
    throw new Error(`Lecture des réglages Supabase impossible : ${error.message}`);
  }

  const name = String(settings.general?.exeName || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim();
  if (name) pkg.build.productName = name;

  const icon = settings.theme?.iconUrl;
  if (icon && icon.startsWith('https://')) {
    const res = await fetch(icon);
    const data = Buffer.from(await res.arrayBuffer());
    const isPng = data.length > 24 && data.readUInt32BE(0) === 0x89504e47;
    if (!res.ok || !isPng || data.readUInt32BE(16) < 256 || data.readUInt32BE(20) < 256) {
      throw new Error("L'icône doit être un PNG d'au moins 256x256.");
    }
    fs.writeFileSync(path.join(dir, 'build', 'icon.png'), data);
  }

  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Prêt : ${pkg.build.productName} ${version} (${owner}/${repo})`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
