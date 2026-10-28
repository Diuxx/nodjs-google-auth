import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuthService } from '../src/auth/auth-service.js';
import { loadConfig } from '../src/config.js';
import { parseClientApps, registerDemoApp, validateReturnUrl } from '../src/lib/client-apps.js';

function testConfig(baseUrl = 'https://auth.nicolabz.dev') {
  return loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: baseUrl,
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"todo","origins":["https://todo.nicolabz.dev"]}]'
  });
}

test('Le client /demo est automatiquement inscrit sur PUBLIC_BASE_URL', () => {
  const config = testConfig();
  assert.equal(validateReturnUrl(config.clientApps, 'demo', 'https://auth.nicolabz.dev/demo'),
    'https://auth.nicolabz.dev/demo');
  assert.ok(config.clientApps.origins.has('https://auth.nicolabz.dev'));
  assert.throws(() => validateReturnUrl(config.clientApps, 'demo', 'https://attacker.example/demo'),
    { code: 'INVALID_RETURN_URL' });
  assert.throws(() => validateReturnUrl(config.clientApps, 'todo', 'https://auth.nicolabz.dev/demo'),
    { code: 'INVALID_RETURN_URL' });
});

test('L’identifiant demo et l’origine du serveur sont réservés', () => {
  const apps = parseClientApps('[{"id":"demo","origins":["https://myapp.example"]}]', true);
  assert.throws(() => registerDemoApp(apps, 'https://auth.nicolabz.dev'), /réservé/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.nicolabz.dev',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"foo","origins":["https://auth.nicolabz.dev"]}]'
  }), /réservée/);
});

test('La connexion demo conserve la protection state et son URL de retour', async () => {
  const config = testConfig();
  let pendingFlow;
  const repo = {
    flows: {
      create(flow) { pendingFlow = flow; },
      consume(_state) { const flow = pendingFlow; pendingFlow = undefined; return flow; }
    },
    users: { upsert: user => ({ id: 12, ...user }) },
    sessions: { create() {} }
  };
  const google = {
    buildAuthorizationUrl: (_flow, state) => `https://accounts.google.test/authorize?state=${state}`,
    exchangeCode: async () => ({ user: { sub: '123', email: 'test@example.org' } })
  };
  const auth = createAuthService({ config, repo, google });
  const start = auth.start('login', 'demo', 'https://auth.nicolabz.dev/demo');
  const state = new URL(start.redirectUrl).searchParams.get('state');
  const result = await auth.callback('login', state, 'fake-code', start.browserToken);
  assert.equal(result.returnUrl, 'https://auth.nicolabz.dev/demo?auth=connected');
  assert.ok(result.sessionToken);
});

test('La démo charge seulement des scripts et styles externes (CSP)', () => {
  const html = readFileSync(new URL('../src/http/demo/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/demo\/demo\.js"/);
  assert.match(html, /href="\/demo\/demo\.css"/);
  assert.match(html, /id="login"/);
  assert.match(html, /id="logout"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
});
