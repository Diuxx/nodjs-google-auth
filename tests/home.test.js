import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHomeRoutes } from '../src/http/home/routes.js';
import { createRepositories } from '../src/db/repositories.js';

function registerRoutes(overrides = {}) {
  const routes = new Map();
  const app = { get(path, handler) { routes.set(path, handler); } };
  const repo = { statistics: { overview: () => ({ totalUsers: 12, activeUsers: 3, connectedDrives: 4 }) } };
  const clientApps = {
    apps: new Map([['pecule', new Set(['https://pecule.example.org'])],
      ['batch', new Set(['https://batch.example.org'])], ['demo', new Set(['https://auth.example.org'])]]),
    driveRequiredApps: new Set(['pecule']),
    multipleApps: new Set(['pecule'])
  };
  registerHomeRoutes(app, { repo: overrides.repo ?? repo, clientApps });
  return routes;
}

function reply() {
  return {
    headers: {},
    header(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test('La page accueil est servie par Node et présente le service sans script inline', () => {
  const routes = registerRoutes();
  const page = routes.get('/')({}, reply());
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-type'], /^text\/html/);
  const html = page.body.toString('utf8');
  assert.match(html, /Nicolabz Identity/);
  assert.match(html, /data-theme="light"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /\/theme\/theme\.css/);
  assert.match(html, /\/theme\/theme\.js/);
  assert.match(html, /UTILISATEURS UNIQUES/i);
  assert.match(html, /Applications autorisées/);
  assert.match(html, /id="applications-list"/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /src="\/home\/home\.js"/);
  assert.match(html, /href="\/home\/home\.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);

  for (const [path, expectedType] of [['/home/home.css', 'text/css'], ['/home/home.js', 'text/javascript']]) {
    const asset = routes.get(path)({}, reply());
    assert.match(asset.headers['content-type'], new RegExp(`^${expectedType}`));
    assert.ok(asset.body.length > 0);
  }
});

test('La liste des interfaces présente les routes fonctionnelles et leurs méthodes', () => {
  const html = registerRoutes().get('/')({}, reply()).body.toString('utf8');
  const endpoints = [...html.matchAll(/<div class="endpoint-row"><span class="method(?: write)?">(\w+)<\/span><code>([^<]+)<\/code>/g)]
    .map(([, method, path]) => `${method} ${path}`);
  assert.deepEqual(endpoints, [
    'GET /health', 'GET /api/public/status', 'GET /api/public/applications',
    'GET /api/session', 'POST /api/logout', 'POST /api/drive/disconnect',
    'GET /auth/google/start', 'GET /auth/google/callback',
    'GET /auth/drive/start', 'GET /auth/drive/callback',
    'GET /api/sync/:appId', 'PUT /api/sync/:appId',
    'GET /api/sync/:appId/files', 'GET /api/sync/:appId/files/:name',
    'PUT /api/sync/:appId/files/:name', 'PATCH /api/sync/:appId/files/:name',
    'DELETE /api/sync/:appId/files/:name?version=N',
    'GET /demo', 'GET /demo/login', 'GET /demo/drive',
    'POST /api/demo/text-file', 'POST /api/home/applications/:appId/file-count'
  ]);
  assert.match(html, /multiple: true/);
});

test('Les applications publiques exposent uniquement leur identifiant et leurs options', async () => {
  const routes = registerRoutes();
  const response = await routes.get('/api/public/applications')({}, reply());
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, { applications: [
    { id: 'pecule', requiresDrive: true, multiple: true },
    { id: 'batch', requiresDrive: false, multiple: false }
  ] });
  assert.doesNotMatch(JSON.stringify(response.body), /example\.org|demo|email|token/);
});

test('Le statut public ne contient que les compteurs agrégés et une santé locale', async () => {
  const routes = registerRoutes();
  const response = await routes.get('/api/public/status')({}, reply());
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    status: 'ok',
    checks: { api: 'ok', sqlite: 'ok' },
    statistics: { totalUsers: 12, activeUsers: 3, connectedDrives: 4, registeredApplications: 2 }
  });
  assert.doesNotMatch(JSON.stringify(response.body), /email|googleSub|picture|refresh_token/i);
});

test('Le compteur SQLite compte les utilisateurs uniques et les sessions non expirées', () => {
  let readSql;
  let readParams;
  const db = {
    prepare(sql) {
      readSql = sql;
      return { get(params) { readParams = params; return { totalUsers: 8, activeUsers: 2, connectedDrives: 1 }; } };
    }
  };
  const repo = createRepositories(db, () => 123456);
  assert.deepEqual(repo.statistics.overview(), { totalUsers: 8, activeUsers: 2, connectedDrives: 1 });
  assert.match(readSql, /COUNT\(\*\) FROM users/);
  assert.match(readSql, /COUNT\(DISTINCT user_id\) FROM sessions WHERE expires_at > @now/);
  assert.match(readSql, /COUNT\(\*\) FROM drive_credentials/);
  assert.deepEqual(readParams, { now: 123456 });
});
