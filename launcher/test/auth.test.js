const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Account } = require('../src/main/auth');

test('connexion Microsoft complète (services simulés)', async () => {
  const real = global.fetch;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-'));
  const safe = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() };
  const answers = {
    '/token': { access_token: 'ms', refresh_token: 'r' },
    '/user/authenticate': { Token: 'xbl' },
    '/xsts/authorize': { Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'h' }] } },
    '/login_with_xbox': { access_token: 'mc', expires_in: 86400 },
    '/minecraft/profile': { id: 'abc', name: 'Steve' },
  };
  global.fetch = async (url) => {
    const key = Object.keys(answers).find((k) => String(url).includes(k));
    return { ok: true, status: 200, json: async () => answers[key] };
  };
  try {
    const account = new Account(dir, safe);
    const profile = await account.login('client', async (url) => {
      const q = new URL(url).searchParams;
      assert.equal(q.get('code_challenge_method'), 'S256');
      await real(`${q.get('redirect_uri').replace('localhost', '127.0.0.1')}/?code=ok&state=${q.get('state')}`);
    });
    assert.deepEqual(profile, { id: 'abc', name: 'Steve' });
    const again = new Account(dir, safe);
    assert.equal((await again.ensure('client')).accessToken, 'mc');
    const later = new Account(dir, safe);
    answers['/token'] = { access_token: 'ms', refresh_token: 'r2' };
    const mock = global.fetch;
    global.fetch = async (url, o) => (String(url).includes('xboxlive') ? { ok: false, status: 500, json: async () => ({}) } : mock(url, o));
    await assert.rejects(later.ensure('client'));
    assert.deepEqual(await later.saved(), { id: 'abc', name: 'Steve' });
    assert.match(safe.decryptString(await fs.readFile(path.join(dir, 'account.bin'))), /"r2"/);
    global.fetch = mock;
    await again.logout();
    assert.equal(await again.saved(), null);
  } finally { global.fetch = real; }
});
