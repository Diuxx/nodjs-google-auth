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
  assert.match(html, /id="connect-drive"/);
  assert.match(html, /id="text-file-form"/);
  assert.match(html, /id="save-file"/);
  const javascript = readFileSync(new URL('../src/http/demo/demo.js', import.meta.url), 'utf8');
  assert.match(javascript, /location\.assign\('\/demo\/login'\)/);
  assert.doesNotMatch(javascript, /return_to.*location\.origin/);
  assert.match(javascript, /location\.assign\('\/demo\/drive'\)/);
  assert.match(javascript, /\/api\/demo\/text-file/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);
});

test('Le démarrage demo utilise toujours l’URL publique, même depuis une IP locale', async () => {
  const { registerDemoRoutes } = await import('../src/http/demo/routes.js');
  const routes = new Map();
  const fakeApp = { get: (route, handler) => routes.set(route, handler) };
  registerDemoRoutes(fakeApp, 'https://auth.nicolabz.dev');

  const reply = {
    location: null,
    redirect(url) { this.location = url; return this; }
  };
  routes.get('/demo/login')({ headers: { host: '192.168.1.50:3000' } }, reply);

  const login = new URL(reply.location);
  assert.equal(login.origin, 'https://auth.nicolabz.dev');
  assert.equal(login.pathname, '/auth/google/start');
  assert.equal(login.searchParams.get('app'), 'demo');
  assert.equal(login.searchParams.get('return_to'), 'https://auth.nicolabz.dev/demo');
  routes.get('/demo/drive')({}, reply);
  const drive = new URL(reply.location);
  assert.equal(drive.pathname, '/auth/drive/start');
  assert.equal(drive.searchParams.get('app'), 'demo');
  assert.equal(drive.searchParams.get('return_to'), 'https://auth.nicolabz.dev/demo');
});

test('Le consentement Drive de demo reste lié au compte Google déjà connecté', async () => {
  const config = testConfig();
  let pendingFlow;
  let stored;
  const repo = {
    flows: {
      create(flow) { pendingFlow = flow; },
      consume() { const flow = pendingFlow; pendingFlow = undefined; return flow; }
    },
    drive: {
      getEncryptedToken: () => null,
      saveEncryptedToken(_userId, encrypted) { stored = encrypted; }
    }
  };
  const google = {
    buildAuthorizationUrl: (_flow, state) => `https://accounts.google.test/authorize?state=${state}`,
    exchangeCode: async () => ({ user: { sub: 'google-42', email: 'test@example.org' }, refreshToken: 'new-refresh' })
  };
  const auth = createAuthService({ config, repo, google });
  const user = { id: 42, googleSub: 'google-42', email: 'test@example.org' };
  const start = auth.start('drive', 'demo', 'https://auth.nicolabz.dev/demo', user);
  const state = new URL(start.redirectUrl).searchParams.get('state');
  const callback = await auth.callback('drive', state, 'code', start.browserToken, user);
  assert.equal(callback.returnUrl, 'https://auth.nicolabz.dev/demo?drive=connected');
  assert.equal(callback.sessionToken, null);
  assert.equal(config.cipher.decrypt(stored), 'new-refresh');
});
