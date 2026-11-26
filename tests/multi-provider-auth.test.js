import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db/database.js';
import { createRepositories } from '../src/db/repositories.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { loadConfig } from '../src/config.js';
import { hashToken } from '../src/lib/crypto.js';
import { createApp } from '../src/http/app.js';

function configFor(extra = {}) {
  return loadConfig({
    NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://auth.example.org',
    GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id', GITHUB_CLIENT_SECRET: 'github-secret',
    FACEBOOK_CLIENT_ID: 'facebook-id', FACEBOOK_CLIENT_SECRET: 'facebook-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
    CLIENT_APPS_JSON: JSON.stringify([
      { id: 'todo', origins: ['https://todo.example.org'] },
      { id: 'budget', origins: ['https://budget.example.org'], requiresDrive: true }
    ]), ...extra
  });
}

function fixture(t, extra = {}) {
  const config = configFor(extra);
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const repo = createRepositories(db);
  const profiles = {
    google: { sub: 'g-1', email: 'user@example.org', name: 'Google user' },
    github: { sub: '42', email: 'user@example.org', emailVerified: true, name: 'GitHub user' },
    facebook: { sub: '42', email: 'user@example.org', emailVerified: false },
  };
  const providers = new Map(Object.keys(profiles).map(provider => [provider, {
    buildAuthorizationUrl: (flow, state) => `https://provider.example/?state=${state}`,
    exchangeCode: async flow => ({
      user: profiles[provider], refreshToken: flow.type === 'drive' ? 'refresh' : null
    })
  }]));
  const auth = createAuthService({ config, repo, providers });
  function start(provider, type = 'login', user = null, app = 'todo') {
    const flow = auth.start(type, app, `https://${app}.example.org/`, user, provider);
    return { ...flow, state: new URL(flow.redirectUrl).searchParams.get('state') };
  }
  function finish(provider, flow, type = 'login', user = null) {
    return auth.callback(type, flow.state, 'code', flow.browserToken, user, provider);
  }
  return { config, db, repo, auth, profiles, providers, start, finish };
}

test('migration v1 retains existing IDs, sessions, OAuth state, Drive credentials and sync references', t => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'identity.sqlite');
  const old = new Database(filename);
  old.exec(readFileSync(new URL('../src/db/migrations/001-initial.sql', import.meta.url), 'utf8'));
  old.pragma('user_version = 1');
  old.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(17, 'legacy', 'a@example.org', 'A', null, 1, 2);
  old.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken('session'), 17, Date.now() + 60_000);
  old.prepare('INSERT INTO drive_credentials VALUES (?,?,?)').run(17, 'encrypted', 1);
  old.prepare('INSERT INTO sync_files VALUES (?,?,?)').run(17, 'todo', 'file-id');
  old.prepare('INSERT INTO oauth_flows VALUES (?,?,?,?,?,?,?,?,?)').run(hashToken('state'), hashToken('browser'), 'drive', 'todo', 'https://todo.example.org/', 'verifier', 'nonce', 17, Date.now() + 60_000);
  old.close();
  const db = openDatabase(filename);
  t.after(() => db.close());
  const repo = createRepositories(db);
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(repo.users.findByIdentity('google', 'legacy').id, 17);
  assert.equal(repo.sessions.find('session').id, 17);
  assert.equal(repo.drive.getEncryptedToken(17), 'encrypted');
  assert.equal(repo.sync.getFileId(17, 'todo'), 'file-id');
  assert.equal(repo.flows.consume('state').provider, 'google');
});

test('provider IDs are namespaced; matching emails never auto-merge accounts', async t => {
  const { repo, start, finish } = fixture(t);
  const google = repo.sessions.find((await finish('google', start('google'))).sessionToken);
  const github = repo.sessions.find((await finish('github', start('github'))).sessionToken);
  const facebook = repo.sessions.find((await finish('facebook', start('facebook'))).sessionToken);
  assert.equal(new Set([google.id, github.id, facebook.id]).size, 3);
  assert.equal(repo.sessions.find((await finish('github', start('github'))).sessionToken).id, github.id);
  assert.equal(repo.statistics.overview().totalUsers, 3);
});

