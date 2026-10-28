import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';

function fixture() {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.nicolabz.dev',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"todo","origins":["https://todo.nicolabz.dev"]}]'
  });
  const repo = {
    sessions: { find: () => null, remove: () => {} },
    drive: { getEncryptedToken: () => null }
  };
  const auth = {
    start: (_type, appId, returnTo) => {
      assert.equal(appId, 'demo');
      assert.equal(returnTo, 'https://auth.nicolabz.dev/demo');
      return { browserToken: 'test-token', redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth' };
    }
  };
  return createApp({
    config, repo, auth, google: {}, sync: {},
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

  const start = await app.inject({
    method: 'GET',
    url: '/auth/google/start?app=demo&return_to=https%3A%2F%2Fauth.nicolabz.dev%2Fdemo'
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
