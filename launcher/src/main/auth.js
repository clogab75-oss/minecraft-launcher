// Connexion Microsoft -> Xbox Live -> XSTS -> Minecraft (OAuth + PKCE, navigateur du joueur).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const b64 = (buf) => buf.toString('base64url');

async function request(url, options, step) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(explain(step, res.status, body));
    error.status = res.status;
    error.code = body.error;
    throw error;
  }
  return body;
}

function explain(step, status, body) {
  const xerr = {
    2148916227: 'Ce compte Xbox est banni.',
    2148916233: "Ce compte Microsoft n'a pas de profil Xbox. Crée-le sur xbox.com puis réessaie.",
    2148916235: "Xbox Live n'est pas disponible dans ton pays.",
    2148916236: 'Une vérification adulte est requise sur xbox.com.',
    2148916237: 'Une vérification adulte est requise sur xbox.com.',
    2148916238: 'Compte enfant : un adulte doit l’ajouter à un groupe familial Microsoft.',
  }[body.XErr];
  if (xerr) return xerr;
  if (step === 'minecraft' && status === 403) {
    return "L'application n'est pas encore approuvée par Mojang (formulaire aka.ms/mce-reviewappid).";
  }
  if (step === 'profile' && status === 404) return 'Ce compte ne possède pas Minecraft Java Edition.';
  return `Connexion impossible (${step}, erreur ${status}) ${body.error_description || body.errorMessage || ''}`.trim();
}

const form = (data) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});
const json = (data) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(data),
});

/** Ouvre la page Microsoft et attend le retour sur http://localhost:<port>. */
async function authorize(clientId, openUrl, signal) {
  const verifier = b64(crypto.randomBytes(48));
  const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const state = b64(crypto.randomBytes(16));
  let finish;
  const result = new Promise((resolve, reject) => { finish = { resolve, reject }; });

  const handler = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('state') !== state) { res.writeHead(404); res.end(); return; }
    const code = url.searchParams.get('code');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0e1116;color:#eee"><h2>${code ? 'Connexion réussie ✅' : 'Connexion annulée'}</h2><p>Tu peux fermer cet onglet et revenir sur le launcher.</p>`);
    if (code) finish.resolve(code);
    else finish.reject(new Error('Connexion annulée.'));
  };

  // "localhost" peut pointer vers IPv4 ou IPv6 : on écoute sur les deux.
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const server6 = http.createServer(handler);
  await new Promise((resolve) => server6.once('error', resolve).listen(port, '::1', resolve));

  const redirectUri = `http://localhost:${port}`;
  const timer = setTimeout(() => finish.reject(new Error('Délai de connexion dépassé.')), 5 * 60 * 1000);
  const onAbort = () => finish.reject(new Error('Connexion annulée.'));
  signal?.addEventListener('abort', onAbort);

  try {
    await openUrl(`${OAUTH}/authorize?${new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE,
      state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    })}`);
    const code = await result;
    return { code, verifier, redirectUri };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    server.close();
    if (server6.listening) server6.close();
  }
}

async function minecraftSession(msToken) {
  const xbl = await request('https://user.auth.xboxlive.com/user/authenticate', json({
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }), 'xbox');
  const xsts = await request('https://xsts.auth.xboxlive.com/xsts/authorize', json({
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  }), 'xsts');
  const mc = await request('https://api.minecraftservices.com/authentication/login_with_xbox', json({
    identityToken: `XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}`,
  }), 'minecraft');
  const profile = await request('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.access_token}` },
  }, 'profile');
  return {
    accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in - 300) * 1000,
    id: profile.id,
    name: profile.name,
  };
}

class Account {
  /** @param safeStorage chiffrement du système (Windows DPAPI) fourni par Electron */
  constructor(dataDir, safeStorage) {
    this.file = path.join(dataDir, 'account.bin');
    this.safe = safeStorage;
    this.session = null;
  }

  async #save(data) {
    if (!this.safe.isEncryptionAvailable()) return; // jamais de jeton en clair sur le disque
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // Écriture atomique : une coupure ne doit pas faire perdre la session.
    await fs.writeFile(this.file + '.tmp', this.safe.encryptString(JSON.stringify(data)));
    await fs.rename(this.file + '.tmp', this.file);
  }

  async #load() {
    try { return JSON.parse(this.safe.decryptString(await fs.readFile(this.file))); } catch { return null; }
  }

  async #complete(clientId, tokens, previous) {
    // Microsoft renouvelle le jeton à chaque usage : on le garde avant les étapes Xbox, qui peuvent échouer.
    if (previous) await this.#save({ ...previous, clientId, refreshToken: tokens.refresh_token || previous.refreshToken });
    this.session = await minecraftSession(tokens.access_token);
    await this.#save({ clientId, refreshToken: tokens.refresh_token, id: this.session.id, name: this.session.name });
    return this.profile();
  }

  profile() {
    return this.session && { id: this.session.id, name: this.session.name };
  }

  async saved() {
    const data = await this.#load();
    return data && { id: data.id, name: data.name };
  }

  async login(clientId, openUrl, signal) {
    if (!clientId) throw new Error("L'identifiant d'application Microsoft n'est pas configuré sur le site admin.");
    const { code, verifier, redirectUri } = await authorize(clientId, openUrl, signal);
    const tokens = await request(`${OAUTH}/token`, form({
      client_id: clientId, grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE,
    }), 'microsoft');
    return this.#complete(clientId, tokens);
  }

  /** Renvoie une session valide, en la renouvelant si besoin. */
  async ensure(clientId) {
    if (this.session && Date.now() < this.session.expiresAt) return this.session;
    // Un seul renouvellement à la fois.
    this.pending ||= this.#refresh(clientId).finally(() => { this.pending = null; });
    return this.pending;
  }

  async #refresh(clientId) {
    const data = await this.#load();
    if (!data?.refreshToken) throw new Error('Connecte-toi avec ton compte Microsoft.');
    try {
      const tokens = await request(`${OAUTH}/token`, form({
        client_id: clientId, grant_type: 'refresh_token', refresh_token: data.refreshToken, scope: SCOPE,
      }), 'microsoft');
      await this.#complete(clientId, tokens, data);
    } catch (error) {
      if (error.code === 'invalid_grant') {
        await this.logout();
        throw new Error('Ta session a expiré, reconnecte-toi.');
      }
      throw error;
    }
    return this.session;
  }

  async logout() {
    this.session = null;
    await fs.rm(this.file, { force: true });
  }
}

module.exports = { Account };
