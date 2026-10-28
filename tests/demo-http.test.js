import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';

function fixture({ user = null, drive = {} } = {}) {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.nicolabz.dev',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"todo","origins":["https://todo.nicolabz.dev"]}]'
  });
  const repo = {
    sessions: { find: token => token === 'demo-session' ? user : null, remove: () => {} },
    drive: { getEncryptedToken: () => user ? 'encrypted-refresh-token' : null },
    statistics: { overview: () => ({ totalUsers: 6, activeUsers: 2, connectedDrives: 3 }) }
  };
  const auth = {
    start: (_type, appId, returnTo) => {
      assert.equal(appId, 'demo');
      assert.equal(returnTo, 'https://auth.nicolabz.dev/demo');
      return { browserToken: 'test-token', redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth' };
    }
  };
  return createApp({
    config, repo, auth, google: {}, sync: {}, drive,
    database: { prepare: () => ({ get: () => ({ 1: 1 }) }) }
  });
}

test('HTTP /demo : HTML, JS, CSS, session anonyme et début OAuth', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const page = await app.inject({ method: 'GET', url: '/demo' });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /Continuer avec Google/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);

  for (const [route, type] of [
    ['/demo/demo.js', 'text/javascript'],
    ['/demo/demo.css', 'text/css']
  ]) {
    const asset = await app.inject({ method: 'GET', url: route });
    assert.equal(asset.statusCode, 200);
    assert.match(asset.headers['content-type'], new RegExp(`^${type}`));
  }

  const session = await app.inject({ method: 'GET', url: '/api/session' });
  assert.deepEqual(session.json(), { authenticated: false, user: null, driveConnected: false });

  // Un utilisateur peut accéder à la page via une IP/port local : la
  // connexion est toujours initiée sur l'origine publique canonique.
  const login = await app.inject({
    method: 'GET', url: '/demo/login', headers: { host: '192.168.1.50:3000' }
  });
  assert.equal(login.statusCode, 302);
  const loginTarget = new URL(login.headers.location);
  assert.equal(loginTarget.origin, 'https://auth.nicolabz.dev');
  assert.equal(loginTarget.pathname, '/auth/google/start');
  assert.equal(loginTarget.searchParams.get('app'), 'demo');
  assert.equal(loginTarget.searchParams.get('return_to'), 'https://auth.nicolabz.dev/demo');

  const start = await app.inject({
    method: 'GET', url: `${loginTarget.pathname}${loginTarget.search}`
  });
  assert.equal(start.statusCode, 302);
  assert.match(start.headers.location, /^https:\/\/accounts\.google\.com/);
  assert.ok(start.headers['set-cookie']);
});

test('HTTP /demo : déconnexion avec origine autorisée', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const logout = await app.inject({
    method: 'POST', url: '/api/logout', headers: { origin: 'https://auth.nicolabz.dev' }
  });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.json(), { ok: true });

  const refused = await app.inject({
    method: 'POST', url: '/api/logout', headers: { origin: 'https://attacker.example' }
  });
  assert.equal(refused.statusCode, 403);
});


test('HTTP /demo : création TXT authentifiée, origine unique et validation JSON', async t => {
  const writes = [];
  const app = await fixture({
    user: { id: 42, googleSub: 'sub-42', name: 'Test', email: 'test@example.org' },
    drive: {
      createTextFile: async (userId, filename, content) => {
        writes.push({ userId, filename, content });
        return { id: 'abc123', name: filename, url: 'https://drive.google.com/file/d/abc123/view' };
      }
    }
  });
  t.after(() => app.close());
  const payload = { filename: 'mon-fichier.txt', content: 'Bonjour Google Drive !' };
  const cookies = { cookie: '__Host-nicolabz_sid=demo-session' };
  const ok = await app.inject({
    method: 'POST', url: '/api/demo/text-file',
    headers: { origin: 'https://auth.nicolabz.dev', ...cookies }, payload
  });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().name, payload.filename);
  assert.deepEqual(writes, [{ userId: 42, filename: payload.filename, content: payload.content }]);

  const unauthorized = await app.inject({
    method: 'POST', url: '/api/demo/text-file',
    headers: { origin: 'https://auth.nicolabz.dev' }, payload
  });
  assert.equal(unauthorized.statusCode, 401);

  const forbidden = await app.inject({
    method: 'POST', url: '/api/demo/text-file',
    headers: { origin: 'https://todo.nicolabz.dev', ...cookies }, payload
  });
  assert.equal(forbidden.statusCode, 403);

  const invalid = await app.inject({
    method: 'POST', url: '/api/demo/text-file',
    headers: { origin: 'https://auth.nicolabz.dev', ...cookies },
    payload: { filename: '../secret.txt', content: 'pas valide' }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_FILENAME');
  assert.equal(writes.length, 1);
});


test('HTTP / : accueil et statut public provenant de SQLite', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const page = await app.inject({ method: 'GET', url: '/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /Utilisateurs uniques/);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);

  for (const route of ['/home/home.css', '/home/home.js']) {
    const asset = await app.inject({ method: 'GET', url: route });
    assert.equal(asset.statusCode, 200);
  }
  const status = await app.inject({ method: 'GET', url: '/api/public/status' });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), {
    status: 'ok', checks: { api: 'ok', sqlite: 'ok' },
    statistics: { totalUsers: 6, activeUsers: 2, connectedDrives: 3, registeredApplications: 1 }
  });
  assert.equal(status.headers['cache-control'], 'no-store');
});