test('explicit linking preserves local ID and session; rejects conflicting identities and session changes', async t => {
  const { repo, start, finish } = fixture(t);
  const user = repo.sessions.find((await finish('google', start('google'))).sessionToken);
  const linked = await finish('github', start('github', 'link', user), 'login', user);
  assert.equal(linked.sessionToken, null);
  assert.deepEqual(repo.users.listProviders(user.id), ['github', 'google']);
  assert.equal(repo.sessions.find((await finish('github', start('github'))).sessionToken).id, user.id);
  const other = repo.sessions.find((await finish('facebook', start('facebook'))).sessionToken);
  await assert.rejects(() => finish('github', start('github', 'link', other), 'login', other), { code: 'IDENTITY_ALREADY_LINKED' });
  await assert.rejects(() => finish('facebook', start('facebook', 'link', user), 'login', other), { code: 'SESSION_CHANGED' });
  await assert.rejects(() => finish('facebook', start('github')), { code: 'INVALID_OAUTH_FLOW' });
});

test('email allowlist rejects unverified new accounts but permits explicitly linked login', async t => {
  const { repo, start, finish, profiles } = fixture(t, { ALLOWED_EMAILS: 'user@example.org' });
  await assert.rejects(() => finish('facebook', start('facebook')), { code: 'USER_NOT_ALLOWED' });
  const user = repo.sessions.find((await finish('google', start('google'))).sessionToken);
  await finish('facebook', start('facebook', 'link', user), 'login', user);
  assert.equal(repo.sessions.find((await finish('facebook', start('facebook'))).sessionToken).id, user.id);
  profiles.github.emailVerified = false;
  await assert.rejects(() => finish('github', start('github')), { code: 'USER_NOT_ALLOWED' });
});

test('Drive-required social login requests independent consent; preserves Google account binding', async t => {
  const { repo, start, finish, profiles, config } = fixture(t);
  const login = await finish('github', start('github', 'login', null, 'budget'));
  assert.equal(new URL(login.returnUrl).pathname, '/auth/drive/start');
  const user = repo.sessions.find(login.sessionToken);
  await finish('google', start('google', 'drive', user, 'budget'), 'drive', user);
  assert.equal(repo.users.findByIdentity('google', 'g-1').id, user.id);
  assert.equal(config.cipher.decrypt(repo.drive.getEncryptedToken(user.id)), 'refresh');
  const again = await finish('github', start('github', 'login', null, 'budget'));
  assert.equal(new URL(again.returnUrl).origin, 'https://budget.example.org');
  profiles.google.sub = 'g-2';
  const current = repo.sessions.find(again.sessionToken);
  await assert.rejects(() => finish('google', start('google', 'drive', current), 'drive', current),
    { code: 'GOOGLE_ACCOUNT_MISMATCH' });
});

test('HTTP discovery, disabled providers, explicit linking origin and session checks', async t => {
  const { config, db, repo, auth, providers, start, finish } = fixture(t, { FACEBOOK_CLIENT_ID: '', FACEBOOK_CLIENT_SECRET: '' });
  const app = await createApp({ config, database: db, repo, auth, google: providers.get('google'), sync: {}, drive: {} });
  t.after(() => app.close());
  assert.deepEqual((await app.inject('/api/auth/providers')).json(), { providers: ['google', 'github'] });
  assert.equal((await app.inject('/auth/facebook/start')).statusCode, 404);
  assert.equal((await app.inject('/auth/twitter/start')).statusCode, 404);
  assert.equal((await app.inject('/api/auth/identities')).statusCode, 401);
  const login = await finish('google', start('google'));
  const cookie = `__Host-nicolabz_sid=${login.sessionToken}`;
  assert.equal((await app.inject({ method: 'POST', url: '/auth/github/link', headers: { cookie, origin: 'https://todo.example.org' } })).statusCode, 403);
  const link = await app.inject({ method: 'POST', url: '/auth/github/link', headers: { cookie, origin: config.publicBaseUrl } });
  assert.equal(link.statusCode, 200);
  assert.ok(link.json().redirectUrl);
  assert.match(link.headers['set-cookie'], /HttpOnly/);
  assert.deepEqual((await app.inject({ url: '/api/auth/identities', headers: { cookie } })).json(), { providers: ['google'] });
});
